import type { PlanRequest } from "../api";
import { nextHourInputValue } from "./format";

export const DEMO_LOADS = [20_000, 45_000] as const;
export type DemoLoad = (typeof DEMO_LOADS)[number];

export function demoRequest(loadLb: DemoLoad): PlanRequest {
  return {
    origin: { label: "Dallas, TX", lon: -96.797, lat: 32.7767 },
    destination: { label: "Chicago, IL", lon: -87.6298, lat: 41.8781 },
    departure: new Date(nextHourInputValue()).toISOString(),
    load_lb: loadLb,
    interval_mi: 25,
    demo: true,
  };
}
