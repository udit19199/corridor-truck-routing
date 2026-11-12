/**
 * Basemap choice and tuning: the OpenFreeMap dark style, the layers a dispatcher
 * never needs, and the paint nudges that make its labels readable.
 */
import type { Map as MapLibreMap } from "maplibre-gl";

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
export const NORTH_AMERICA: [number, number, number, number] = [-170, 5, -45, 78];

/**
 * Building footprints, landuse detail, minor roads and their labels, rail,
 * airfields, piers. Place names, major roads, water and boundaries stay.
 * Removing them cuts per-frame draw work.
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
const BASEMAP_TEXT: ReadonlyArray<readonly [string, string]> = [
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
  for (const [layer, color] of BASEMAP_TEXT) {
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
