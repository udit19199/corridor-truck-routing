import type { IntervalMi, Place, PlanRequest } from "../api";
import { localDateTimeToIso } from "./format";

const MIN_LOAD_LB = 1;
export const MAX_LOAD_LB = 45_000;
export const EARLIEST_DEPARTURE_MS = 3_600_000;
export const LATEST_DEPARTURE_MS = 12 * 86_400_000;

export const FIELD_INPUT_IDS = {
  origin: "origin-input",
  destination: "destination-input",
  departure: "departure-input",
  load: "load-input",
} as const;

export type FieldKey = keyof typeof FIELD_INPUT_IDS;

const FIELD_ORDER: readonly FieldKey[] = [
  "origin",
  "destination",
  "departure",
  "load",
];

export type FormIssues = Partial<Record<FieldKey, string>>;

function milesBetween(a: Place, b: Place): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMi = 3958.7613;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusMi * Math.asin(Math.sqrt(h));
}

export function checkForm(
  now: Date,
  origin: Place | null,
  destination: Place | null,
  departureText: string,
  loadText: string,
  intervalMi: IntervalMi,
): { request: PlanRequest | null; issues: FormIssues } {
  const issues: FormIssues = {};

  const departureIso = localDateTimeToIso(departureText);
  if (departureIso === null) {
    issues.departure = "Choose a departure time.";
  } else {
    const departureMs = Date.parse(departureIso);
    const earliestMs = now.getTime() - EARLIEST_DEPARTURE_MS;
    const latestMs = now.getTime() + LATEST_DEPARTURE_MS;
    if (departureMs < earliestMs || departureMs > latestMs) {
      issues.departure =
        "Departure must be between 1 hour ago and 12 days from now.";
    }
  }

  const loadLb = Number(loadText);
  if (loadText.trim() === "") {
    issues.load = "Enter the cargo weight.";
  } else if (loadLb < MIN_LOAD_LB || loadLb > MAX_LOAD_LB) {
    issues.load = "Cargo weight must be between 1 and 45,000 lb.";
  } else if (!Number.isInteger(loadLb)) {
    issues.load = "Cargo weight must be a whole number of pounds.";
  }

  if (
    origin !== null &&
    destination !== null &&
    milesBetween(origin, destination) < 1
  ) {
    issues.destination = "Origin and destination must be at least 1 mile apart.";
  }

  if (
    origin === null ||
    destination === null ||
    departureIso === null ||
    Object.keys(issues).length > 0
  ) {
    return { request: null, issues };
  }

  return {
    request: {
      origin,
      destination,
      departure: departureIso,
      load_lb: loadLb,
      interval_mi: intervalMi,
    },
    issues,
  };
}

export function firstInvalidField(
  issues: FormIssues,
  origin: Place | null,
  destination: Place | null,
): FieldKey | null {
  for (const field of FIELD_ORDER) {
    if (field === "origin" && origin === null) {
      return field;
    }
    if (field === "destination" && destination === null) {
      return field;
    }
    if (issues[field] !== undefined) {
      return field;
    }
  }
  return null;
}
