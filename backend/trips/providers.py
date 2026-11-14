"""Chooses which provider implementations a plan runs against."""

import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from trips import recorded, tomtom, weather
from trips.domain import Cell, Place, RouteOption, Weather


@dataclass(frozen=True)
class Providers:
    geocode: Callable[[str], list[Place]]
    routes: Callable[[Place, Place, datetime, int], list[RouteOption]]
    hourly: Callable[
        [list[Cell], datetime, datetime],
        dict[Cell, list[Weather]],
    ]


def demo_providers() -> Providers:
    return Providers(geocode=recorded.geocode, routes=recorded.routes_for, hourly=recorded.hourly)


def get_providers() -> Providers:
    routing = os.environ.get("ROUTING_PROVIDER", "tomtom").strip().lower()
    forecast = os.environ.get("WEATHER_PROVIDER", "openmeteo").strip().lower()

    routing_options = {
        "tomtom": (tomtom.geocode, tomtom.routes),
        "fixture": (recorded.geocode, recorded.routes_for),
    }
    weather_options = {"openmeteo": weather.hourly, "fixture": recorded.hourly}
    if routing not in routing_options:
        raise ValueError(f"Unknown ROUTING_PROVIDER: {routing}")
    if forecast not in weather_options:
        raise ValueError(f"Unknown WEATHER_PROVIDER: {forecast}")

    geocode, routes = routing_options[routing]
    return Providers(geocode=geocode, routes=routes, hourly=weather_options[forecast])
