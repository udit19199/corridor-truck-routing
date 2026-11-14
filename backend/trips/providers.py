"""Chooses live providers, or the recorded demo data when DEMO_DATA is set."""

import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from trips import demo, tomtom, weather
from trips.domain import Cell, Place, RouteOption, Weather


@dataclass(frozen=True)
class Providers:
    geocode: Callable[[str], list[Place]]
    routes: Callable[[Place, Place, datetime, int], list[RouteOption]]
    hourly: Callable[[list[Cell], datetime, datetime], dict[Cell, list[Weather]]]


def demo_providers() -> Providers:
    return Providers(geocode=demo.geocode, routes=demo.routes_for, hourly=demo.hourly)


def get_providers() -> Providers:
    if os.environ.get("DEMO_DATA", "").lower() in {"1", "true", "yes"}:
        return demo_providers()
    return Providers(geocode=tomtom.geocode, routes=tomtom.routes, hourly=weather.hourly)
