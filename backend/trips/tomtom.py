"""TomTom truck routing and search."""

import os
from bisect import bisect_right
from collections import Counter
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from trips.domain import Place, RouteOption, TrackPoint
from trips.geometry import haversine
from trips.remote import (
    Json,
    NoRouteError,
    ProviderError,
    as_dict,
    as_float,
    as_list,
    get_json,
)

TOMTOM_SEARCH_URL = "https://api.tomtom.com/search/2/search/{query}.json"
TOMTOM_ROUTE_URL = "https://api.tomtom.com/routing/1/calculateRoute/{origin}:{destination}/json"
TRUCK_TARE_LB = 35_000
NO_ROUTE_CODES = frozenset({"MAP_MATCHING_FAILURE", "NO_ROUTE_FOUND", "CANNOT_RESTORE_BASEROUTE"})


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
        "The TomTom search service",
    )
    places = []
    if not isinstance(data, dict):
        raise ProviderError("The TomTom search service returned an unexpected response.")
    results = data.get("results") or []
    if not isinstance(results, list):
        raise ProviderError("The TomTom search service returned an unexpected response.")
    for result in results[:5]:
        if not isinstance(result, dict):
            continue
        position = as_dict(result.get("position"))
        address = as_dict(result.get("address"))
        poi = as_dict(result.get("poi"))
        label = address.get("freeformAddress") or poi.get("name")
        lon, lat = as_float(position.get("lon")), as_float(position.get("lat"))
        if lon is not None and lat is not None and label:
            places.append(Place(label=str(label), lon=lon, lat=lat))
    return places


def _says_no_route(body: Json) -> bool:
    detail = body.get("detailedError") if isinstance(body, dict) else None
    if not isinstance(detail, dict):
        return False
    code = str(detail.get("code") or "").upper()
    message = str(detail.get("message") or "").upper()
    return code in NO_ROUTE_CODES or "NO_ROUTE_FOUND" in message


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
        "The TomTom routing service",
        no_route_400=_says_no_route,
    )
    options = []
    if not isinstance(data, dict):
        raise ProviderError("The TomTom routing service returned an unexpected response.")
    alternatives = data.get("routes") or []
    if not isinstance(alternatives, list):
        raise ProviderError("The TomTom routing service returned an unexpected response.")
    taken_names: set[str] = set()
    for route in alternatives[:3]:
        if not isinstance(route, dict):
            continue
        track = _track(route)
        summary = as_dict(route.get("summary"))
        duration_s = as_float(summary.get("travelTimeInSeconds"))
        if len(track) < 2 or duration_s is None or duration_s <= 0:
            continue
        name = _route_name(_roads_by_distance(route), taken_names)
        if name in taken_names:
            name = f"Route {'ABC'[len(options)]}"
        taken_names.add(name)
        options.append(
            RouteOption(
                name=name,
                duration_s=int(duration_s),
                track=track,
            )
        )
    if not options:
        if alternatives:
            raise ProviderError("The TomTom routing service returned an unexpected response.")
        raise NoRouteError()
    return options


def _roads_by_distance(route: dict[str, Json]) -> list[str]:
    guidance = as_dict(route.get("guidance"))
    instructions = [
        item for item in as_list(guidance.get("instructions")) if isinstance(item, dict)
    ]
    metres: dict[str, float] = {}
    for index, instruction in enumerate(instructions):
        start = as_float(instruction.get("routeOffsetInMeters"))
        following = (
            as_float(instructions[index + 1].get("routeOffsetInMeters"))
            if index + 1 < len(instructions)
            else None
        )
        stretch_m = following - start if start is not None and following is not None else 0.0
        for number in as_list(instruction.get("roadNumbers")):
            metres[str(number)] = metres.get(str(number), 0.0) + stretch_m
    if not any(metres.values()):
        counts: Counter[str] = Counter(
            str(number)
            for instruction in instructions
            for number in as_list(instruction.get("roadNumbers"))
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


def _track(route: dict[str, Json]) -> list[TrackPoint]:
    points: list[tuple[float, float]] = []
    for leg in as_list(route.get("legs")):
        if not isinstance(leg, dict):
            continue
        for point in as_list(leg.get("points")):
            if not isinstance(point, dict):
                continue
            lat, lon = as_float(point.get("latitude")), as_float(point.get("longitude"))
            if lat is None or lon is None:
                continue
            pair = (lon, lat)
            if not points or points[-1] != pair:
                points.append(pair)
    if len(points) < 2:
        return []

    distance_m = [0.0]
    for start, end in zip(points, points[1:], strict=False):
        distance_m.append(distance_m[-1] + haversine(start[0], start[1], end[0], end[1]) * 1609.344)
    length = distance_m[-1]
    summary = as_dict(route.get("summary"))
    total_time = as_float(summary.get("travelTimeInSeconds")) or 0.0
    reported_m = as_float(summary.get("lengthInMeters")) or 0.0
    scale = length / reported_m if reported_m > 0 else 1.0
    offsets, times = _instruction_marks(as_dict(route.get("guidance")), length, total_time, scale)

    track = []
    for (lon, lat), distance in zip(points, distance_m, strict=False):
        track.append((lon, lat, round(_time_at(offsets, times, distance))))
    return track


def _instruction_marks(
    guidance: dict[str, Json], length_m: float, total_time: float, scale: float
) -> tuple[list[float], list[float]]:
    pairs = []
    for instruction in as_list(guidance.get("instructions")):
        if not isinstance(instruction, dict):
            continue
        offset = as_float(instruction.get("routeOffsetInMeters"))
        seconds = as_float(instruction.get("travelTimeInSeconds"))
        if offset is not None and seconds is not None:
            pairs.append((offset * scale, seconds))
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
