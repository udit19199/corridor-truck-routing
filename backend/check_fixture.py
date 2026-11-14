# ruff: noqa: E402
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from trips.domain import Level, Place, Plan, Route
from trips.geometry import cell_of
from trips.planner import HEATMAP_HOURS, PlanRequest, forecast_index, plan_trip
from trips.providers import get_providers

ORIGIN = Place("Dallas, TX", -96.797, 32.7767)
DESTINATION = Place("Chicago, IL", -87.6298, 41.8781)
DEPARTURE = datetime(2026, 11, 13, 12, 30, tzinfo=UTC)


def plan_for(load_lb: int) -> tuple[Plan, float]:
    request = PlanRequest(
        origin=ORIGIN,
        destination=DESTINATION,
        departure=DEPARTURE,
        load_lb=load_lb,
        interval_mi=25,
    )
    started = time.perf_counter()
    plan = plan_trip(request, get_providers())
    return plan, (time.perf_counter() - started) * 1000


def show(plan: Plan, elapsed_ms: float) -> None:
    print(f"\nload_lb={plan.load_lb:,}  departure={plan.departure.isoformat()}")
    for route in plan.routes:
        minutes = route.duration_s // 60
        miles = ", ".join(f"{value:g}" for value in route.summary.miles_by_level)
        print(
            f"  {route.id}  {route.name:<12} {route.distance_mi:7.1f} mi  "
            f"{minutes // 60}h{minutes % 60:02d}m  miles_by_level=[{miles}]  "
            f"avg_risk={route.summary.avg_risk:.2f}  worst={route.summary.worst.name}"
        )
    print(f"  recommended {plan.recommended_id}: {plan.reason}")
    print(f"  plan took {elapsed_ms:.0f} ms")


def check(plan_light: Plan, plan_heavy: Plan) -> list[str]:
    failures = []

    miles = {route.id: route.summary.miles_by_level for route in plan_light.routes}
    if any(values[Level.SEVERE] or values[Level.NO_TRAVEL] for values in miles.values()):
        failures.append("a: a route has Severe or No Travel miles at 20,000 lb")
    high = [values[Level.HIGH] for values in miles.values()]
    if high[0] >= high[1] or "High" not in plan_light.reason:
        failures.append("a: recommendation is not decided by fewer High miles")
    if plan_light.recommended_id != "A":
        failures.append(
            f"a: Route A is not recommended at 20,000 lb, got {plan_light.recommended_id}"
        )

    light_winner_severe_mi = next(
        route for route in plan_heavy.routes if route.id == plan_light.recommended_id
    ).summary.miles_by_level[Level.SEVERE]
    if light_winner_severe_mi <= 0:
        failures.append(f"b: Route {plan_light.recommended_id} has no Severe miles at 45,000 lb")
    if plan_heavy.recommended_id == plan_light.recommended_id:
        failures.append("b: the recommended route did not change at 45,000 lb")
    if plan_heavy.recommended_id != "B":
        failures.append(
            f"b: Route B is not recommended at 45,000 lb, got {plan_heavy.recommended_id}"
        )
    if "Severe" not in plan_heavy.reason:
        failures.append("b: the reason does not name the Severe miles")

    levels = [level for cell in plan_light.heatmap.cells for level in cell.levels]
    moving = sum(
        1
        for cell in plan_light.heatmap.cells
        if any(level != cell.levels[0] for level in cell.levels[1:])
    )
    if max(levels) < Level.HIGH:
        failures.append("c: the heatmap never reaches High")
    if moving < 10:
        failures.append("c: the heatmap barely changes over 48 hours")

    routes = [route for plan in (plan_light, plan_heavy) for route in plan.routes]
    covered_failures = _check_covered_miles(routes)
    level_failures = _check_checkpoint_levels(plan_light) + _check_checkpoint_levels(plan_heavy)
    failures += covered_failures + level_failures
    worst_gap = max(
        abs(sum(checkpoint.covers_mi for checkpoint in route.checkpoints) - route.distance_mi)
        for route in routes
    )

    print("\nchecks")
    print(f"  a, 20,000 lb: Severe/No Travel miles = 0, High miles = {high}")
    print(
        f"  b, 45,000 lb: Route {plan_light.recommended_id} Severe miles = "
        f"{light_winner_severe_mi:g}, recommended = {plan_heavy.recommended_id}"
    )
    print(
        f"  c: {len(plan_light.heatmap.cells)} cells, max level {Level(max(levels)).name}, "
        f"{moving} cells change over 48 h"
    )
    print(
        "  hourly max level:",
        "".join(
            str(max(level for level in levels[hour::HEATMAP_HOURS]))
            for hour in range(HEATMAP_HOURS)
        ),
    )
    print(f"  d: largest covered-miles gap {worst_gap:.3f} mi over {len(routes)} routes")
    checkpoint_count = sum(len(route.checkpoints) for route in routes)
    print(
        f"  e: {checkpoint_count - len(level_failures)} of {checkpoint_count} checkpoints "
        f"match their cell at the nearest slider hour"
    )
    return failures


def _check_covered_miles(routes: list[Route]) -> list[str]:
    failures = []
    for route in routes:
        covered = sum(checkpoint.covers_mi for checkpoint in route.checkpoints)
        if abs(covered - route.distance_mi) > 0.1:
            failures.append(
                f"d: Route {route.id} covers {covered:.2f} mi of a {route.distance_mi:.2f} mi route"
            )
    return failures


def _check_checkpoint_levels(plan: Plan) -> list[str]:
    cell_levels = {(cell.lon, cell.lat): cell.levels for cell in plan.heatmap.cells}
    failures = []
    for route in plan.routes:
        for checkpoint in route.checkpoints:
            cell = cell_of(checkpoint.lon, checkpoint.lat, plan.heatmap.cell_deg)
            hour = forecast_index(checkpoint.eta, plan.heatmap.start)
            hour = min(max(hour, 0), HEATMAP_HOURS - 1)
            if cell_levels[cell][hour] != checkpoint.level:
                failures.append(
                    f"e: Route {route.id} mile {checkpoint.mile:.0f} is {checkpoint.level.name}, "
                    f"but its cell is {cell_levels[cell][hour].name} at slider hour {hour}"
                )
    return failures


def main() -> int:
    plan_light, elapsed_light = plan_for(20_000)
    plan_heavy, elapsed_heavy = plan_for(45_000)
    show(plan_light, elapsed_light)
    show(plan_heavy, elapsed_heavy)

    failures = check(plan_light, plan_heavy)
    if not failures:
        print("  all checks passed")
        return 0
    for failure in failures:
        print(f"  FAIL {failure}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
