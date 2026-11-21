export type Level = 0 | 1 | 2 | 3 | 4;
export type IntervalMi = 10 | 25 | 50;

export interface Place {
  label: string;
  lon: number;
  lat: number;
}

interface Weather {
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

/** Elapsed seconds after departure, including stationary rest breaks. */
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
  /** Total elapsed trip time, including rest breaks. */
  duration_s: number;
  /** UTC arrival after driving and rest breaks. */
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

interface Heatmap {
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

export function maxHeatHour(plan: PlanResponse): number {
  const levels = plan.heatmap.cells[0]?.levels;
  return Math.max(0, (levels?.length ?? 1) - 1);
}

/** The slider hour closest to when the truck reaches this checkpoint. */
export function checkpointHour(plan: PlanResponse, checkpoint: Checkpoint): number {
  const hours = (Date.parse(checkpoint.eta) - Date.parse(plan.heatmap.start)) / 3_600_000;
  return Math.min(maxHeatHour(plan), Math.max(0, Math.round(hours)));
}

const UNREADABLE = "The planning server sent an unreadable response.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrorPayload(payload: unknown): payload is { error: string } {
  return isRecord(payload) && typeof payload.error === "string";
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(UNREADABLE);
  }
}

export async function geocode(query: string, signal?: AbortSignal): Promise<Place[]> {
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return (await readJson(response)) as Place[];
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
  return (await readJson(response)) as PlanResponse;
}
