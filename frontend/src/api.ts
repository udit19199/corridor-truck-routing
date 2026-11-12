/**
 * The single copy of the API contract from DESIGN.md section 3.
 * The Django API is the contract owner; these types mirror it.
 */

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

export interface CheckpointLevels {
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

/** `[lon, lat, seconds after departure]` */
export type TrackPoint = [lon: number, lat: number, seconds: number];

export interface RouteSummary {
  /** Index is the Level: 0 Low, 1 Moderate, 2 High, 3 Severe, 4 No Travel. */
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

export interface HeatmapCell {
  lon: number;
  lat: number;
  /** One level per forecast hour, from hour 0 up. */
  levels: Level[];
}

/** The last forecast hour the heatmap covers, from the levels a cell carries. */
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
  /** In ranking order, recommended first. */
  routes: Route[];
  heatmap: Heatmap;
}

export interface PlanRequest {
  origin: Place;
  destination: Place;
  departure: string;
  load_lb: number;
  interval_mi: IntervalMi;
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
    // A proxy or crash can return HTML; the status still tells the user something.
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
  let places: Place[];
  try {
    places = await response.json();
  } catch {
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
  let plan: PlanResponse;
  try {
    plan = await response.json();
  } catch {
    throw new Error("The planning server sent an unreadable response.");
  }
  return plan;
}
