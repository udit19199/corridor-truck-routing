import json
from datetime import UTC, datetime, timedelta

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from trips.domain import Checkpoint, Place, Plan, Route
from trips.geometry import haversine
from trips.planner import PlanRequest, plan_trip
from trips.providers import NoRouteError, ProviderError, get_providers


@require_GET
def health(_request: HttpRequest) -> JsonResponse:
    return JsonResponse({"ok": True})


@csrf_exempt
@require_GET
def geocode(request: HttpRequest) -> JsonResponse:
    query = request.GET.get("q", "").strip()
    if len(query) < 2:
        return JsonResponse([], safe=False)
    try:
        places = get_providers().geocode(query)
    except ProviderError as exc:
        return _error(str(exc), 502)
    return JsonResponse(
        [
            {"label": place.label, "lon": round(place.lon, 5), "lat": round(place.lat, 5)}
            for place in places
        ],
        safe=False,
    )


@csrf_exempt
@require_POST
def plan(request: HttpRequest) -> JsonResponse:
    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    try:
        plan_request = _parse_request(payload)
    except ValueError as exc:
        return _error(str(exc), 400)

    try:
        result = plan_trip(plan_request, get_providers())
    except NoRouteError:
        return _error("No route was found between these places.", 422)
    except ProviderError as exc:
        return _error(str(exc), 502)
    return JsonResponse(_plan_json(result))


def _parse_request(payload: dict) -> PlanRequest:
    origin = _parse_place(payload, "origin")
    destination = _parse_place(payload, "destination")
    departure = _parse_departure(payload.get("departure"))
    load_lb = _parse_int(payload, "load_lb")
    interval_mi = _parse_int(payload, "interval_mi")

    if interval_mi not in (10, 25, 50):
        raise ValueError("interval_mi must be 10, 25 or 50.")
    # Cargo cap: 80,000 lb legal gross minus the 35,000 lb tare added for TomTom.
    if not 1 <= load_lb <= 45_000:
        raise ValueError("load_lb must be between 1 and 45,000 lb of cargo.")
    if haversine(origin.lon, origin.lat, destination.lon, destination.lat) < 1:
        raise ValueError("origin and destination must be at least 1 mile apart.")

    return PlanRequest(
        origin=origin,
        destination=destination,
        departure=departure,
        load_lb=load_lb,
        interval_mi=interval_mi,
    )


def _parse_place(payload: dict, field: str) -> Place:
    value = payload.get(field)
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object with label, lon and lat.")
    label, lon, lat = value.get("label"), value.get("lon"), value.get("lat")
    if not isinstance(label, str) or not label.strip():
        raise ValueError(f"{field}.label must be a non-empty string.")
    if not _is_number(lon) or not _is_number(lat):
        raise ValueError(f"{field}.lon and {field}.lat must be numbers.")
    if not -180 <= lon <= 180:
        raise ValueError(f"{field}.lon must be between -180 and 180.")
    if not -90 <= lat <= 90:
        raise ValueError(f"{field}.lat must be between -90 and 90.")
    return Place(label=label.strip(), lon=float(lon), lat=float(lat))


def _parse_departure(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("departure must be an ISO 8601 time with a time zone.")
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        departure = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError("departure must be an ISO 8601 time with a time zone.") from exc
    if departure.tzinfo is None:
        raise ValueError("departure must include a time zone, for example Z.")
    departure = departure.astimezone(UTC)

    now = datetime.now(UTC)
    if not now - timedelta(hours=1) <= departure <= now + timedelta(days=14):
        raise ValueError("departure must be between 1 hour ago and 14 days from now.")
    return departure


def _parse_int(payload: dict, field: str) -> int:
    value = payload.get(field)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{field} must be an integer.")
    return value


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _plan_json(plan: Plan) -> dict:
    return {
        "departure": _iso(plan.departure),
        "load_lb": plan.load_lb,
        "interval_mi": plan.interval_mi,
        "recommended_id": plan.recommended_id,
        "reason": plan.reason,
        "routes": [_route_json(route) for route in plan.routes],
        "heatmap": {
            "cell_deg": plan.heatmap.cell_deg,
            "start": _iso(plan.heatmap.start),
            "cells": [
                {
                    "lon": round(cell.lon, 5),
                    "lat": round(cell.lat, 5),
                    "levels": [int(level) for level in cell.levels],
                }
                for cell in plan.heatmap.cells
            ],
        },
    }


def _route_json(route: Route) -> dict:
    return {
        "id": route.id,
        "name": route.name,
        "distance_mi": round(route.distance_mi, 1),
        "duration_s": route.duration_s,
        "arrival": _iso(route.arrival),
        "track": [[round(lon, 5), round(lat, 5), seconds] for lon, lat, seconds in route.track],
        "checkpoints": [_checkpoint_json(checkpoint) for checkpoint in route.checkpoints],
        "summary": {
            "miles_by_level": [round(miles, 1) for miles in route.summary.miles_by_level],
            "avg_risk": round(route.summary.avg_risk, 2),
            "worst": int(route.summary.worst),
        },
    }


def _checkpoint_json(checkpoint: Checkpoint) -> dict:
    return {
        "mile": round(checkpoint.mile, 1),
        "lon": round(checkpoint.lon, 5),
        "lat": round(checkpoint.lat, 5),
        "eta": _iso(checkpoint.eta),
        "covers_mi": round(checkpoint.covers_mi, 1),
        "weather": {
            "wind_mph": round(checkpoint.weather.wind_mph, 2),
            "gust_mph": round(checkpoint.weather.gust_mph, 2),
            "rain_in_hr": round(checkpoint.weather.rain_in_hr, 2),
            "snow_in_hr": round(checkpoint.weather.snow_in_hr, 2),
        },
        "levels": {
            "wind": int(checkpoint.levels.wind),
            "rain": int(checkpoint.levels.rain),
            "snow": int(checkpoint.levels.snow),
        },
        "level": int(checkpoint.level),
        "cause": checkpoint.cause,
    }


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _error(message: str, status: int) -> JsonResponse:
    return JsonResponse({"error": message}, status=status)
