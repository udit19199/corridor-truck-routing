from trips.domain import (
    Assessment,
    Checkpoint,
    Level,
    Levels,
    MilesByLevel,
    Route,
    RouteSummary,
    Weather,
)

# Rows are (lower bound, level). Equal to a lower bound takes that band;
# above the band's top edge (no_travel_above) is No Travel.
WIND_BANDS = (
    (25.0, Level.MODERATE),
    (35.0, Level.HIGH),
    (45.0, Level.SEVERE),
    (55.0, Level.NO_TRAVEL),
)
RAIN_BANDS = (
    (0.10, Level.MODERATE),
    (0.25, Level.HIGH),
    (0.50, Level.SEVERE),
)
SNOW_BANDS = ((0.5, Level.MODERATE), (1.0, Level.HIGH), (2.0, Level.SEVERE))


def _band_level(
    value: float, bands: tuple[tuple[float, Level], ...], no_travel_above: float
) -> Level:
    level = Level.LOW
    for lower, band in bands:
        if value >= lower:
            level = band
    if value > no_travel_above:
        level = Level.NO_TRAVEL
    return level


def _wind_level(mph: float) -> Level:
    return _band_level(mph, WIND_BANDS, 55.0)


def _rain_level(in_hr: float) -> Level:
    return _band_level(in_hr, RAIN_BANDS, 1.00)


def _snow_level(in_hr: float) -> Level:
    return _band_level(in_hr, SNOW_BANDS, 3.0)


# (wind from, wind below, loads above this weight, level). The table's own bands still apply.
LOAD_RULES = (
    (45.0, 55.0, 30_000, Level.NO_TRAVEL),
    (35.0, 45.0, 40_000, Level.SEVERE),
)


def _load_level(mph: float, load_lb: int) -> Level | None:
    for low, high, over_lb, level in LOAD_RULES:
        if low <= mph < high and load_lb > over_lb:
            return level
    return None


def classify(weather: Weather, load_lb: int) -> Assessment:
    load_level = _load_level(weather.wind_mph, load_lb)
    wind = max(_wind_level(weather.wind_mph), load_level or Level.LOW)

    levels = Levels(
        wind=wind,
        rain=_rain_level(weather.rain_in_hr),
        snow=_snow_level(weather.snow_in_hr),
    )
    level = max(levels.wind, levels.rain, levels.snow)

    if level == Level.LOW:
        cause = "no condition above Low"
    elif levels.wind == level:
        cause = f"wind {weather.wind_mph:.1f} mph"
        if load_level is not None:
            cause += f" with {load_lb:,} lb load"
    elif levels.snow == level:
        cause = f"snow {weather.snow_in_hr:.2f} in/hr"
    else:
        cause = f"rain {weather.rain_in_hr:.2f} in/hr"
    return Assessment(levels=levels, level=level, cause=cause)


def covered_miles(miles: list[float], total_mi: float) -> list[float]:
    """Each checkpoint owns half the gap to its neighbours, so the parts sum to the route."""
    covers = []
    for index, mile in enumerate(miles):
        previous = miles[index - 1] if index else mile
        following = miles[index + 1] if index + 1 < len(miles) else total_mi
        covers.append((following - previous) / 2)
    return covers


def summarize(checkpoints: list[Checkpoint], distance_mi: float) -> RouteSummary:
    by_level = [0.0] * 5
    score = 0.0
    for checkpoint in checkpoints:
        by_level[checkpoint.level] += checkpoint.covers_mi
        score += int(checkpoint.level) * checkpoint.covers_mi
    worst = max(checkpoint.level for checkpoint in checkpoints)
    miles_by_level: MilesByLevel = (
        round(by_level[Level.LOW], 1),
        round(by_level[Level.MODERATE], 1),
        round(by_level[Level.HIGH], 1),
        round(by_level[Level.SEVERE], 1),
        round(by_level[Level.NO_TRAVEL], 1),
    )
    return RouteSummary(
        miles_by_level=miles_by_level,
        avg_risk=round(score / distance_mi, 2),
        worst=worst,
    )


# Level names for the reason, worst first. These three decide the ranking before time does.
RISK_LEVELS = (
    (Level.NO_TRAVEL, "No Travel"),
    (Level.SEVERE, "Severe"),
    (Level.HIGH, "High"),
)
AVERAGE_RISK_KEY = len(RISK_LEVELS)
TIME_KEY = AVERAGE_RISK_KEY + 1
TIE_KEY = AVERAGE_RISK_KEY + 2


def _rank_key(route: Route) -> tuple[float, float, float, float, int]:
    miles = route.summary.miles_by_level
    return (
        miles[Level.NO_TRAVEL],
        miles[Level.SEVERE],
        miles[Level.HIGH],
        route.summary.avg_risk,
        route.duration_s,
    )


def _format_miles(miles: float) -> str:
    return f"{miles:g}"


def _format_duration(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} s"
    minutes = round(seconds / 60)
    if minutes < 60:
        return f"{minutes} min"
    return f"{minutes // 60} h {minutes % 60:02d} min"


def _with_time_cost(text: str, winner: Route, other: Route) -> str:
    """Adds the time the winner gives up, so the reason balances risk against time."""
    if winner.duration_s <= other.duration_s:
        return text
    return f"{text}, {_format_duration(winner.duration_s - other.duration_s)} slower"


def _why_better(winner: Route, other: Route) -> tuple[int, str]:
    """The most decisive key where the winner beats the other route, and the words for it."""
    ours, theirs = winner.summary.miles_by_level, other.summary.miles_by_level
    for order, (level, label) in enumerate(RISK_LEVELS):
        if ours[level] < theirs[level]:
            return order, _with_time_cost(
                f"fewer {label} miles than Route {other.id} "
                f"({_format_miles(ours[level])} vs {_format_miles(theirs[level])})",
                winner,
                other,
            )
    if winner.summary.avg_risk < other.summary.avg_risk:
        return AVERAGE_RISK_KEY, _with_time_cost(
            f"lower average risk than Route {other.id} "
            f"({winner.summary.avg_risk:.2f} vs {other.summary.avg_risk:.2f})",
            winner,
            other,
        )
    if winner.duration_s < other.duration_s:
        return TIME_KEY, (
            f"same weather risk as Route {other.id} "
            f"but {_format_duration(other.duration_s - winner.duration_s)} faster"
        )
    return TIE_KEY, f"ties Route {other.id} on every key"


def _warning(winner: Route) -> str:
    """Warns when the winner itself still carries No Travel or Severe miles."""
    miles = winner.summary.miles_by_level
    parts = [
        f"{_format_miles(miles[level])} {label} miles"
        for level, label in RISK_LEVELS[:2]
        if miles[level]
    ]
    if not parts:
        return ""
    return f" Even Route {winner.id} has {' and '.join(parts)}."


def rank(routes: list[Route]) -> tuple[list[Route], str]:
    # sorted() is stable, so routes that tie on every key keep the provider's order.
    ranked = sorted(routes, key=_rank_key)
    if len(ranked) < 2:
        return ranked, "Only one route was found."
    winner = ranked[0]
    comparisons = sorted(
        (_why_better(winner, other) for other in ranked[1:]),
        key=lambda comparison: comparison[0],
    )
    reasons = "; ".join(text for _order, text in comparisons)
    return ranked, f"Route {winner.id}: {reasons}.{_warning(winner)}"
