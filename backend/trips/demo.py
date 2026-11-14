"""Recorded Dallas to Chicago routes and the scripted storm, so a plan needs no keys."""

import json
from dataclasses import dataclass
from datetime import datetime
from functools import cache
from math import cos, exp, hypot, radians
from pathlib import Path

from trips.domain import Cell, Place, RouteOption, Weather

ROUTES_FILE = Path(__file__).parent / "demo_routes.json"
DEMO_CITIES = [
    Place("Dallas, TX", -96.7970, 32.7767),
    Place("Chicago, IL", -87.6298, 41.8781),
    Place("Oklahoma City, OK", -97.5164, 35.4676),
    Place("Tulsa, OK", -95.9928, 36.1540),
    Place("St. Louis, MO", -90.1994, 38.6270),
    Place("Memphis, TN", -90.0490, 35.1495),
    Place("Little Rock, AR", -92.2896, 34.7465),
    Place("Kansas City, MO", -94.5786, 39.0997),
]


@cache
def _routes() -> list[RouteOption]:
    data = json.loads(ROUTES_FILE.read_text())
    return [
        RouteOption(
            name=str(route["name"]),
            duration_s=int(route["track"][-1][2]),
            track=[(float(lon), float(lat), int(seconds)) for lon, lat, seconds in route["track"]],
        )
        for route in data["routes"]
    ]


def geocode(query: str) -> list[Place]:
    prefix = query.strip().lower()
    return [place for place in DEMO_CITIES if place.label.lower().startswith(prefix)][:5]


def routes_for(
    _origin: Place, _destination: Place, _departure: datetime, _load_lb: int
) -> list[RouteOption]:
    return list(_routes())


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
    Storm(-91.16, 35.70, 0.12, 0.00, 0.70, 42.0, 0.22, 0.0),
    Storm(-94.20, 38.90, 0.08, 0.00, 1.60, 28.0, 0.45, 0.0),
    Storm(-99.00, 47.50, 0.28, -0.10, 1.40, 33.0, 0.05, 2.2),
)


def _weather_at(lon: float, lat: float, hour: int) -> Weather:
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


def hourly(cells: list[Cell], start: datetime, end: datetime) -> dict[Cell, list[Weather]]:
    hours = max(1, int((end - start).total_seconds() // 3600) + 1)
    return {cell: [_weather_at(cell[0], cell[1], hour) for hour in range(hours)] for cell in cells}
