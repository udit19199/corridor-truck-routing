import json
import logging
from datetime import UTC, datetime, timedelta
from time import monotonic
from typing import TypeIs

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import RequestDataTooBig
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET, require_POST

from trips.domain import Checkpoint, Place, Plan, Route
from trips.geometry import haversine
from trips.planner import PlanRequest, plan_trip
from trips.providers import demo_providers, get_providers
from trips.remote import NoRouteError, ProviderError

logger = logging.getLogger(__name__)

GEOCODE_CACHE_SECONDS = 24 * 60 * 60
RATE_WINDOW_SECONDS = 60
PLAN_REQUESTS_PER_WINDOW = 6
GEOCODE_REQUESTS_PER_WINDOW = 60


@require_GET
def health(_request: HttpRequest) -> JsonResponse:
    return JsonResponse({"ok": True})


@require_GET
def geocode(request: HttpRequest) -> JsonResponse:
    query = request.GET.get("q", "").strip()
    if not 2 <= len(query) <= 100:
        return JsonResponse([], safe=False)
    if _over_limit(request, "geocode", GEOCODE_REQUESTS_PER_WINDOW):
        return _too_many_requests()

    cache_key = f"geocode:{query.lower()}"
    places = cache.get(cache_key)
    if places is None:
        try:
            places = get_providers().geocode(query)
        except ProviderError as exc:
            return _error(str(exc), 502)
        cache.set(cache_key, places, GEOCODE_CACHE_SECONDS)
    return JsonResponse(
        [
            {"label": place.label, "lon": round(place.lon, 5), "lat": round(place.lat, 5)}
            for place in places
        ],
        safe=False,
    )


@require_POST
def plan(request: HttpRequest) -> JsonResponse:
    if _over_limit(request, "plan", PLAN_REQUESTS_PER_WINDOW):
        return _too_many_requests()

    try:
        payload = json.loads(request.body)
    except RequestDataTooBig:
        return _error("Request body is too large.", 413)
    except (json.JSONDecodeError, UnicodeDecodeError, RecursionError):
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    try:
        plan_request = _parse_request(payload)
        demo = _parse_demo(payload)
    except ValueError as exc:
        return _error(str(exc), 400)

    started = monotonic()
    try:
        result = plan_trip(plan_request, demo_providers() if demo else get_providers())
    except NoRouteError as exc:
        return _error(str(exc), 422)
    except ProviderError as exc:
        return _error(str(exc), 502)
    logger.info(
        "plan demo=%s routes=%d cells=%d cell_deg=%s elapsed_ms=%d",
        demo,
        len(result.routes),
        len(result.heatmap.cells),
        result.heatmap.cell_deg,
        round((monotonic() - started) * 1000),
    )
    return JsonResponse(_plan_json(result))


def _parse_request(payload: dict[str, object]) -> PlanRequest:
    origin = _parse_place(payload, "origin", "Origin")
    destination = _parse_place(payload, "destination", "Destination")
    departure = _parse_departure(payload.get("departure"))
    load_lb = _parse_int(payload, "load_lb", "Cargo weight must be a whole number of pounds.")
    interval_mi = _parse_int(
        payload, "interval_mi", "Pick a checkpoint interval of 10, 25 or 50 miles."
    )

    if interval_mi not in (10, 25, 50):
        raise ValueError("Pick a checkpoint interval of 10, 25 or 50 miles.")
    if not 1 <= load_lb <= 45_000:
        raise ValueError("Cargo weight must be between 1 and 45,000 lb.")
    if haversine(origin.lon, origin.lat, destination.lon, destination.lat) < 1:
        raise ValueError("Origin and destination must be at least 1 mile apart.")

    return PlanRequest(
        origin=origin,
        destination=destination,
        departure=departure,
        load_lb=load_lb,
        interval_mi=interval_mi,
    )


def _parse_demo(payload: dict[str, object]) -> bool:
    demo = payload.get("demo", False)
    if not isinstance(demo, bool):
        raise ValueError("demo must be true or false.")
    return demo


def _parse_place(payload: dict[str, object], field: str, name: str) -> Place:
    value = payload.get(field)
    if not isinstance(value, dict):
        raise ValueError(f"{name} must include a name, a longitude and a latitude.")
    label, lon, lat = value.get("label"), value.get("lon"), value.get("lat")
    if not isinstance(label, str) or not label.strip():
        raise ValueError(f"Give the {name.lower()} a name.")
    if not _is_number(lon) or not _is_number(lat):
        raise ValueError(f"{name} longitude and latitude must be numbers.")
    if not -180 <= lon <= 180:
        raise ValueError(f"{name} longitude must be between -180 and 180.")
    if not -90 <= lat <= 90:
        raise ValueError(f"{name} latitude must be between -90 and 90.")
    return Place(label=label.strip(), lon=float(lon), lat=float(lat))


def _parse_departure(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Departure must be a date and time with a time zone.")
    try:
        departure = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError("Departure must be a date and time with a time zone.") from None
    if departure.tzinfo is None:
        raise ValueError("Departure must include a time zone, for example Z.")
    departure = departure.astimezone(UTC)

    now = datetime.now(UTC)
    if departure < now - timedelta(hours=1):
        raise ValueError("Departure cannot be more than 1 hour in the past.")
    if departure > now + timedelta(days=12):
        raise ValueError("Departure must be within the next 12 days.")
    return departure


def _parse_int(payload: dict[str, object], field: str, message: str) -> int:
    value = payload.get(field)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(message)
    return value


def _is_number(value: object) -> TypeIs[int | float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _over_limit(request: HttpRequest, scope: str, limit: int) -> bool:
    if not settings.THROTTLE_ENABLED:
        return False
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    client = forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR", "")
    key = f"throttle:{scope}:{client}"
    if cache.add(key, 1, RATE_WINDOW_SECONDS):
        return False
    try:
        return cache.incr(key) > limit
    except ValueError:
        cache.set(key, 1, RATE_WINDOW_SECONDS)
        return False


def _too_many_requests() -> JsonResponse:
    response = _error("Too many requests. Wait a minute and try again.", 429)
    response["Retry-After"] = str(RATE_WINDOW_SECONDS)
    return response


def _plan_json(plan: Plan) -> dict[str, object]:
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


def _route_json(route: Route) -> dict[str, object]:
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


def _checkpoint_json(checkpoint: Checkpoint) -> dict[str, object]:
    return {
        "mile": round(checkpoint.mile, 1),
        "lon": round(checkpoint.lon, 5),
        "lat": round(checkpoint.lat, 5),
        "eta": _iso(checkpoint.eta),
        "covers_mi": round(checkpoint.covers_mi, 1),
        "weather": {
            "wind_mph": round(checkpoint.weather.wind_mph, 1),
            "gust_mph": round(checkpoint.weather.gust_mph, 1),
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


def api_not_found(_request: HttpRequest) -> JsonResponse:
    return _error("Not found.", 404)


def _error(message: str, status: int) -> JsonResponse:
    return JsonResponse({"error": message}, status=status)
