from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import floor

from trips.domain import (
    Cell,
    Checkpoint,
    Heatmap,
    HeatmapCell,
    Place,
    Plan,
    Route,
    RouteOption,
    TrackPoint,
    Weather,
)
from trips.geometry import (
    cell_of,
    corridor_cells,
    cumulative_miles,
    point_and_time_at,
    thin_track,
)
from trips.providers import NoRouteError, Providers
from trips.rules import classify, covered_miles, rank, summarize

HEATMAP_HOURS = 49
# Open-Meteo serves 600 locations a minute. Staying well under it leaves room for other plans.
MAX_WEATHER_CELLS = 450
# Finest grid first: a coarser grid makes the heatmap blocky, so use one only when it has to fit.
CELL_SIZES = (0.25, 0.5, 1.0)
# A destination closer than this to the last interval checkpoint replaces that checkpoint.
MIN_CHECKPOINT_GAP_MI = 1.0


@dataclass(frozen=True)
class PlanRequest:
    origin: Place
    destination: Place
    departure: datetime
    load_lb: int
    interval_mi: int


@dataclass(frozen=True)
class _PreparedRoute:
    route_id: str
    option: RouteOption
    total_mi: float
    checkpoint_miles: list[float]
    covers_mi: list[float]
    checkpoint_points: list[TrackPoint]


def plan_trip(request: PlanRequest, providers: Providers) -> Plan:
    options = providers.routes(
        request.origin, request.destination, request.departure, request.load_lb
    )[:3]
    if not options:
        raise NoRouteError()

    start_hour = request.departure.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    latest_arrival = max(
        request.departure + timedelta(seconds=option.duration_s) for option in options
    )
    forecast_end = max(
        start_hour + timedelta(hours=HEATMAP_HOURS - 1), latest_arrival + timedelta(hours=1)
    )
    forecast_end = forecast_end.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    forecast_end += timedelta(hours=1)

    prepared_routes: list[_PreparedRoute] = []
    for index, option in enumerate(options):
        cumulative = cumulative_miles(option.track)
        total_mi = cumulative[-1]
        checkpoint_miles = _checkpoint_miles(total_mi, request.interval_mi)
        checkpoint_points = [
            point_and_time_at(option.track, cumulative, mile) for mile in checkpoint_miles
        ]
        prepared_routes.append(
            _PreparedRoute(
                route_id="ABC"[index],
                option=option,
                total_mi=total_mi,
                checkpoint_miles=checkpoint_miles,
                covers_mi=covered_miles(checkpoint_miles, total_mi),
                checkpoint_points=checkpoint_points,
            )
        )

    tracks = [option.track for option in options]
    all_checkpoint_points = [
        point for prepared in prepared_routes for point in prepared.checkpoint_points
    ]
    cell_deg, weather_cells = _weather_cells(tracks, all_checkpoint_points)
    hourly_by_cell = providers.hourly(weather_cells, start_hour, forecast_end)

    routes: list[Route] = []
    for prepared in prepared_routes:
        checkpoints: list[Checkpoint] = []
        for mile, covers_mi, (lon, lat, seconds) in zip(
            prepared.checkpoint_miles, prepared.covers_mi, prepared.checkpoint_points, strict=True
        ):
            eta = request.departure + timedelta(seconds=seconds)
            weather = _weather_at_hour(
                hourly_by_cell[cell_of(lon, lat, cell_deg)], forecast_index(eta, start_hour)
            )
            assessment = classify(weather, request.load_lb)
            checkpoints.append(
                Checkpoint(
                    mile=mile,
                    lon=lon,
                    lat=lat,
                    eta=eta,
                    covers_mi=covers_mi,
                    weather=weather,
                    levels=assessment.levels,
                    level=assessment.level,
                    cause=assessment.cause,
                )
            )
        routes.append(
            Route(
                id=prepared.route_id,
                name=prepared.option.name,
                distance_mi=prepared.total_mi,
                duration_s=prepared.option.duration_s,
                arrival=request.departure + timedelta(seconds=prepared.option.duration_s),
                track=thin_track(prepared.option.track),
                checkpoints=checkpoints,
                summary=summarize(checkpoints, prepared.total_mi),
            )
        )

    heatmap_cells = []
    for cell in weather_cells:
        levels = [
            classify(_weather_at_hour(hourly_by_cell[cell], hour), request.load_lb).level
            for hour in range(HEATMAP_HOURS)
        ]
        heatmap_cells.append(HeatmapCell(lon=cell[0], lat=cell[1], levels=levels))

    ranked, reason = rank(routes)
    return Plan(
        departure=request.departure,
        load_lb=request.load_lb,
        interval_mi=request.interval_mi,
        recommended_id=ranked[0].id,
        reason=reason,
        routes=ranked,
        heatmap=Heatmap(cell_deg=cell_deg, start=start_hour, cells=heatmap_cells),
    )


def forecast_index(when: datetime, start_hour: datetime) -> int:
    """The forecast hour nearest this time. A time exactly halfway goes to the later hour."""
    return floor((when - start_hour).total_seconds() / 3600 + 0.5)


def _checkpoint_miles(total_mi: float, interval_mi: int) -> list[float]:
    miles = [0.0]
    mile = float(interval_mi)
    while mile < total_mi - MIN_CHECKPOINT_GAP_MI:
        miles.append(mile)
        mile += interval_mi
    miles.append(total_mi)
    return miles


def _weather_cells(
    tracks: list[list[TrackPoint]], checkpoint_points: list[TrackPoint]
) -> tuple[float, list[Cell]]:
    """The cells to fetch weather for, and the finest grid that fits MAX_WEATHER_CELLS."""
    cell_deg, cells = CELL_SIZES[-1], []
    for candidate in CELL_SIZES:
        cell_deg, cells = candidate, _cells_on_grid(tracks, checkpoint_points, candidate)
        if len(cells) <= MAX_WEATHER_CELLS:
            break
    # If even the coarsest grid is too large, keep it; the provider reports its rate limit.
    return cell_deg, cells


def _cells_on_grid(
    tracks: list[list[TrackPoint]], checkpoint_points: list[TrackPoint], cell_deg: float
) -> list[Cell]:
    """Corridor cells, plus any checkpoint cell the corridor left out."""
    cells = set(corridor_cells(tracks, cell_deg))
    missing = {cell_of(lon, lat, cell_deg) for lon, lat, _seconds in checkpoint_points} - cells
    cells |= missing
    return sorted(cells, key=lambda cell: (cell[1], cell[0]))


def _weather_at_hour(hourly: list[Weather], index: int) -> Weather:
    raw = hourly[min(max(index, 0), len(hourly) - 1)]
    # Classify the rounded numbers the user sees, so "35.0 mph" is never scored as Moderate.
    return Weather(
        wind_mph=round(raw.wind_mph, 1),
        gust_mph=round(raw.gust_mph, 1),
        rain_in_hr=round(raw.rain_in_hr, 2),
        snow_in_hr=round(raw.snow_in_hr, 2),
    )
