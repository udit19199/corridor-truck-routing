/**
 * MapLibre work for the route map, kept free of React so the component reads as
 * wiring only. Basemap tuning, the GeoJSON builders, layer install, filters,
 * paint swaps and the click helpers live here.
 */
import {
  LngLatBounds,
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
  Position,
} from "geojson";
import type { Checkpoint, Level, PlanResponse, TrackPoint } from "./api";
import { prefersReducedMotion } from "./format";
import { LEVELS } from "./levels";

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
const ACCENT = "#6aa8ff";
const ROUTE_IDLE = "#66778c";
const TRUCK = "#0f1722";
const TRUCK_RING = "#c2cedd";
const MAP_INK = "#0b1017";
const EMPTY_HOUR = 0;
const HOURS = 48;
export const NORTH_AMERICA: [number, number, number, number] = [-170, 5, -45, 78];

/**
 * Basemap layers a dispatcher never needs: building footprints, landuse detail,
 * minor roads and their labels, rail, airfields, piers. Place names, major
 * roads, water and boundaries stay. Removing them cuts per-frame draw work.
 */
const BASEMAP_DROP = new Set([
  "building",
  "landuse_residential",
  "landuse_park",
  "landcover_wood",
  "landcover_glacier",
  "landcover_ice_shelf",
  "aeroway-taxiway",
  "aeroway-runway-casing",
  "aeroway-area",
  "aeroway-runway",
  "road_area_pier",
  "road_pier",
  "highway_path",
  "highway_minor",
  "road_oneway",
  "road_oneway_opposite",
  "railway_transit",
  "railway_transit_dashline",
  "railway_minor",
  "railway_minor_dashline",
  "railway",
  "railway_dashline",
  "highway_name_other",
  "water_name",
  "place_suburb",
]);

export function pruneBasemap(map: MapLibreMap): void {
  for (const layer of map.getStyle().layers) {
    if (BASEMAP_DROP.has(layer.id)) {
      map.removeLayer(layer.id);
    }
  }
}

/**
 * The stock dark basemap paints its labels and boundaries at about 3:1 against
 * its own background, which is too dim to scan at a glance. Lift them once.
 */
const BASEMAP_PAINT: ReadonlyArray<readonly [string, string]> = [
  ["place_city_large", "#c6d0dc"],
  ["place_city", "#c6d0dc"],
  ["place_town", "#a8b4c2"],
  ["place_village", "#8e9aa8"],
  ["place_other", "#8e9aa8"],
  ["place_state", "#7f8c9c"],
  ["place_country_major", "#93a0b0"],
  ["place_country_minor", "#93a0b0"],
  ["place_country_other", "#93a0b0"],
  ["highway_name_motorway", "#93a3b6"],
];

const BASEMAP_LINES: ReadonlyArray<readonly [string, string]> = [
  ["boundary_state", "#37424e"],
  ["boundary_country_z0-4", "#47535f"],
  ["boundary_country_z5-", "#47535f"],
];

export function tuneBasemap(map: MapLibreMap): void {
  for (const [layer, color] of BASEMAP_PAINT) {
    if (map.getLayer(layer) !== undefined) {
      map.setPaintProperty(layer, "text-color", color);
    }
  }
  for (const [layer, color] of BASEMAP_LINES) {
    if (map.getLayer(layer) !== undefined) {
      map.setPaintProperty(layer, "line-color", color);
    }
  }
}

declare global {
  interface Window {
    __map?: MapLibreMap;
  }
}

export interface MapApi {
  setHour: (hour: number) => void;
  focusCheckpoint: (checkpoint: Checkpoint) => void;
}

/** Owned by App so slider and list input made while the map chunk loads is applied on load. */
export interface MapPending {
  hour: number;
  focus: Checkpoint | null;
}

interface LonLat {
  lon: number;
  lat: number;
}

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

/** One match expression for all risk paints, so colours never drift from the table. */
function levelMatchExpression(property: string): ExpressionSpecification {
  return [
    "match",
    ["get", property],
    0,
    LEVELS[0].color,
    1,
    LEVELS[1].color,
    2,
    LEVELS[2].color,
    3,
    LEVELS[3].color,
    4,
    LEVELS[4].color,
    LEVELS[0].color,
  ];
}

/** The slider reuses one expression per hour instead of rebuilding 49 branches. */
const hourExpressions = new globalThis.Map<number, ExpressionSpecification>();

function hourExpression(hour: number): ExpressionSpecification {
  let expression = hourExpressions.get(hour);
  if (expression === undefined) {
    expression = levelMatchExpression(`r${hour}`);
    hourExpressions.set(hour, expression);
  }
  return expression;
}

export function buildHeatData(
  plan: PlanResponse,
): FeatureCollection<Polygon, Record<string, number>> {
  const half = plan.heatmap.cell_deg / 2;
  const features: Feature<Polygon, Record<string, number>>[] = [];

  for (const cell of plan.heatmap.cells) {
    const properties: Record<string, number> = {};
    for (let hour = 0; hour <= HOURS; hour += 1) {
      properties[`r${hour}`] = cell.levels[hour] ?? 0;
    }
    const ring: Position[] = [
      [cell.lon - half, cell.lat - half],
      [cell.lon + half, cell.lat - half],
      [cell.lon + half, cell.lat + half],
      [cell.lon - half, cell.lat + half],
      [cell.lon - half, cell.lat - half],
    ];
    features.push({
      type: "Feature",
      properties,
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }

  return { type: "FeatureCollection", features };
}

interface RouteFeatureProps {
  id: string;
  name: string;
}

export function buildRouteData(
  plan: PlanResponse,
): FeatureCollection<LineString, RouteFeatureProps> {
  const features: Feature<LineString, RouteFeatureProps>[] = plan.routes.map(
    (route) => ({
      type: "Feature",
      properties: { id: route.id, name: route.name },
      geometry: {
        type: "LineString",
        coordinates: route.track.map(([lon, lat]) => [lon, lat]),
      },
    }),
  );
  return { type: "FeatureCollection", features };
}

interface CheckpointFeatureProps {
  route: string;
  index: number;
  level: Level;
  mile: number;
  eta: string;
}

export function buildCheckpointData(
  plan: PlanResponse,
): FeatureCollection<Point, CheckpointFeatureProps> {
  const features: Feature<Point, CheckpointFeatureProps>[] = [];
  for (const route of plan.routes) {
    route.checkpoints.forEach((checkpoint, index) => {
      features.push({
        type: "Feature",
        properties: {
          route: route.id,
          index,
          level: checkpoint.level,
          mile: checkpoint.mile,
          eta: checkpoint.eta,
        },
        geometry: {
          type: "Point",
          coordinates: [checkpoint.lon, checkpoint.lat],
        },
      });
    });
  }
  return { type: "FeatureCollection", features };
}

interface TruckFeatureProps {
  route: string;
  h: number;
  letter: string;
}

/** Position at a time, interpolated between the two nearest track points. */
function pointAt(track: TrackPoint[], seconds: number): LonLat | null {
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
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

/**
 * Every hour's truck position is precomputed once per plan, tagged with `h`.
 * The slider then only changes a filter, never the source data.
 */
export function buildTruckData(
  plan: PlanResponse,
): FeatureCollection<Point, TruckFeatureProps> {
  const features: Feature<Point, TruckFeatureProps>[] = [];
  for (const route of plan.routes) {
    const finalPoint = route.track[route.track.length - 1];
    const endSeconds = finalPoint?.[2] ?? route.duration_s;
    for (let hour = 0; hour <= HOURS; hour += 1) {
      const seconds = hour * 3_600;
      if (seconds > endSeconds) {
        break;
      }
      const position = pointAt(route.track, seconds);
      if (position === null) {
        continue;
      }
      features.push({
        type: "Feature",
        properties: { route: route.id, h: hour, letter: route.id },
        geometry: { type: "Point", coordinates: [position.lon, position.lat] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export interface PlanLayers {
  heat: FeatureCollection;
  routes: FeatureCollection;
  checkpoints: FeatureCollection;
  trucks: FeatureCollection;
}

export function emptyLayers(): PlanLayers {
  return {
    heat: emptyCollection(),
    routes: emptyCollection(),
    checkpoints: emptyCollection(),
    trucks: emptyCollection(),
  };
}

export function installLayers(map: MapLibreMap): void {
  // Heat and route lines sit under the basemap labels so city names stay readable.
  const firstLabel = map
    .getStyle()
    .layers.find((layer) => layer.type === "symbol")?.id;
  map.addSource("heat", { type: "geojson", data: emptyCollection() });
  map.addLayer(
    {
      id: "heat-cells",
      type: "fill",
      source: "heat",
      paint: {
        "fill-color": hourExpression(EMPTY_HOUR),
        "fill-opacity": 0.5,
        "fill-antialias": false,
      },
    },
    firstLabel,
  );

  map.addSource("routes", { type: "geojson", data: emptyCollection() });
  map.addLayer(
    {
      id: "routes-base",
      type: "line",
      source: "routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_IDLE,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 9, 5],
        "line-opacity": 0.9,
      },
    },
    firstLabel,
  );
  map.addLayer(
    {
      id: "routes-selected",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "id"], ""],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ACCENT,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 9, 7],
      },
    },
    firstLabel,
  );

  map.addSource("checkpoints", { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "cp-other",
    type: "circle",
    source: "checkpoints",
    filter: ["!=", ["get", "route"], ""],
    paint: {
      "circle-color": levelMatchExpression("level"),
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 5],
      "circle-stroke-color": MAP_INK,
      "circle-stroke-width": 1,
      "circle-opacity": 0.55,
      "circle-stroke-opacity": 0.7,
    },
  });
  map.addLayer({
    id: "cp-selected",
    type: "circle",
    source: "checkpoints",
    filter: ["==", ["get", "route"], ""],
    paint: {
      "circle-color": levelMatchExpression("level"),
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 8, 6.5],
      "circle-stroke-color": MAP_INK,
      "circle-stroke-width": 1.5,
    },
  });

  map.addSource("trucks", { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "trucks-other",
    type: "circle",
    source: "trucks",
    filter: [
      "all",
      ["==", ["get", "h"], EMPTY_HOUR],
      ["!=", ["get", "route"], ""],
    ],
    paint: {
      "circle-color": TRUCK,
      "circle-radius": 8,
      "circle-stroke-color": TRUCK_RING,
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "trucks-selected",
    type: "circle",
    source: "trucks",
    filter: [
      "all",
      ["==", ["get", "h"], EMPTY_HOUR],
      ["==", ["get", "route"], ""],
    ],
    paint: {
      "circle-color": ACCENT,
      "circle-radius": 9,
      "circle-stroke-color": MAP_INK,
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "truck-labels",
    type: "symbol",
    source: "trucks",
    filter: ["==", ["get", "h"], EMPTY_HOUR],
    layout: {
      "text-field": ["get", "letter"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 10,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#ffffff" },
  });
}

function applyTruckFilters(
  map: MapLibreMap,
  hour: number,
  selectedId: string,
): void {
  const selected: FilterSpecification = [
    "all",
    ["==", ["get", "h"], hour],
    ["==", ["get", "route"], selectedId],
  ];
  const other: FilterSpecification = [
    "all",
    ["==", ["get", "h"], hour],
    ["!=", ["get", "route"], selectedId],
  ];
  map.setFilter("trucks-selected", selected);
  map.setFilter("trucks-other", other);
  map.setFilter("truck-labels", ["==", ["get", "h"], hour]);
}

export function applySelection(
  map: MapLibreMap,
  selectedId: string | null,
  hour: number,
): void {
  const id = selectedId ?? "";
  map.setFilter("routes-selected", ["==", ["get", "id"], id]);
  map.setFilter("cp-selected", ["==", ["get", "route"], id]);
  map.setFilter("cp-other", ["!=", ["get", "route"], id]);
  applyTruckFilters(map, hour, id);
}

export function applyPlanData(
  map: MapLibreMap,
  layers: PlanLayers,
  selectedId: string | null,
  hour: number,
): void {
  map.getSource<GeoJSONSource>("heat")?.setData(layers.heat);
  map.getSource<GeoJSONSource>("routes")?.setData(layers.routes);
  map.getSource<GeoJSONSource>("checkpoints")?.setData(layers.checkpoints);
  map.getSource<GeoJSONSource>("trucks")?.setData(layers.trucks);
  applySelection(map, selectedId, hour);
}

export function applyHour(
  map: MapLibreMap,
  hour: number,
  selectedId: string | null,
): void {
  map.setPaintProperty("heat-cells", "fill-color", hourExpression(hour));
  applyTruckFilters(map, hour, selectedId ?? "");
}

export function fitToPlan(map: MapLibreMap, plan: PlanResponse): void {
  const bounds = new LngLatBounds();
  for (const route of plan.routes) {
    for (const [lon, lat] of route.track) {
      bounds.extend([lon, lat]);
    }
  }
  if (bounds.isEmpty()) {
    return;
  }
  map.fitBounds(bounds, {
    padding: { top: 72, right: 64, bottom: 148, left: 64 },
    maxZoom: 10,
    duration: prefersReducedMotion() ? 0 : 600,
  });
}

export function readString(properties: unknown, key: string): string | null {
  if (typeof properties !== "object" || properties === null) {
    return null;
  }
  const value: unknown = Reflect.get(properties, key);
  return typeof value === "string" ? value : null;
}

export function readNumber(properties: unknown, key: string): number | null {
  if (typeof properties !== "object" || properties === null) {
    return null;
  }
  const value: unknown = Reflect.get(properties, key);
  return typeof value === "number" ? value : null;
}
