"""Open-Meteo hourly forecast, cached per cell and hour."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from django.core.cache import cache

from trips.domain import Cell, Weather
from trips.remote import (
    Json,
    ProviderError,
    as_dict,
    as_float,
    as_list,
    chunks,
    get_json,
    on_hour,
)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPENMETEO_FIELDS = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")
MAX_GAP_FILL_HOURS = 3
WEATHER_CACHE_SECONDS = 30 * 60


def hourly(cells: list[Cell], start: datetime, end: datetime) -> dict[Cell, list[Weather]]:
    start = on_hour(start)
    hours = max(1, int((on_hour(end) - start).total_seconds() // 3600) + 1)

    series: dict[Cell, list[Weather]] = {}
    missing: list[Cell] = []
    for cell in cells:
        cached = _cached_series(cell, start, hours)
        if cached is not None:
            series[cell] = cached
        else:
            missing.append(cell)

    with ThreadPoolExecutor(max_workers=4) as pool:
        for fetched in pool.map(lambda chunk: _fetch(chunk, start, hours), chunks(missing, 100)):
            series.update(fetched)
    return series


def _cached_series(cell: Cell, start: datetime, hours: int) -> list[Weather] | None:
    values = [cache.get(_cache_key(cell, start + timedelta(hours=hour))) for hour in range(hours)]
    return None if any(value is None for value in values) else values


def _fetch(cells: list[Cell], start: datetime, hours: int) -> dict[Cell, list[Weather]]:
    end = start + timedelta(hours=hours - 1)
    data = get_json(
        OPEN_METEO_URL,
        {
            "latitude": ",".join(f"{cell[1]:.2f}" for cell in cells),
            "longitude": ",".join(f"{cell[0]:.2f}" for cell in cells),
            "hourly": ",".join(OPENMETEO_FIELDS),
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "GMT",
            "start_hour": start.strftime("%Y-%m-%dT%H:%M"),
            "end_hour": end.strftime("%Y-%m-%dT%H:%M"),
        },
        "The weather service",
    )
    items = [data] if isinstance(data, dict) else data
    if not isinstance(items, list) or len(items) != len(cells):
        raise ProviderError("The weather service returned an unexpected response.")

    result = {}
    for cell, item in zip(cells, items, strict=True):
        if not isinstance(item, dict):
            raise ProviderError("The weather service returned an unexpected response.")
        hourly_block = as_dict(item.get("hourly"))
        times = as_list(hourly_block.get("time"))
        fields = {name: as_list(hourly_block.get(name)) for name in OPENMETEO_FIELDS}
        if (
            not times
            or not isinstance(times[0], str)
            or any(len(values) != len(times) for values in fields.values())
        ):
            raise ProviderError("The weather service returned an unexpected response.")

        try:
            first = datetime.fromisoformat(times[0]).replace(tzinfo=UTC)
        except ValueError:
            raise ProviderError("The weather service returned an unexpected response.") from None
        if first != start or len(times) != hours:
            raise ProviderError("The weather service returned an unexpected response.")

        series = {name: _fill_gaps(fields[name]) for name in OPENMETEO_FIELDS}
        wind = series["wind_speed_10m"]
        rain = series["rain"]
        showers = series["showers"]
        snow = series["snowfall"]
        gust = series["wind_gusts_10m"] or wind
        if wind is None or rain is None or showers is None or snow is None or gust is None:
            raise ProviderError("The weather service returned incomplete data.")

        forecast = []
        for hour in range(hours):
            weather = Weather(
                wind_mph=wind[hour],
                gust_mph=gust[hour],
                rain_in_hr=rain[hour] + showers[hour],
                snow_in_hr=snow[hour],
            )
            forecast.append(weather)
            cache.set(
                _cache_key(cell, start + timedelta(hours=hour)),
                weather,
                WEATHER_CACHE_SECONDS,
            )
        result[cell] = forecast
    return result


def _fill_gaps(readings: list[Json]) -> list[float] | None:
    known = [index for index, reading in enumerate(readings) if as_float(reading) is not None]
    if not known:
        return None
    filled = []
    for index, reading in enumerate(readings):
        value = as_float(reading)
        if value is not None:
            filled.append(value)
            continue
        nearest = min(known, key=lambda other: abs(other - index))
        if abs(nearest - index) > MAX_GAP_FILL_HOURS:
            raise ProviderError("The weather service returned incomplete data.")
        nearest_value = as_float(readings[nearest])
        if nearest_value is None:
            raise ProviderError("The weather service returned incomplete data.")
        filled.append(nearest_value)
    return filled


def _cache_key(cell: Cell, when: datetime) -> str:
    return f"weather:{cell[0]:.2f}:{cell[1]:.2f}:{when.astimezone(UTC):%Y-%m-%dT%H}"
