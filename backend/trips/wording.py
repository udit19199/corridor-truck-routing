"""The sentences the driver reads: why the winner won, and what risk is left."""

from trips.domain import Level, Route

LEVEL_LABELS = {
    Level.NO_TRAVEL: "No Travel",
    Level.SEVERE: "Severe",
    Level.HIGH: "High",
}
# Worst first, the order routes are ranked on. Keep in step with rules._rank_key.
RANKED_LEVELS = (Level.NO_TRAVEL, Level.SEVERE, Level.HIGH)


def _miles(miles: float) -> str:
    return f"{miles:g}"


def _duration(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} s"
    minutes = round(seconds / 60)
    if minutes < 60:
        return f"{minutes} min"
    return f"{minutes // 60} h {minutes % 60:02d} min"


def _with_time_cost(text: str, winner: Route, other: Route) -> str:
    if winner.duration_s <= other.duration_s:
        return text
    return f"{text}, {_duration(winner.duration_s - other.duration_s)} slower"


def _why_better(winner: Route, other: Route) -> tuple[int, str]:
    ours, theirs = winner.summary.miles_by_level, other.summary.miles_by_level
    for position, level in enumerate(RANKED_LEVELS):
        if ours[level] < theirs[level]:
            return position, _with_time_cost(
                f"fewer {LEVEL_LABELS[level]} miles than Route {other.id} "
                f"({_miles(ours[level])} vs {_miles(theirs[level])})",
                winner,
                other,
            )
    if winner.summary.avg_risk < other.summary.avg_risk:
        return len(RANKED_LEVELS), _with_time_cost(
            f"lower average risk than Route {other.id} "
            f"({winner.summary.avg_risk:.2f} vs {other.summary.avg_risk:.2f})",
            winner,
            other,
        )
    if winner.duration_s < other.duration_s:
        return len(RANKED_LEVELS) + 1, (
            f"same weather risk as Route {other.id} "
            f"but {_duration(other.duration_s - winner.duration_s)} faster"
        )
    return len(RANKED_LEVELS) + 2, f"ties Route {other.id} on every key"


def _warning(winner: Route, *, single: bool = False) -> str:
    miles = winner.summary.miles_by_level
    parts = [
        f"{_miles(miles[level])} {LEVEL_LABELS[level]} miles"
        for level in RANKED_LEVELS[:2]
        if miles[level]
    ]
    if not parts:
        return ""
    if single:
        return f" It has {' and '.join(parts)}."
    return f" Even Route {winner.id} has {' and '.join(parts)}."


def reason(ranked: list[Route]) -> str:
    if not ranked:
        return "No routes were found."
    if len(ranked) < 2:
        return f"Only one route was found.{_warning(ranked[0], single=True)}"
    winner = ranked[0]
    comparisons = sorted(
        (_why_better(winner, other) for other in ranked[1:]),
        key=lambda comparison: comparison[0],
    )
    reasons = "; ".join(text for _position, text in comparisons)
    return f"Route {winner.id}: {reasons}.{_warning(winner)}"
