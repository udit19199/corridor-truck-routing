import json
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
from typing import Any
from urllib.parse import quote

import requests
from django.conf import settings
from django.core.cache import cache as weather_cache

from trips.domain import Cell, Place, RouteOption, TrackPoint, Weather
from trips.geometry import haversine

# Raw JSON from outside services; each use checks the shape it needs.
Json = Any

FIXTURES_DIR = Path(__file__).parent / "fixtures"
TOMTOM_SEARCH_URL = "https://api.tomtom.com/search/2/search/{query}.json"
TOMTOM_ROUTE_URL = "https://api.tomtom.com/routing/1/calculateRoute/{origin}:{destination}/json"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_CACHE_SECONDS = 30 * 60
MIN_TRACK_SPACING_MI = 0.2
# TomTom wants gross vehicle weight; the form asks for cargo.
# 35,000 lb is a typical empty tractor-trailer.
TRUCK_TARE_LB = 35_000
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
            track=_thin_track(
                [(float(lon), float(lat), int(seconds)) for lon, lat, seconds in route["track"]]
            ),
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


def _tomtom_routes(
    origin: Place, destination: Place, departure: datetime, load_lb: int
) -> list[RouteOption]:
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
            "departAt": departure.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "instructionsType": "coded",
        },
        "The TomTom routing service",
    )
    options = []
    if not isinstance(data, dict):
        raise ProviderError("The TomTom routing service returned an unexpected response.")
    for route in (data.get("routes") or [])[:3]:
        track = _tomtom_track(route)
        summary = route.get("summary") or {}
        if len(track) < 2 or not summary.get("travelTimeInSeconds"):
            continue
        options.append(
            RouteOption(
                name=_route_name(route),
                duration_s=int(summary["travelTimeInSeconds"]),
                track=track,
            )
        )
    if not options:
        raise NoRouteError("No route was found between these places.")
    return options


def _route_name(route: dict[str, Json]) -> str:
    numbers: list[str] = []
    for instruction in (route.get("guidance") or {}).get("instructions") or []:
        numbers.extend(instruction.get("roadNumbers") or [])
    if not numbers:
        return "Unnamed roads"
    return ", ".join(number for number, _count in Counter(numbers).most_common(2))


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
    offsets, times = _instruction_marks(route.get("guidance") or {}, length, total_time)

    track = []
    for (lon, lat), distance in zip(points, distance_m, strict=False):
        track.append((lon, lat, round(_time_at(offsets, times, distance))))
    return _thin_track(track)


def _instruction_marks(
    guidance: dict[str, Json], length_m: float, total_time: float
) -> tuple[list[float], list[float]]:
    pairs = []
    for instruction in guidance.get("instructions") or []:
        offset = instruction.get("routeOffsetInMeters")
        seconds = instruction.get("travelTimeInSeconds")
        if offset is not None and seconds is not None:
            pairs.append((float(offset), float(seconds)))
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
    missing = []
    for cell in cells:
        cached = _cached_series(cell, start, hours)
        if cached is None:
            missing.append(cell)
        else:
            series[cell] = cached

    with ThreadPoolExecutor(max_workers=4) as pool:
        for fetched in pool.map(
            lambda chunk: _fetch_openmeteo(chunk, start, hours), _chunks(missing, 100)
        ):
            series.update(fetched)
    return series


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
        fields = {
            name: hourly.get(name) or []
            for name in ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")
        }
        if not times or any(len(values) != len(times) for values in fields.values()):
            raise ProviderError("The weather service returned an unexpected response.")

        first = datetime.fromisoformat(times[0]).replace(tzinfo=UTC)
        offset = round((start - first).total_seconds() / 3600)
        values = []
        for hour in range(hours):
            index = min(max(offset + hour, 0), len(times) - 1)
            weather = Weather(
                wind_mph=float(fields["wind_speed_10m"][index]),
                gust_mph=float(fields["wind_gusts_10m"][index]),
                rain_in_hr=float(fields["rain"][index]) + float(fields["showers"][index]),
                snow_in_hr=float(fields["snowfall"][index]),
            )
            values.append(weather)
            weather_cache.set(
                _cache_key(cell, start + timedelta(hours=hour)),
                weather,
                WEATHER_CACHE_SECONDS,
            )
        result[cell] = values
    return result


def _cache_key(cell: Cell, when: datetime) -> str:
    return f"weather:{cell[0]:.2f}:{cell[1]:.2f}:{when.astimezone(UTC):%Y-%m-%dT%H}"


# -- Shared -----------------------------------------------------------------------


def _get_json(url: str, params: dict[str, str | int], service: str) -> Json:
    timeout = getattr(settings, "PROVIDER_TIMEOUT_S", 15)
    try:
        response = requests.get(url, params=params, timeout=timeout)
        response.raise_for_status()
        return response.json()
    except ValueError as exc:
        raise ProviderError(f"{service} returned an unreadable response.") from exc
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 429:
            raise ProviderError(
                f"{service} rate limit was reached. Try again in a minute."
            ) from exc
        raise ProviderError(f"{service} is unavailable right now.") from exc
    except requests.RequestException as exc:
        raise ProviderError(f"{service} is unavailable right now.") from exc


def _on_hour(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def _chunks[T](items: list[T], size: int) -> Iterator[list[T]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _thin_track(track: list[TrackPoint]) -> list[TrackPoint]:
    """Keep points at least 0.2 mi apart; the destination always stays."""
    if len(track) < 2:
        return track

    cumulative = [0.0]
    for previous, point in zip(track, track[1:], strict=False):
        cumulative.append(cumulative[-1] + haversine(previous[0], previous[1], point[0], point[1]))

    kept = [0]
    for index in range(1, len(track)):
        if cumulative[index] - cumulative[kept[-1]] >= MIN_TRACK_SPACING_MI:
            kept.append(index)
    if kept[-1] != len(track) - 1:
        # Drop a point that would leave a short final hop, then always keep the destination.
        if cumulative[-1] - cumulative[kept[-1]] < MIN_TRACK_SPACING_MI and len(kept) > 1:
            kept.pop()
        kept.append(len(track) - 1)
    return [track[index] for index in kept]


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
