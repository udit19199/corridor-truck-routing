import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import Map, {
  NavigationControl,
  Popup,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import {
  AJAXError,
  setWorkerUrl,
  type Map as MapLibreMap,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Checkpoint, PlanResponse } from "./api";
import { MAP_STYLE, NORTH_AMERICA, pruneBasemap, tuneBasemap } from "./basemap";
import CheckpointPopup, { type PopupState } from "./CheckpointPopup";
import { prefersReducedMotion } from "./format";
import type { MapApi } from "./mapHandoff";
import {
  applyHour,
  applyPlanData,
  applySelection,
  fitToPlan,
  installLayers,
} from "./mapLayers";
import { buildPlanLayers, NO_PLAN, type PlanLayers } from "./planGeoJson";
import MapUnavailable from "./MapUnavailable";

// MapLibre 6 resolves its worker relative to the module URL, which a bundler
// rewrites. Vite's ?url import keeps the worker next to the app in dev and build.
// It lives here, not in main.tsx, so maplibre stays out of the first chunk.
setWorkerUrl(workerUrl);

const INTERACTIVE_LAYERS = [
  "cp-selected",
  "cp-other",
  "routes-selected",
  "routes-base",
];

interface RouteMapProps {
  plan: PlanResponse | null;
  selectedId: string | null;
  /** The open checkpoint popup; App owns it so the list can mark the same row. */
  popup: PopupState | null;
  onPopup: (popup: PopupState | null) => void;
  /** The hour the slider shows. The map opens on it after a lazy load. */
  hourRef: MutableRefObject<number>;
  /** A checkpoint to fly to once the map loads; App clears it when the focus is dropped. */
  pendingFocusRef: MutableRefObject<PopupState | null>;
  onSelectRoute: (routeId: string) => void;
  apiRef: MutableRefObject<MapApi | null>;
}

function RouteMap({
  plan,
  selectedId,
  popup,
  onPopup,
  hourRef,
  pendingFocusRef,
  onSelectRoute,
  apiRef,
}: RouteMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const loadedRef = useRef(false);
  const [mapFailed, setMapFailed] = useState<"webgl" | "basemap" | null>(null);

  const debug =
    import.meta.env.DEV ||
    new URLSearchParams(window.location.search).has("debug");

  /** Built once per plan: the hour rides on feature state, never on this data. */
  const layers = useMemo<PlanLayers>(
    () => (plan === null ? NO_PLAN : buildPlanLayers(plan)),
    [plan],
  );

  // Event handlers and effects read the latest render through these refs. A layout
  // effect writes them, so render stays pure and the writes still land before the
  // passive effects and the map load event read the values.
  const layersRef = useRef<PlanLayers>(layers);
  const planRef = useRef<PlanResponse | null>(plan);
  const selectedRef = useRef<string | null>(selectedId);
  const onSelectRouteRef = useRef(onSelectRoute);
  const onPopupRef = useRef(onPopup);

  // A fast drag can fire more input events than the map draws frames; keep only
  // the newest hour and apply it once per frame.
  const pendingHourRef = useRef<number | null>(null);
  const hourFrameRef = useRef(0);

  useLayoutEffect(() => {
    layersRef.current = layers;
    planRef.current = plan;
    selectedRef.current = selectedId;
    onSelectRouteRef.current = onSelectRoute;
    onPopupRef.current = onPopup;
  });

  const applyHourNow = useCallback(
    (map: MapLibreMap, nextHour: number) => {
      applyHour(map, planRef.current, nextHour);
      if (debug) {
        window.__heatHour = nextHour;
      }
    },
    [debug],
  );

  const focusOn = useCallback(
    (map: MapLibreMap, routeId: string, checkpoint: Checkpoint) => {
      if (planRef.current === null) {
        return;
      }
      onPopupRef.current({ routeId, checkpoint });
      // The popup opens upward. On a phone the map is only partly on screen, so
      // keep the checkpoint low and let the popup clear the panel above it.
      const narrow = window.matchMedia("(max-width: 900px)").matches;
      map.flyTo({
        center: [checkpoint.lon, checkpoint.lat],
        zoom: Math.max(map.getZoom(), 7),
        padding: narrow ? { top: 140, right: 0, bottom: 0, left: 0 } : undefined,
        duration: prefersReducedMotion() ? 0 : 600,
      });
    },
    [],
  );

  const handleMapClick = useCallback((event: MapLayerMouseEvent) => {
    const features = event.features ?? [];

    const checkpointFeature = features.find(
      (feature) =>
        feature.layer.id === "cp-selected" || feature.layer.id === "cp-other",
    );
    if (checkpointFeature !== undefined) {
      const routeId = checkpointFeature.properties?.routeId;
      const index = checkpointFeature.properties?.checkpointIndex;
      if (typeof routeId === "string" && typeof index === "number") {
        const currentPlan = planRef.current;
        const checkpoint = currentPlan?.routes
          .find((route) => route.id === routeId)
          ?.checkpoints[index];
        if (checkpoint !== undefined) {
          onPopupRef.current({ routeId, checkpoint });
          return;
        }
      }
    }

    const routeFeature = features.find(
      (feature) =>
        feature.layer.id === "routes-selected" ||
        feature.layer.id === "routes-base",
    );
    const routeId = routeFeature?.properties?.routeId;
    if (typeof routeId === "string") {
      onSelectRouteRef.current(routeId);
      return;
    }

    onPopupRef.current(null);
  }, []);

  // `interactiveLayerIds` already fills `event.features`, so the cursor follows
  // the layers under the pointer without a state update per mouse move.
  const handleMouseMove = useCallback((event: MapLayerMouseEvent) => {
    if (event.originalEvent.buttons !== 0) {
      return; // Leave the drag cursor alone while a button is held.
    }
    const map = mapRef.current?.getMap();
    if (map === undefined) {
      return;
    }
    map.getCanvas().style.cursor = (event.features?.length ?? 0) > 0 ? "pointer" : "";
  }, []);

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map !== undefined) {
      map.getCanvas().style.cursor = "";
    }
  }, []);

  // Exposed when the map object exists, not when its style finishes loading, so
  // tests can inspect paint properties as soon as the first plan renders.
  const setMapRef = useCallback(
    (instance: MapRef | null) => {
      mapRef.current = instance;
      if (instance !== null && debug) {
        window.__map = instance.getMap();
      }
    },
    [debug],
  );

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map === undefined) {
      return;
    }
    loadedRef.current = true;
    pruneBasemap(map);
    tuneBasemap(map);
    installLayers(map);
    applyPlanData(map, layersRef.current);
    applySelection(map, selectedRef.current);
    applyHourNow(map, hourRef.current);
    if (planRef.current !== null) {
      fitToPlan(map, planRef.current);
    }
    const focus = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (focus !== null) {
      focusOn(map, focus.routeId, focus.checkpoint);
    }
  }, [applyHourNow, focusOn, hourRef, pendingFocusRef]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map === undefined || !loadedRef.current) {
      return;
    }
    if (hourFrameRef.current !== 0) {
      window.cancelAnimationFrame(hourFrameRef.current);
      hourFrameRef.current = 0;
    }
    pendingHourRef.current = null;
    applyPlanData(map, layers);
    applySelection(map, selectedRef.current);
    applyHourNow(map, hourRef.current);
    if (plan !== null) {
      fitToPlan(map, plan);
    }
  }, [applyHourNow, hourRef, layers, plan]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map === undefined || !loadedRef.current) {
      return;
    }
    applySelection(map, selectedId);
  }, [selectedId]);

  useEffect(() => {
    apiRef.current = {
      setHour(hour: number) {
        pendingHourRef.current = hour;
        if (hourFrameRef.current !== 0) {
          return;
        }
        hourFrameRef.current = window.requestAnimationFrame(() => {
          hourFrameRef.current = 0;
          const nextHour = pendingHourRef.current;
          pendingHourRef.current = null;
          const map = mapRef.current?.getMap();
          if (nextHour === null || map === undefined || !loadedRef.current) {
            return;
          }
          applyHourNow(map, nextHour);
        });
      },
      focusCheckpoint(routeId: string, checkpoint: Checkpoint) {
        const map = mapRef.current?.getMap();
        if (map === undefined || !loadedRef.current) {
          pendingFocusRef.current = { routeId, checkpoint };
          return;
        }
        focusOn(map, routeId, checkpoint);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, applyHourNow, focusOn]);

  useEffect(() => {
    return () => {
      if (hourFrameRef.current !== 0) {
        window.cancelAnimationFrame(hourFrameRef.current);
      }
      const map = mapRef.current?.getMap();
      if (map !== undefined && window.__map === map) {
        delete window.__map;
        delete window.__heatHour;
      }
    };
  }, []);

  if (mapFailed !== null) {
    return (
      <MapUnavailable
        reason={
          mapFailed === "webgl"
            ? "WebGL is unavailable in this browser."
            : "The basemap could not be reached."
        }
      />
    );
  }

  return (
    <div className="map" data-testid="map">
      <Map
        ref={setMapRef}
        mapStyle={MAP_STYLE}
        initialViewState={{ longitude: -96.6, latitude: 38.4, zoom: 3.6 }}
        interactiveLayerIds={INTERACTIVE_LAYERS}
        onLoad={handleLoad}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onError={(event) => {
          if (loadedRef.current) {
            return;
          }
          // MapLibre reports a missing WebGL context as an error event, not a throw.
          if (event.error?.name === "GPUInitializationError") {
            setMapFailed("webgl");
            return;
          }
          // The plan layers install on style load, so a style that never arrives
          // means a blank map with no explanation.
          if (event.error instanceof AJAXError && event.error.url === MAP_STYLE) {
            setMapFailed("basemap");
          }
        }}
        attributionControl={{ compact: true }}
        dragRotate={false}
        pitchWithRotate={false}
        fadeDuration={0}
        renderWorldCopies={false}
        maxPitch={0}
        maxBounds={NORTH_AMERICA}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {popup !== null && (
          <Popup
            longitude={popup.checkpoint.lon}
            latitude={popup.checkpoint.lat}
            anchor="bottom"
            offset={14}
            closeButton
            closeOnClick={false}
            maxWidth="300px"
            onClose={() => onPopup(null)}
          >
            <CheckpointPopup
              routeId={popup.routeId}
              checkpoint={popup.checkpoint}
            />
          </Popup>
        )}
      </Map>
    </div>
  );
}

export default memo(RouteMap);
