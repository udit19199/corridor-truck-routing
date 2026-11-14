/**
 * The plan's map layers: install them once, then update data, selection and hour.
 * The forecast hour is feature state on the heat cells, so a slider move changes
 * no paint property and MapLibre never reloads the heat source.
 */
import {
  LngLatBounds,
  type ExpressionSpecification,
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { PlanResponse } from "./api";
import { prefersReducedMotion } from "./format";
import { LEVELS } from "./levels";
import { truckFeatures, type PlanLayers } from "./planGeoJson";

const ACCENT = "#f4f4f5";
const ROUTE_IDLE = "#74747c";
const TRUCK_FILL = "#0e0e10";
const TRUCK_RING = "#8f8f97";
const CHECKPOINT_STROKE = "#0a0a0b";
const HEAT_SOURCE = "heat";
const ROUTES_SOURCE = "routes";
const CHECKPOINTS_SOURCE = "checkpoints";
const TRUCKS_SOURCE = "trucks";

const EMPTY_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

/** One match expression for every level paint, so colours never drift from the table. */
function levelMatch(input: ExpressionSpecification): ExpressionSpecification {
  return [
    "match",
    input,
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
    // No level for this hour, or an unknown level, paints nothing. It must not
    // fall back to Low green.
    "rgba(0, 0, 0, 0)",
  ];
}

/** The heat hour lives in feature state, so this paint value never changes per move. */
const HEAT_COLOR = levelMatch(["feature-state", "level"]);
const CHECKPOINT_COLOR = levelMatch(["get", "level"]);

export function installLayers(map: MapLibreMap): void {
  // Heat and route lines sit under the basemap labels so city names stay readable.
  const firstLabel = map
    .getStyle()
    .layers.find((layer) => layer.type === "symbol")?.id;

  map.addSource(HEAT_SOURCE, { type: "geojson", data: EMPTY_COLLECTION });
  map.addLayer(
    {
      id: "heat-cells",
      type: "fill",
      source: HEAT_SOURCE,
      paint: {
        "fill-color": HEAT_COLOR,
        "fill-opacity": 0.34,
        "fill-antialias": false,
      },
    },
    firstLabel,
  );

  map.addSource(ROUTES_SOURCE, { type: "geojson", data: EMPTY_COLLECTION });
  map.addLayer(
    {
      id: "routes-base",
      type: "line",
      source: ROUTES_SOURCE,
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
      source: ROUTES_SOURCE,
      filter: ["==", ["get", "routeId"], ""],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ACCENT,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 9, 7],
      },
    },
    firstLabel,
  );

  map.addSource(CHECKPOINTS_SOURCE, { type: "geojson", data: EMPTY_COLLECTION });
  map.addLayer({
    id: "cp-other",
    type: "circle",
    source: CHECKPOINTS_SOURCE,
    filter: ["!=", ["get", "routeId"], ""],
    paint: {
      "circle-color": CHECKPOINT_COLOR,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 5],
      "circle-stroke-color": CHECKPOINT_STROKE,
      "circle-stroke-width": 1,
      "circle-opacity": 0.55,
      "circle-stroke-opacity": 0.7,
    },
  });
  map.addLayer({
    id: "cp-selected",
    type: "circle",
    source: CHECKPOINTS_SOURCE,
    filter: ["==", ["get", "routeId"], ""],
    paint: {
      "circle-color": CHECKPOINT_COLOR,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 8, 6.5],
      "circle-stroke-color": CHECKPOINT_STROKE,
      "circle-stroke-width": 1.5,
    },
  });

  // Three trucks at most: the hour rewrites these points instead of filtering
  // one point per route per hour out of a large source.
  map.addSource(TRUCKS_SOURCE, { type: "geojson", data: EMPTY_COLLECTION });
  map.addLayer({
    id: "trucks-other",
    type: "circle",
    source: TRUCKS_SOURCE,
    filter: ["!=", ["get", "routeId"], ""],
    paint: {
      "circle-color": TRUCK_FILL,
      "circle-radius": 8,
      "circle-stroke-color": TRUCK_RING,
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "trucks-selected",
    type: "circle",
    source: TRUCKS_SOURCE,
    filter: ["==", ["get", "routeId"], ""],
    paint: {
      "circle-color": TRUCK_FILL,
      "circle-radius": 9,
      "circle-stroke-color": ACCENT,
      "circle-stroke-width": 2.5,
    },
  });
  map.addLayer({
    id: "truck-labels",
    type: "symbol",
    source: TRUCKS_SOURCE,
    layout: {
      "text-field": ["get", "routeId"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 10,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#ffffff" },
  });
}

/** Route lines, checkpoint circles and heat cells for a plan. Trucks follow the hour. */
export function applyPlanData(map: MapLibreMap, layers: PlanLayers): void {
  map.getSource<GeoJSONSource>(HEAT_SOURCE)?.setData(layers.heat);
  map.getSource<GeoJSONSource>(ROUTES_SOURCE)?.setData(layers.routes);
  map.getSource<GeoJSONSource>(CHECKPOINTS_SOURCE)?.setData(layers.checkpoints);
}

/** Which route is highlighted. `null` leaves every route in the idle style. */
export function applySelection(map: MapLibreMap, routeId: string | null): void {
  const id = routeId ?? "";
  map.setFilter("routes-selected", ["==", ["get", "routeId"], id]);
  map.setFilter("cp-selected", ["==", ["get", "routeId"], id]);
  map.setFilter("cp-other", ["!=", ["get", "routeId"], id]);
  map.setFilter("trucks-selected", ["==", ["get", "routeId"], id]);
  map.setFilter("trucks-other", ["!=", ["get", "routeId"], id]);
}

/**
 * The forecast hour. One feature-state value per heat cell repaints the map and
 * leaves the style alone; the trucks move by rewriting one tiny source.
 */
export function applyHour(
  map: MapLibreMap,
  plan: PlanResponse | null,
  hour: number,
): void {
  const trucks = map.getSource<GeoJSONSource>(TRUCKS_SOURCE);
  if (plan === null) {
    trucks?.setData(EMPTY_COLLECTION);
    return;
  }
  plan.heatmap.cells.forEach((cell, id) => {
    map.setFeatureState(
      { source: HEAT_SOURCE, id },
      { level: cell.levels[hour] ?? null },
    );
  });
  trucks?.setData(truckFeatures(plan, hour));
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
