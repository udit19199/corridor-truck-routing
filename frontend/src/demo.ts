import type { PlanRequest } from "./api";

/**
 * The storm demo: the server's recorded Dallas to Chicago routes under its scripted storm
 * (DESIGN.md 5.3). Live weather is often calm everywhere, which hides the risk and load
 * rules; the demo shows them on any day.
 */

/** 40,000 lb and under keeps 35-44 mph wind at High; above it, the load rule makes it Severe. */
export const DEMO_LOADS = [20_000, 45_000] as const;
export type DemoLoad = (typeof DEMO_LOADS)[number];

export function demoRequest(loadLb: DemoLoad): PlanRequest {
  const departure = new Date();
  departure.setMinutes(0, 0, 0);
  departure.setHours(departure.getHours() + 1);
  return {
    origin: { label: "Dallas, TX", lon: -96.797, lat: 32.7767 },
    destination: { label: "Chicago, IL", lon: -87.6298, lat: 41.8781 },
    departure: departure.toISOString(),
    load_lb: loadLb,
    interval_mi: 25,
    demo: true,
  };
}
