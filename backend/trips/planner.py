from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta

from trips.domain import (
    Checkpoint,
    Heatmap,
    HeatmapCell,
    Level,
    Place,
    Plan,
    Route,
    RouteSummary,
    Weather,
)
from trips.geometry import CELL_DEG, cell_of, corridor_cells, cumulative_miles, point_and_time_at
from trips.providers import NoRouteError, Providers
from trips.rules import classify, covered_miles, rank, summarize

HEATMAP_HOURS = 49


@dataclass(frozen=True)
class PlanRequest:
    origin: Place
    destination: Place
    departure: datetime
    load_lb: int
    interval_mi: int


def plan_trip(request: PlanRequest, providers: Providers) -> Plan:
    options = providers.routes(
        request.origin, request.destination, request.departure, request.load_lb
    )[:3]
    if not options:
        raise NoRouteError("No route was found between these places.")

    start_hour = request.departure.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    latest_arrival = max(
        request.departure + timedelta(seconds=option.duration_s) for option in options
    )
    end = max(request.departure + timedelta(hours=48), latest_arrival + timedelta(hours=1))
    end = end.astimezone(UTC).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)

    prepared = []
    for index, option in enumerate(options):
        cumulative = cumulative_miles(option.track)
        total_mi = cumulative[-1]
        miles = _checkpoint_miles(total_mi, request.interval_mi)
        covers = covered_miles(miles, total_mi)
        points = [point_and_time_at(option.track, cumulative, mile) for mile in miles]
        prepared.append(("ABC"[index], option, total_mi, miles, covers, points))

    cells = set(corridor_cells([option.track for option in options]))
    for _route_id, _option, _total, _miles, _covers, points in prepared:
        cells.update(cell_of(lon, lat) for lon, lat, _seconds in points)
    cells = sorted(cells, key=lambda cell: (cell[1], cell[0]))
    series = providers.hourly(cells, start_hour, end)

    routes = []
    for route_id, option, total_mi, miles, covers, points in prepared:
        checkpoints = []
        for mile, covers_mi, (lon, lat, seconds) in zip(miles, covers, points, strict=True):
            eta = request.departure + timedelta(seconds=seconds)
            weather = _weather_at(series[cell_of(lon, lat)], start_hour, eta)
            levels, level, cause = classify(weather, request.load_lb)
            checkpoints.append(
                Checkpoint(
                    mile=mile,
                    lon=lon,
                    lat=lat,
                    eta=eta,
                    covers_mi=covers_mi,
                    weather=weather,
                    levels=levels,
                    level=level,
                    cause=cause,
                )
            )
        route = Route(
            id=route_id,
            name=option.name,
            distance_mi=total_mi,
            duration_s=option.duration_s,
            arrival=request.departure + timedelta(seconds=option.duration_s),
            track=option.track,
            checkpoints=checkpoints,
            summary=RouteSummary((0.0, 0.0, 0.0, 0.0, 0.0), 0.0, Level.LOW),
        )
        routes.append(replace(route, summary=summarize(route)))

    heatmap_cells = []
    for cell in cells:
        levels = [
            classify(
                _weather_at(series[cell], start_hour, request.departure + timedelta(hours=hour)),
                request.load_lb,
            )[1]
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
        heatmap=Heatmap(cell_deg=CELL_DEG, start=request.departure, cells=heatmap_cells),
    )


def _checkpoint_miles(total_mi: float, interval_mi: int) -> list[float]:
    miles = [0.0]
    mile = float(interval_mi)
    while mile < total_mi:
        miles.append(mile)
        mile += interval_mi
    miles.append(total_mi)
    return miles


def _weather_at(series: list[Weather], start_hour: datetime, when: datetime) -> Weather:
    index = round((when - start_hour).total_seconds() / 3600)
    raw = series[min(max(index, 0), len(series) - 1)]
    # Classify the rounded numbers the user sees, so "35.0 mph" is never scored as Moderate.
    return Weather(
        wind_mph=round(raw.wind_mph, 1),
        gust_mph=round(raw.gust_mph, 1),
        rain_in_hr=round(raw.rain_in_hr, 2),
        snow_in_hr=round(raw.snow_in_hr, 2),
    )
