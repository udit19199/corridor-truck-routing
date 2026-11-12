# ruff: noqa: E402
"""Sanity check for fixture mode.

Run with both providers on the fixture:
  ROUTING_PROVIDER=fixture WEATHER_PROVIDER=fixture uv run python scripts/check_fixture.py

Run against live Open-Meteo weather (assertions may fail, so skip them):
  ROUTING_PROVIDER=fixture uv run python scripts/check_fixture.py --no-assert
"""

import argparse
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from trips.domain import Level, Place, Plan
from trips.planner import PlanRequest, plan_trip
from trips.providers import get_providers

ORIGIN = Place("Dallas, TX", -96.797, 32.7767)
DESTINATION = Place("Chicago, IL", -87.6298, 41.8781)
DEPARTURE = datetime(2026, 11, 13, 12, tzinfo=UTC)


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

    light_winner = plan_light.recommended_id
    heavy_winner = next(
        route for route in plan_heavy.routes if route.id == light_winner
    ).summary.miles_by_level[Level.SEVERE]
    if heavy_winner <= 0:
        failures.append(f"b: Route {light_winner} has no Severe miles at 45,000 lb")
    if plan_heavy.recommended_id == light_winner:
        failures.append("b: the recommended route did not change at 45,000 lb")

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

    print("\nchecks")
    print(f"  a, 20,000 lb: Severe/No Travel miles = 0, High miles = {high}")
    print(
        f"  b, 45,000 lb: Route {light_winner} Severe miles = {heavy_winner:g}, "
        f"recommended = {plan_heavy.recommended_id}"
    )
    print(
        f"  c: {len(plan_light.heatmap.cells)} cells, max level {Level(max(levels)).name}, "
        f"{moving} cells change over 48 h"
    )
    print(
        "  hourly max level:",
        "".join(str(max(level for level in levels[h::49])) for h in range(49)),
    )
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-assert", action="store_true", help="print only, do not assert")
    args = parser.parse_args()

    plan_light, elapsed_light = plan_for(20_000)
    plan_heavy, elapsed_heavy = plan_for(45_000)
    show(plan_light, elapsed_light)
    show(plan_heavy, elapsed_heavy)

    failures = check(plan_light, plan_heavy)
    if not args.no_assert and failures:
        for failure in failures:
            print(f"  FAIL {failure}")
        return 1
    if failures:
        print("  assertions skipped (--no-assert)")
    else:
        print("  all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
