import json
import logging
import os
from bisect import bisect_right
from collections import Counter
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import cache
from math import cos, exp, hypot, radians
from pathlib import Path
from threading import Event, Lock
from time import monotonic
from typing import Any
from urllib.parse import quote

import requests
from django.conf import settings
from django.core.cache import cache as weather_cache

from trips.domain import Cell, Place, RouteOption, TrackPoint, Weather
from trips.geometry import haversine

logger = logging.getLogger(__name__)

# Raw JSON from outside services; each use checks the shape it needs.
Json = Any

FIXTURES_DIR = Path(__file__).parent / "fixtures"
TOMTOM_SEARCH_URL = "https://api.tomtom.com/search/2/search/{query}.json"
TOMTOM_ROUTE_URL = "https://api.tomtom.com/routing/1/calculateRoute/{origin}:{destination}/json"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_CACHE_SECONDS = 30 * 60
OPENMETEO_FIELDS = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")
# A null reading may borrow from an hour at most this far away; further out it is a real gap.
MAX_GAP_FILL_HOURS = 3
# TomTom wants gross vehicle weight; the form asks for cargo.
# 35,000 lb is a typical empty tractor-trailer.
TRUCK_TARE_LB = 35_000
NO_ROUTE_MESSAGE = "No truck route was found between these places."
FIXTURE_CITIES = [
    Place("Dallas, TX", -96.7970, 32.7767),
    Place("Chicago, IL", -87.6298, 41.8781),
    Place("Oklahoma City, OK", -97.5164, 35.4676),
    Place("Tulsa, OK", -95.9928, 36.1540),
    Place("St. Louis, MO", -90.1994, 38.6270),
    Place("Memphis, TN", -90.0490, 35.1495),
    Place("Little Rock, AR", -92.2896, 34.7465),
    Place("Kansas City, MO", -94.5786, 39.0997),
]


class ProviderError(Exception):
    """An outside service failed or returned something unusable."""


class NoRouteError(Exception):
    """The routing service knows no route between the two places."""

    def __init__(self, message: str = NO_ROUTE_MESSAGE) -> None:
        super().__init__(message)


@dataclass(frozen=True)
class Providers:
    geocode: Callable[[str], list[Place]]
    routes: Callable[[Place, Place, datetime, int], list[RouteOption]]
    hourly: Callable[
        [list[Cell], datetime, datetime],
        dict[Cell, list[Weather]],
    ]


# -- Fixture routing and geocoding -------------------------------------------------


@cache
def _fixture_routes() -> list[RouteOption]:
    data = json.loads((FIXTURES_DIR / "dallas_chicago.json").read_text())
    return [
        RouteOption(
            name=str(route["name"]),
            duration_s=int(route["track"][-1][2]),
            track=[(float(lon), float(lat), int(seconds)) for lon, lat, seconds in route["track"]],
        )
        for route in data["routes"]
    ]


def _fixture_geocode(query: str) -> list[Place]:
    prefix = query.strip().lower()
    return [place for place in FIXTURE_CITIES if place.label.lower().startswith(prefix)][:5]


def _fixture_routes_for(
    _origin: Place, _destination: Place, _departure: datetime, _load_lb: int
) -> list[RouteOption]:
    return list(_fixture_routes())


# -- Fixture weather: a fixed storm field that moves with the clock ----------------


# Each storm sits at (lon, lat) at the requested start hour and drifts from there,
# so the field is the same for any date and time.
@dataclass(frozen=True)
class Storm:
    lon: float
    lat: float
    drift_lon: float
    drift_lat: float
    radius_deg: float
    wind_mph: float
    rain_in_hr: float
    snow_in_hr: float


STORMS = (
    # Wind over the southern route around hour 8.
    Storm(-91.16, 35.70, 0.12, 0.00, 0.70, 42.0, 0.22, 0.0),
    # Wide rain field over the central routes around hours 9-13.
    Storm(-94.20, 38.90, 0.08, 0.00, 1.60, 28.0, 0.45, 0.0),
    # Snow field drifting into the corridor late in the 48 hour window.
    Storm(-99.00, 47.50, 0.28, -0.10, 1.40, 33.0, 0.05, 2.2),
)


def _fixture_weather_at(lon: float, lat: float, hour: int) -> Weather:
    wind = rain = snow = 0.0
    for storm in STORMS:
        storm_lon = storm.lon + storm.drift_lon * hour
        storm_lat = storm.lat + storm.drift_lat * hour
        dx = (lon - storm_lon) * cos(radians(storm.lat))
        dy = lat - storm_lat
        fraction = exp(-0.5 * (hypot(dx, dy) / storm.radius_deg) ** 2)
        wind = max(wind, storm.wind_mph * fraction)
        rain = max(rain, storm.rain_in_hr * fraction)
        snow = max(snow, storm.snow_in_hr * fraction)
    return Weather(wind_mph=wind, gust_mph=wind * 1.35, rain_in_hr=rain, snow_in_hr=snow)


def _fixture_hourly(cells: list[Cell], start: datetime, end: datetime) -> dict[Cell, list[Weather]]:
    hours = max(1, int((end - start).total_seconds() // 3600) + 1)
    return {
        cell: [_fixture_weather_at(cell[0], cell[1], hour) for hour in range(hours)]
        for cell in cells
    }


# -- TomTom -----------------------------------------------------------------------


def _tomtom_key() -> str:
    key = os.environ.get("TOMTOM_API_KEY", "").strip()
    if not key:
        raise ProviderError("TomTom is not configured: TOMTOM_API_KEY is missing.")
    return key


def _tomtom_geocode(query: str) -> list[Place]:
    data = _get_json(
        TOMTOM_SEARCH_URL.format(query=quote(query, safe="")),
        {
            "key": _tomtom_key(),
            "countrySet": "US",
            "typeahead": "true",
            "limit": 5,
            "idxSet": "Geo,PAD",
        },
        "The TomTom search service",
    )
    places = []
    if not isinstance(data, dict):
        raise ProviderError("The TomTom search service returned an unexpected response.")
    for result in (data.get("results") or [])[:5]:
        position = result.get("position") or {}
        label = (result.get("address") or {}).get("freeformAddress") or (
            result.get("poi") or {}
        ).get("name")
        lon, lat = position.get("lon"), position.get("lat")
        if isinstance(lon, (int, float)) and isinstance(lat, (int, float)) and label:
            places.append(Place(label=str(label), lon=float(lon), lat=float(lat)))
    return places


# TomTom reports a route it cannot compute as a 400. These mean the points cannot be
# reached; any other 400 is a bad request from us.
NO_ROUTE_CODES = frozenset({"MAP_MATCHING_FAILURE", "NO_ROUTE_FOUND", "CANNOT_RESTORE_BASEROUTE"})


def _tomtom_says_no_route(body: Json) -> bool:
    detail = body.get("detailedError") if isinstance(body, dict) else None
    if not isinstance(detail, dict):
        return False
    code = str(detail.get("code") or "").upper()
    message = str(detail.get("message") or "").upper()
    return code in NO_ROUTE_CODES or "NO_ROUTE_FOUND" in message


def _tomtom_routes(
    origin: Place, destination: Place, departure: datetime, load_lb: int
) -> list[RouteOption]:
    # TomTom rejects a departure in the past, so a departure up to 1 hour ago starts
    # at the next minute. ETAs still count from the departure the user chose.
    depart_at = max(departure, datetime.now(UTC) + timedelta(minutes=1))
    data = _get_json(
        TOMTOM_ROUTE_URL.format(
            origin=f"{origin.lat},{origin.lon}", destination=f"{destination.lat},{destination.lon}"
        ),
        {
            "key": _tomtom_key(),
            "travelMode": "truck",
            "vehicleCommercial": "true",
            "vehicleWeight": round((load_lb + TRUCK_TARE_LB) * 0.45359237),
            "maxAlternatives": 2,
            "alternativeType": "anyRoute",
            "departAt": depart_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            # Live traffic made TomTom drop its alternatives for some departures (Dallas to
            # Chicago at 09:30Z: 1 route with traffic, 3 without). Historical speeds for the
            # departure hour still shape the ETAs, and live traffic now says little about a
            # truck that is still hours from most of its route.
            "traffic": "false",
            "instructionsType": "coded",
        },
        "The TomTom routing service",
        # A 400 is either "no route for this truck" or our own bad request; the body decides.
        no_route_400=_tomtom_says_no_route,
    )
    options = []
    if not isinstance(data, dict):
        raise ProviderError("The TomTom routing service returned an unexpected response.")
    taken_names: set[str] = set()
    for route in (data.get("routes") or [])[:3]:
        track = _tomtom_track(route)
        summary = route.get("summary") or {}
        if len(track) < 2 or not summary.get("travelTimeInSeconds"):
            continue
        name = _route_name(_roads_by_distance(route), taken_names)
        if name in taken_names:
            name = f"Route {'ABC'[len(options)]}"
        taken_names.add(name)
        options.append(
            RouteOption(
                name=name,
                duration_s=int(summary["travelTimeInSeconds"]),
                track=track,
            )
        )
    if not options:
        raise NoRouteError()
    return options


def _roads_by_distance(route: dict[str, Json]) -> list[str]:
    """Road numbers ranked by the distance driven on them, from TomTom's guidance."""
    instructions = (route.get("guidance") or {}).get("instructions") or []
    metres: dict[str, float] = {}
    for index, instruction in enumerate(instructions):
        start = instruction.get("routeOffsetInMeters")
        following = (
            instructions[index + 1].get("routeOffsetInMeters")
            if index + 1 < len(instructions)
            else None
        )
        stretch_m = (
            float(following) - float(start) if start is not None and following is not None else 0.0
        )
        for number in instruction.get("roadNumbers") or []:
            metres[str(number)] = metres.get(str(number), 0.0) + stretch_m
    if not any(metres.values()):
        # Guidance without usable offsets: fall back to counting instructions.
        counts: Counter[str] = Counter(
            str(number)
            for instruction in instructions
            for number in instruction.get("roadNumbers") or []
        )
        return [number for number, _count in counts.most_common()]
    return sorted(metres, key=lambda number: metres[number], reverse=True)


def _route_name(roads: list[str], taken_names: set[str]) -> str:
    if not roads:
        return "Unnamed roads"
    # Two roads are the usual name. Add the next road when another route already
    # uses the same name, so the three cards stay distinct.
    depth = 2
    name = ", ".join(roads[:depth])
    while name in taken_names and depth < len(roads):
        depth += 1
        name = ", ".join(roads[:depth])
    return name


def _tomtom_track(route: dict[str, Json]) -> list[TrackPoint]:
    points: list[tuple[float, float]] = []
    for leg in route.get("legs") or []:
        for point in leg.get("points") or []:
            lat, lon = point.get("latitude"), point.get("longitude")
            if lat is None or lon is None:
                continue
            pair = (float(lon), float(lat))
            if not points or points[-1] != pair:
                points.append(pair)
    if len(points) < 2:
        return []

    distance_m = [0.0]
    for start, end in zip(points, points[1:], strict=False):
        distance_m.append(distance_m[-1] + haversine(start[0], start[1], end[0], end[1]) * 1609.344)
    length = distance_m[-1]
    summary = route.get("summary") or {}
    total_time = float(summary.get("travelTimeInSeconds") or 0)
    reported_m = float(summary.get("lengthInMeters") or 0)
    # Guidance offsets measure TomTom's road length, the track measures the polyline.
    # Scale one to the other so the destination lands exactly on travelTimeInSeconds.
    scale = length / reported_m if reported_m > 0 else 1.0
    offsets, times = _instruction_marks(route.get("guidance") or {}, length, total_time, scale)

    track = []
    for (lon, lat), distance in zip(points, distance_m, strict=False):
        track.append((lon, lat, round(_time_at(offsets, times, distance))))
    return track


def _instruction_marks(
    guidance: dict[str, Json], length_m: float, total_time: float, scale: float
) -> tuple[list[float], list[float]]:
    pairs = []
    for instruction in guidance.get("instructions") or []:
        offset = instruction.get("routeOffsetInMeters")
        seconds = instruction.get("travelTimeInSeconds")
        if offset is not None and seconds is not None:
            pairs.append((float(offset) * scale, float(seconds)))
    pairs.sort()

    offsets, times = [0.0], [0.0]
    for offset, seconds in pairs:
        if offset <= offsets[-1]:
            continue
        offsets.append(offset)
        times.append(max(seconds, times[-1]))
    if length_m > offsets[-1]:
        offsets.append(length_m)
        times.append(max(total_time, times[-1]))
    return offsets, times


def _time_at(offsets: list[float], times: list[float], distance: float) -> float:
    if distance <= 0 or len(offsets) < 2:
        return times[0]
    if distance >= offsets[-1]:
        return times[-1]
    index = max(0, bisect_right(offsets, distance) - 1)
    span = offsets[index + 1] - offsets[index]
    fraction = (distance - offsets[index]) / span if span else 0.0
    return times[index] + (times[index + 1] - times[index]) * fraction


# -- Open-Meteo -------------------------------------------------------------------


def _openmeteo_hourly(
    cells: list[Cell], start: datetime, end: datetime
) -> dict[Cell, list[Weather]]:
    start = _on_hour(start)
    hours = max(1, int((_on_hour(end) - start).total_seconds() // 3600) + 1)

    series: dict[Cell, list[Weather]] = {}
    own: list[Cell] = []
    waiting: list[tuple[Cell, Event]] = []
    try:
        for cell in cells:
            cached = _cached_series(cell, start, hours)
            if cached is not None:
                series[cell] = cached
                continue
            event = _claim_fetch(cell, start, hours)
            if event is None:
                own.append(cell)
            else:
                waiting.append((cell, event))

        with ThreadPoolExecutor(max_workers=4) as pool:
            for fetched in pool.map(
                lambda chunk: _fetch_openmeteo(chunk, start, hours), _chunks(own, 100)
            ):
                series.update(fetched)
    finally:
        for cell in own:
            _release_fetch(cell, start, hours)

    # Another request was fetching these. Its result is cached by now unless that fetch failed,
    # and then the misses go out in the same batches as above, not one request per cell.
    missed: list[Cell] = []
    for cell, event in waiting:
        event.wait()
        cached = _cached_series(cell, start, hours)
        if cached is None:
            missed.append(cell)
        else:
            series[cell] = cached
    for chunk in _chunks(missed, 100):
        series.update(_fetch_openmeteo(chunk, start, hours))
    return series


# Cells another request is fetching right now. Threads in this process only, which matches
# the local cache: a second plan over the same corridor waits instead of refetching it.
_inflight_lock = Lock()
_inflight: dict[tuple[Cell, datetime, int], Event] = {}


def _claim_fetch(cell: Cell, start: datetime, hours: int) -> Event | None:
    """None when this caller should do the fetch, else the event to wait on."""
    key = (cell, start, hours)
    with _inflight_lock:
        event = _inflight.get(key)
        if event is None:
            _inflight[key] = Event()
        return event


def _release_fetch(cell: Cell, start: datetime, hours: int) -> None:
    key = (cell, start, hours)
    with _inflight_lock:
        event = _inflight.pop(key, None)
    if event is not None:
        event.set()


def _cached_series(cell: Cell, start: datetime, hours: int) -> list[Weather] | None:
    values = [
        weather_cache.get(_cache_key(cell, start + timedelta(hours=hour))) for hour in range(hours)
    ]
    return None if any(value is None for value in values) else values


def _fetch_openmeteo(cells: list[Cell], start: datetime, hours: int) -> dict[Cell, list[Weather]]:
    end = start + timedelta(hours=hours - 1)
    data = _get_json(
        OPEN_METEO_URL,
        {
            "latitude": ",".join(f"{cell[1]:.2f}" for cell in cells),
            "longitude": ",".join(f"{cell[0]:.2f}" for cell in cells),
            "hourly": "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "GMT",
            "start_hour": start.strftime("%Y-%m-%dT%H:%M"),
            "end_hour": end.strftime("%Y-%m-%dT%H:%M"),
        },
        "The weather service",
    )
    items = [data] if isinstance(data, dict) else data
    if not isinstance(items, list) or len(items) != len(cells):
        raise ProviderError("The weather service returned an unexpected response.")

    result = {}
    for cell, item in zip(cells, items, strict=True):
        if not isinstance(item, dict):
            raise ProviderError("The weather service returned an unexpected response.")
        hourly = item.get("hourly") or {}
        times = hourly.get("time") or []
        fields = {name: hourly.get(name) or [] for name in OPENMETEO_FIELDS}
        if not times or any(len(values) != len(times) for values in fields.values()):
            raise ProviderError("The weather service returned an unexpected response.")

        first = datetime.fromisoformat(times[0]).replace(tzinfo=UTC)
        if first != start or len(times) != hours:
            # Padding or shifting the series would cache a value under the wrong hour.
            raise ProviderError("The weather service returned an unexpected response.")

        series = {name: _fill_gaps(fields[name]) for name in OPENMETEO_FIELDS}
        wind = series["wind_speed_10m"]
        rain = series["rain"]
        showers = series["showers"]
        snow = series["snowfall"]
        gust = series["wind_gusts_10m"] or wind
        if wind is None or rain is None or showers is None or snow is None or gust is None:
            raise ProviderError("The weather service returned incomplete data.")

        forecast = []
        for hour in range(hours):
            weather = Weather(
                wind_mph=wind[hour],
                gust_mph=gust[hour],
                rain_in_hr=rain[hour] + showers[hour],
                snow_in_hr=snow[hour],
            )
            forecast.append(weather)
            weather_cache.set(
                _cache_key(cell, start + timedelta(hours=hour)),
                weather,
                WEATHER_CACHE_SECONDS,
            )
        result[cell] = forecast
    return result


def _fill_gaps(readings: list[Json]) -> list[float] | None:
    """Replace nulls from the nearest valid hour. None if every hour is null.

    A hole wider than MAX_GAP_FILL_HOURS is an error: a value from a distant hour
    would be labelled with the wrong time.
    """
    known = [index for index, reading in enumerate(readings) if reading is not None]
    if not known:
        return None
    filled = []
    for index, reading in enumerate(readings):
        if reading is not None:
            filled.append(float(reading))
            continue
        nearest = min(known, key=lambda other: abs(other - index))
        if abs(nearest - index) > MAX_GAP_FILL_HOURS:
            raise ProviderError("The weather service returned incomplete data.")
        filled.append(float(readings[nearest]))
    return filled


def _cache_key(cell: Cell, when: datetime) -> str:
    return f"weather:{cell[0]:.2f}:{cell[1]:.2f}:{when.astimezone(UTC):%Y-%m-%dT%H}"


# -- Shared -----------------------------------------------------------------------


def _get_json(
    url: str,
    params: dict[str, str | int],
    service: str,
    no_route_400: Callable[[Json], bool] | None = None,
) -> Json:
    timeout = getattr(settings, "PROVIDER_TIMEOUT_S", 15)
    started = monotonic()
    try:
        response = requests.get(url, params=params, timeout=timeout)
    except requests.RequestException:
        _log_failure(service, None, started)
        raise ProviderError(f"{service} is unavailable right now.") from None

    status = response.status_code
    if status >= 400:
        # Logged by service and status only: the URL carries the API key.
        _log_failure(service, status, started)
        if status == 400 and no_route_400 is not None:
            try:
                body = response.json()
            except ValueError:
                body = None
            if no_route_400(body):
                raise NoRouteError() from None
            raise ProviderError(f"{service} rejected the request.") from None
        if status == 429:
            raise ProviderError(f"{service} is busy right now. Try again in a minute.") from None
        raise ProviderError(f"{service} is unavailable right now.") from None

    try:
        return response.json()
    except ValueError:
        _log_failure(service, status, started)
        raise ProviderError(f"{service} returned an unreadable response.") from None


def _log_failure(service: str, status: int | None, started: float) -> None:
    """Log a failure by service and status. The URL carries the API key, so never log it."""
    logger.warning(
        "provider failure service=%s status=%s elapsed_ms=%d",
        service,
        status if status is not None else "none",
        round((monotonic() - started) * 1000),
    )


def _on_hour(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def _chunks[T](items: list[T], size: int) -> Iterator[list[T]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def get_providers() -> Providers:
    routing = os.environ.get("ROUTING_PROVIDER", "tomtom").strip().lower()
    weather = os.environ.get("WEATHER_PROVIDER", "openmeteo").strip().lower()

    routing_options = {
        "tomtom": (_tomtom_geocode, _tomtom_routes),
        "fixture": (_fixture_geocode, _fixture_routes_for),
    }
    weather_options = {"openmeteo": _openmeteo_hourly, "fixture": _fixture_hourly}
    if routing not in routing_options:
        raise ValueError(f"Unknown ROUTING_PROVIDER: {routing}")
    if weather not in weather_options:
        raise ValueError(f"Unknown WEATHER_PROVIDER: {weather}")

    geocode, routes = routing_options[routing]
    return Providers(geocode=geocode, routes=routes, hourly=weather_options[weather])
