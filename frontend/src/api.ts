
export type Level = 0 | 1 | 2 | 3 | 4;
export type IntervalMi = 10 | 25 | 50;

export interface Place {
  label: string;
  lon: number;
  lat: number;
}

export interface Weather {
  wind_mph: number;
  gust_mph: number;
  rain_in_hr: number;
  snow_in_hr: number;
}

interface CheckpointLevels {
  wind: Level;
  rain: Level;
  snow: Level;
}

export interface Checkpoint {
  mile: number;
  lon: number;
  lat: number;
  eta: string;
  covers_mi: number;
  weather: Weather;
  levels: CheckpointLevels;
  level: Level;
  cause: string;
}

export type TrackPoint = [lon: number, lat: number, seconds: number];

export interface RouteSummary {
  miles_by_level: [number, number, number, number, number];
  avg_risk: number;
  worst: Level;
}

export interface Route {
  id: string;
  name: string;
  distance_mi: number;
  duration_s: number;
  arrival: string;
  track: TrackPoint[];
  checkpoints: Checkpoint[];
  summary: RouteSummary;
}

interface HeatmapCell {
  lon: number;
  lat: number;
  levels: Level[];
}

export function maxHeatHour(plan: PlanResponse): number {
  const levels = plan.heatmap.cells[0]?.levels;
  return Math.max(0, (levels?.length ?? 1) - 1);
}

export interface Heatmap {
  cell_deg: number;
  start: string;
  cells: HeatmapCell[];
}

export interface PlanResponse {
  departure: string;
  load_lb: number;
  interval_mi: IntervalMi;
  recommended_id: string;
  reason: string;
  routes: Route[];
  heatmap: Heatmap;
}

export interface PlanRequest {
  origin: Place;
  destination: Place;
  departure: string;
  load_lb: number;
  interval_mi: IntervalMi;
  demo?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlace(value: unknown): value is Place {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    typeof value.lon === "number" &&
    typeof value.lat === "number"
  );
}

function isPlanResponse(value: unknown): value is PlanResponse {
  if (!isRecord(value) || !Array.isArray(value.routes) || value.routes.length === 0) {
    return false;
  }
  const routesReadable = value.routes.every(
    (route) =>
      isRecord(route) &&
      Array.isArray(route.track) &&
      Array.isArray(route.checkpoints) &&
      isRecord(route.summary) &&
      Array.isArray(route.summary.miles_by_level),
  );
  return (
    routesReadable &&
    typeof value.recommended_id === "string" &&
    typeof value.reason === "string" &&
    isRecord(value.heatmap) &&
    Array.isArray(value.heatmap.cells)
  );
}

function isErrorPayload(payload: unknown): payload is { error: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  );
}

async function errorFrom(response: Response): Promise<Error> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
  }
  if (isErrorPayload(payload)) {
    return new Error(payload.error);
  }
  return new Error(`The planning server returned an error (${response.status}).`);
}

export async function geocode(query: string, signal?: AbortSignal): Promise<Place[]> {
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) {
    throw await errorFrom(response);
  }
  let places: unknown;
  try {
    places = await response.json();
  } catch {
    throw new Error("The planning server sent an unreadable response.");
  }
  if (!Array.isArray(places) || !places.every(isPlace)) {
    throw new Error("The planning server sent an unreadable response.");
  }
  return places;
}

export async function planTrip(body: PlanRequest, signal?: AbortSignal): Promise<PlanResponse> {
  const response = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw await errorFrom(response);
  }
  let plan: unknown;
  try {
    plan = await response.json();
  } catch {
    throw new Error("The planning server sent an unreadable response.");
  }
  if (!isPlanResponse(plan)) {
    throw new Error("The planning server sent an unreadable response.");
  }
  return plan;
}
