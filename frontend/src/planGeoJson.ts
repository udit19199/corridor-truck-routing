/**
 * Plan data as GeoJSON for the map sources. Pure functions over the API payload,
 * so the layer installer and the component stay free of geometry.
 */
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
  Position,
} from "geojson";
import type { Level, PlanResponse, TrackPoint } from "./api";

export interface RouteProperties {
  routeId: string;
}

export interface CheckpointProperties {
  routeId: string;
  checkpointIndex: number;
  level: Level;
}

export interface TruckProperties {
  routeId: string;
}

export interface PlanLayers {
  /**
   * Heat cell polygons only. A cell's feature id is its index in
   * `plan.heatmap.cells`, and the hour rides on feature state, so the slider
   * never rewrites this data or a paint property.
   */
  heat: FeatureCollection<Polygon>;
  routes: FeatureCollection<LineString, RouteProperties>;
  checkpoints: FeatureCollection<Point, CheckpointProperties>;
}

/** The map sources' contents when no plan is on screen. */
export const NO_PLAN: PlanLayers = {
  heat: { type: "FeatureCollection", features: [] },
  routes: { type: "FeatureCollection", features: [] },
  checkpoints: { type: "FeatureCollection", features: [] },
};

interface LonLat {
  lon: number;
  lat: number;
}

/** Position at a time, interpolated between the two nearest track points. */
function pointAt(track: TrackPoint[], seconds: number): LonLat | null {
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  // Before departure, seconds is negative and the truck waits at the origin.
  if (seconds <= first[2]) {
    return { lon: first[0], lat: first[1] };
  }
  if (seconds >= last[2]) {
    return { lon: last[0], lat: last[1] };
  }

  let low = 0;
  let high = track.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const point = track[middle];
    if (point === undefined) {
      break;
    }
    if (point[2] < seconds) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const after = track[low];
  const before = track[low - 1];
  if (after === undefined || before === undefined) {
    return { lon: last[0], lat: last[1] };
  }
  const span = after[2] - before[2];
  const fraction = span > 0 ? (seconds - before[2]) / span : 0;
  return {
    lon: before[0] + (after[0] - before[0]) * fraction,
    lat: before[1] + (after[1] - before[1]) * fraction,
  };
}

function heatCells(plan: PlanResponse): Feature<Polygon>[] {
  const half = plan.heatmap.cell_deg / 2;
  return plan.heatmap.cells.map((cell, index) => {
    const ring: Position[] = [
      [cell.lon - half, cell.lat - half],
      [cell.lon + half, cell.lat - half],
      [cell.lon + half, cell.lat + half],
      [cell.lon - half, cell.lat + half],
      [cell.lon - half, cell.lat - half],
    ];
    return {
      type: "Feature",
      id: index,
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  });
}

export function buildPlanLayers(plan: PlanResponse): PlanLayers {
  const routes: Feature<LineString, RouteProperties>[] = plan.routes.map(
    (route) => ({
      type: "Feature",
      properties: { routeId: route.id },
      geometry: {
        type: "LineString",
        coordinates: route.track.map(([lon, lat]) => [lon, lat]),
      },
    }),
  );

  const checkpoints: Feature<Point, CheckpointProperties>[] = [];
  for (const route of plan.routes) {
    route.checkpoints.forEach((checkpoint, checkpointIndex) => {
      checkpoints.push({
        type: "Feature",
        properties: {
          routeId: route.id,
          checkpointIndex,
          level: checkpoint.level,
        },
        geometry: {
          type: "Point",
          coordinates: [checkpoint.lon, checkpoint.lat],
        },
      });
    });
  }

  return {
    heat: { type: "FeatureCollection", features: heatCells(plan) },
    routes: { type: "FeatureCollection", features: routes },
    checkpoints: { type: "FeatureCollection", features: checkpoints },
  };
}

/**
 * One truck per route at the hour's position. Hour 0 is `heatmap.start`, which
 * may sit before the departure, so the first hours can show a truck at the origin.
 * A route that has arrived has no truck.
 */
export function truckFeatures(
  plan: PlanResponse,
  hour: number,
): FeatureCollection<Point, TruckProperties> {
  const secondsAtHourZero =
    (Date.parse(plan.heatmap.start) - Date.parse(plan.departure)) / 1000;
  const seconds = secondsAtHourZero + hour * 3_600;
  const features: Feature<Point, TruckProperties>[] = [];

  for (const route of plan.routes) {
    const arrival = route.track[route.track.length - 1]?.[2] ?? route.duration_s;
    if (seconds > arrival) {
      continue;
    }
    const position = pointAt(route.track, seconds);
    if (position === null) {
      continue;
    }
    features.push({
      type: "Feature",
      properties: { routeId: route.id },
      geometry: { type: "Point", coordinates: [position.lon, position.lat] },
    });
  }

  return { type: "FeatureCollection", features };
}
