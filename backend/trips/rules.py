from trips.domain import Level, Levels, Route, RouteSummary, Weather

# Rows are (lower bound, level). A value equal to a bound takes the higher band.
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


def _band_level(value: float, bands: tuple[tuple[float, Level], ...], top: float) -> Level:
    level = Level.LOW
    for lower, band in bands:
        if value >= lower:
            level = band
    if value > top:
        level = Level.NO_TRAVEL
    return level


def _wind_level(mph: float) -> Level:
    return _band_level(mph, WIND_BANDS, 55.0)


def _rain_level(in_hr: float) -> Level:
    return _band_level(in_hr, RAIN_BANDS, 1.00)


def _snow_level(in_hr: float) -> Level:
    return _band_level(in_hr, SNOW_BANDS, 3.0)


# (lowest wind, highest wind, loads above this weight, level). The table's own bands still apply.
LOAD_RULES = (
    (45.0, 55.0, 30_000, Level.NO_TRAVEL),
    (35.0, 45.0, 40_000, Level.SEVERE),
)


def _load_level(mph: float, load_lb: int) -> Level | None:
    for low, high, over_lb, level in LOAD_RULES:
        if low <= mph < high and load_lb > over_lb:
            return level
    return None


def classify(weather: Weather, load_lb: int) -> tuple[Levels, Level, str]:
    load_level = _load_level(weather.wind_mph, load_lb)
    wind = max(_wind_level(weather.wind_mph), load_level or Level.LOW)

    levels = Levels(
        wind=wind,
        rain=_rain_level(weather.rain_in_hr),
        snow=_snow_level(weather.snow_in_hr),
    )
    level = max(levels.wind, levels.rain, levels.snow)

    if levels.wind == level:
        cause = f"wind {weather.wind_mph:.1f} mph"
        if load_level is not None:
            cause += f" with {load_lb:,} lb load"
    elif levels.snow == level:
        cause = f"snow {weather.snow_in_hr:.2f} in/hr"
    else:
        cause = f"rain {weather.rain_in_hr:.2f} in/hr"
    return levels, level, cause


def covered_miles(miles: list[float], total_mi: float) -> list[float]:
    """Each checkpoint owns half the gap to its neighbours, so the parts sum to the route."""
    covers = []
    for index, mile in enumerate(miles):
        previous = miles[index - 1] if index else mile
        following = miles[index + 1] if index + 1 < len(miles) else total_mi
        covers.append((following - previous) / 2)
    return covers


def summarize(route: Route) -> RouteSummary:
    by_level = [0.0] * 5
    score = 0.0
    for checkpoint in route.checkpoints:
        by_level[checkpoint.level] += checkpoint.covers_mi
        score += int(checkpoint.level) * checkpoint.covers_mi
    worst = max(checkpoint.level for checkpoint in route.checkpoints)
    return RouteSummary(
        miles_by_level=tuple(round(miles, 1) for miles in by_level),
        avg_risk=round(score / route.distance_mi, 2),
        worst=worst,
    )


def _key(route: Route) -> tuple[float, float, float, float, int]:
    miles = route.summary.miles_by_level
    return (
        miles[Level.NO_TRAVEL],
        miles[Level.SEVERE],
        miles[Level.HIGH],
        route.summary.avg_risk,
        route.duration_s,
    )


def _number(value: float) -> str:
    return f"{value:g}"


def _why_better(winner: Route, other: Route) -> str:
    """Names the first ranking key where the winner beats the other route."""
    ours, theirs = winner.summary.miles_by_level, other.summary.miles_by_level
    for level, label in (
        (Level.NO_TRAVEL, "No Travel"),
        (Level.SEVERE, "Severe"),
        (Level.HIGH, "High"),
    ):
        if ours[level] != theirs[level]:
            return (
                f"fewer {label} miles than Route {other.id} "
                f"({_number(ours[level])} vs {_number(theirs[level])})"
            )
    if winner.summary.avg_risk != other.summary.avg_risk:
        return (
            f"lower average risk than Route {other.id} "
            f"({winner.summary.avg_risk:.2f} vs {other.summary.avg_risk:.2f})"
        )
    if winner.duration_s != other.duration_s:
        gap_s = other.duration_s - winner.duration_s
        gap = f"{round(gap_s / 60)} min" if gap_s >= 60 else f"{gap_s} s"
        return f"same weather risk as Route {other.id} but {gap} faster"
    return f"ties Route {other.id} on every key"


def rank(routes: list[Route]) -> tuple[list[Route], str]:
    ranked = sorted(routes, key=_key)
    if len(ranked) < 2:
        return ranked, "Only one route was found."
    winner = ranked[0]
    reasons = "; ".join(_why_better(winner, other) for other in ranked[1:])
    return ranked, f"Route {winner.id}: {reasons}."
