import type { Map as MapLibreMap } from "maplibre-gl";
import type { Checkpoint } from "../api";

export interface MapApi {
  setHour: (hour: number) => void;
  focusCheckpoint: (routeId: string, checkpoint: Checkpoint) => void;
}

declare global {
  interface Window {
    __map?: MapLibreMap;
    __heatHour?: number;
  }
}
