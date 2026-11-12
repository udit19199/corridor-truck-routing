from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from trips.domain import (
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


@dataclass(frozen=True)
class _PreparedRoute:
    route_id: str
    option: RouteOption
    total_mi: float
    miles: list[float]
    covers: list[float]
    points: list[TrackPoint]


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
        prepared.append(
            _PreparedRoute(
                route_id="ABC"[index],
                option=option,
                total_mi=total_mi,
                miles=miles,
                covers=covers,
                points=points,
            )
        )

    cells = set(corridor_cells([option.track for option in options]))
    for item in prepared:
        cells.update(cell_of(lon, lat) for lon, lat, _seconds in item.points)
    cells = sorted(cells, key=lambda cell: (cell[1], cell[0]))
    series = providers.hourly(cells, start_hour, end)

    routes: list[Route] = []
    for item in prepared:
        checkpoints: list[Checkpoint] = []
        for mile, covers_mi, (lon, lat, seconds) in zip(
            item.miles, item.covers, item.points, strict=True
        ):
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
        routes.append(
            Route(
                id=item.route_id,
                name=item.option.name,
                distance_mi=item.total_mi,
                duration_s=item.option.duration_s,
                arrival=request.departure + timedelta(seconds=item.option.duration_s),
                track=item.option.track,
                checkpoints=checkpoints,
                summary=summarize(checkpoints, item.total_mi),
            )
        )

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
