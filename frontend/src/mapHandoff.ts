/**
 * The contract between App and the map. App calls in through a ref so slider and
 * list input never re-render the panel, and the map is free to load lazily.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Checkpoint } from "./api";

export interface MapApi {
  setHour: (hour: number) => void;
  focusCheckpoint: (routeId: string, checkpoint: Checkpoint) => void;
}

declare global {
  interface Window {
    /** The live map, for the Playwright probes. Set only in dev or with ?debug=1. */
    __map?: MapLibreMap;
    /** The forecast hour the heatmap shows. Set only in dev or with ?debug=1. */
    __heatHour?: number;
  }
}
