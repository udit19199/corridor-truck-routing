"""TomTom truck routing and search."""

import os
from bisect import bisect_right
from collections import Counter
from datetime import UTC, datetime, timedelta
from itertools import pairwise
from urllib.parse import quote

from pydantic import BaseModel, ConfigDict, ValidationError
from pydantic.alias_generators import to_camel

from trips.domain import Place, RouteOption, TrackPoint
from trips.geometry import haversine
from trips.remote import Json, NoRouteError, ProviderError, get_json

TOMTOM_SEARCH_URL = "https://api.tomtom.com/search/2/search/{query}.json"
TOMTOM_ROUTE_URL = "https://api.tomtom.com/routing/1/calculateRoute/{origin}:{destination}/json"
SEARCH_SERVICE = "The TomTom search service"
ROUTING_SERVICE = "The TomTom routing service"
TRUCK_TARE_LB = 35_000
NO_ROUTE_CODES = frozenset({"MAP_MATCHING_FAILURE", "NO_ROUTE_FOUND", "CANNOT_RESTORE_BASEROUTE"})


class _Model(BaseModel):
    """TomTom's JSON uses camelCase; fields here are snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, frozen=True)


class _Position(_Model):
    lat: float
    lon: float


class _Address(_Model):
    freeform_address: str | None = None


class _Poi(_Model):
    name: str | None = None


class _SearchResult(_Model):
    position: _Position | None = None
    address: _Address = _Address()
    poi: _Poi = _Poi()


class _Search(_Model):
    results: list[_SearchResult] = []


class _Point(_Model):
    latitude: float
    longitude: float


class _Leg(_Model):
    points: list[_Point] = []


class _Summary(_Model):
    travel_time_in_seconds: float
    length_in_meters: float = 0.0


class _Instruction(_Model):
    route_offset_in_meters: float | None = None
    travel_time_in_seconds: float | None = None
    road_numbers: list[str] = []


class _Guidance(_Model):
    instructions: list[_Instruction] = []


class _Route(_Model):
    summary: _Summary
    legs: list[_Leg] = []
    guidance: _Guidance = _Guidance()


class _Routing(_Model):
    routes: list[_Route] = []


class _ErrorDetail(_Model):
    code: str = ""
    message: str = ""


class _ErrorBody(_Model):
    detailed_error: _ErrorDetail = _ErrorDetail()


def _parse[M: BaseModel](model: type[M], data: Json, service: str) -> M:
    try:
        return model.model_validate(data)
    except ValidationError:
        raise ProviderError(f"{service} returned an unexpected response.") from None


def _key() -> str:
    key = os.environ.get("TOMTOM_API_KEY", "").strip()
    if not key:
        raise ProviderError("TomTom is not configured: TOMTOM_API_KEY is missing.")
    return key


def geocode(query: str) -> list[Place]:
    data = get_json(
        TOMTOM_SEARCH_URL.format(query=quote(query, safe="")),
        {
            "key": _key(),
            "countrySet": "US",
            "typeahead": "true",
            "limit": 5,
            "idxSet": "Geo,PAD",
        },
        SEARCH_SERVICE,
    )
    places = []
    for result in _parse(_Search, data, SEARCH_SERVICE).results:
        label = result.address.freeform_address or result.poi.name
        if result.position and label:
            places.append(Place(label=label, lon=result.position.lon, lat=result.position.lat))
    return places


def _says_no_route(body: Json) -> bool:
    try:
        detail = _ErrorBody.model_validate(body).detailed_error
    except ValidationError:
        return False
    return detail.code.upper() in NO_ROUTE_CODES or "NO_ROUTE_FOUND" in detail.message.upper()


def routes(
    origin: Place, destination: Place, departure: datetime, load_lb: int
) -> list[RouteOption]:
    depart_at = max(departure, datetime.now(UTC) + timedelta(minutes=1))
    data = get_json(
        TOMTOM_ROUTE_URL.format(
            origin=f"{origin.lat},{origin.lon}", destination=f"{destination.lat},{destination.lon}"
        ),
        {
            "key": _key(),
            "travelMode": "truck",
            "vehicleCommercial": "true",
            "vehicleWeight": round((load_lb + TRUCK_TARE_LB) * 0.45359237),
            "maxAlternatives": 2,
            "alternativeType": "anyRoute",
            "departAt": depart_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "traffic": "false",
            "instructionsType": "coded",
        },
        ROUTING_SERVICE,
        no_route_400=_says_no_route,
    )
    alternatives = _parse(_Routing, data, ROUTING_SERVICE).routes
    options = []
    taken_names: set[str] = set()
    for route in alternatives[:3]:
        track = _track(route)
        if len(track) < 2 or route.summary.travel_time_in_seconds <= 0:
            continue
        name = _route_name(_roads_by_distance(route), taken_names)
        if name in taken_names:
            name = f"Route {'ABC'[len(options)]}"
        taken_names.add(name)
        options.append(
            RouteOption(
                name=name, duration_s=int(route.summary.travel_time_in_seconds), track=track
            )
        )
    if not options:
        if alternatives:
            raise ProviderError(f"{ROUTING_SERVICE} returned an unexpected response.")
        raise NoRouteError()
    return options


def _roads_by_distance(route: _Route) -> list[str]:
    instructions = route.guidance.instructions
    offsets = [instruction.route_offset_in_meters for instruction in instructions] + [None]
    metres: dict[str, float] = {}
    for instruction, start, following in zip(instructions, offsets, offsets[1:], strict=False):
        stretch_m = following - start if start is not None and following is not None else 0.0
        for number in instruction.road_numbers:
            metres[number] = metres.get(number, 0.0) + stretch_m
    if not any(metres.values()):
        counts = Counter(
            number for instruction in instructions for number in instruction.road_numbers
        )
        return [number for number, _count in counts.most_common()]
    return sorted(metres, key=lambda number: metres[number], reverse=True)


def _route_name(roads: list[str], taken_names: set[str]) -> str:
    if not roads:
        return "Unnamed roads"
    depth = 2
    name = ", ".join(roads[:depth])
    while name in taken_names and depth < len(roads):
        depth += 1
        name = ", ".join(roads[:depth])
    return name


def _track(route: _Route) -> list[TrackPoint]:
    points: list[tuple[float, float]] = []
    for leg in route.legs:
        for point in leg.points:
            pair = (point.longitude, point.latitude)
            if not points or points[-1] != pair:
                points.append(pair)
    if len(points) < 2:
        return []

    distance_m = [0.0]
    for start, end in pairwise(points):
        distance_m.append(distance_m[-1] + haversine(start[0], start[1], end[0], end[1]) * 1609.344)
    length = distance_m[-1]
    reported_m = route.summary.length_in_meters
    scale = length / reported_m if reported_m > 0 else 1.0
    offsets, times = _instruction_marks(
        route.guidance, length, route.summary.travel_time_in_seconds, scale
    )
    return [
        (lon, lat, round(_time_at(offsets, times, distance)))
        for (lon, lat), distance in zip(points, distance_m, strict=False)
    ]


def _instruction_marks(
    guidance: _Guidance, length_m: float, total_time: float, scale: float
) -> tuple[list[float], list[float]]:
    pairs = sorted(
        (instruction.route_offset_in_meters * scale, instruction.travel_time_in_seconds)
        for instruction in guidance.instructions
        if instruction.route_offset_in_meters is not None
        and instruction.travel_time_in_seconds is not None
    )

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
    if distance <= 0:
        return times[0]
    if distance >= offsets[-1]:
        return times[-1]
    index = bisect_right(offsets, distance) - 1
    span = offsets[index + 1] - offsets[index]
    fraction = (distance - offsets[index]) / span
    return times[index] + (times[index + 1] - times[index]) * fraction
