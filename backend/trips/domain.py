from dataclasses import dataclass
from datetime import datetime
from enum import IntEnum


class Level(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4


@dataclass(frozen=True)
class Place:
    label: str
    lon: float
    lat: float


@dataclass(frozen=True)
class Weather:
    wind_mph: float
    gust_mph: float
    rain_in_hr: float
    snow_in_hr: float


@dataclass(frozen=True)
class Levels:
    wind: Level
    rain: Level
    snow: Level


@dataclass(frozen=True)
class RouteOption:
    """A raw route from a provider, before checkpoints and scoring."""

    name: str
    duration_s: int
    track: list[tuple[float, float, int]]  # lon, lat, seconds after departure


@dataclass(frozen=True)
class Checkpoint:
    mile: float
    lon: float
    lat: float
    eta: datetime
    covers_mi: float
    weather: Weather
    levels: Levels
    level: Level
    cause: str


@dataclass(frozen=True)
class RouteSummary:
    miles_by_level: tuple[float, float, float, float, float]
    avg_risk: float
    worst: Level


@dataclass(frozen=True)
class Route:
    id: str
    name: str
    distance_mi: float
    duration_s: int
    arrival: datetime
    track: list[tuple[float, float, int]]
    checkpoints: list[Checkpoint]
    summary: RouteSummary


@dataclass(frozen=True)
class HeatmapCell:
    lon: float
    lat: float
    levels: list[Level]


@dataclass(frozen=True)
class Heatmap:
    cell_deg: float
    start: datetime
    cells: list[HeatmapCell]


@dataclass(frozen=True)
class Plan:
    departure: datetime
    load_lb: int
    interval_mi: int
    recommended_id: str
    reason: str
    routes: list[Route]
    heatmap: Heatmap
