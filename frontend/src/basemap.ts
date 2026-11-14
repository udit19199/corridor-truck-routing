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
  ["place_city_large", "#c9c9ce"],
  ["place_city", "#c9c9ce"],
  ["place_town", "#adadb3"],
  ["place_village", "#93939a"],
  ["place_other", "#93939a"],
  ["place_state", "#85858c"],
  ["place_country_major", "#98989f"],
  ["place_country_minor", "#98989f"],
  ["place_country_other", "#98989f"],
  ["highway_name_motorway", "#98989f"],
];

const BASEMAP_LINES: ReadonlyArray<readonly [string, string]> = [
  ["boundary_state", "#3a3a40"],
  ["boundary_country_z0-4", "#4b4b52"],
  ["boundary_country_z5-", "#4b4b52"],
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
