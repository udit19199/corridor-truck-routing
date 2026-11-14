import type { PlanRequest } from "../api";

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
