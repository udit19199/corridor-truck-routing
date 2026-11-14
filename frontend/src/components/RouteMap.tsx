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
import type { Checkpoint, PlanResponse } from "../api";
import { MAP_STYLE, NORTH_AMERICA, pruneBasemap, tuneBasemap } from "../map/basemap";
import CheckpointPopup, { type PopupState } from "./CheckpointPopup";
import { prefersReducedMotion } from "../lib/format";
import type { MapApi } from "../map/mapHandoff";
import {
  applyHour,
  applyPlanData,
  applySelection,
  fitToPlan,
  installLayers,
} from "../map/mapLayers";
import { buildPlanLayers, NO_PLAN, type PlanLayers } from "../map/planGeoJson";
import MapUnavailable from "./MapUnavailable";

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
  popup: PopupState | null;
  onPopup: (popup: PopupState | null) => void;
  hourRef: MutableRefObject<number>;
  pendingFocusRef: MutableRefObject<PopupState | null>;
  onSelectRoute: (routeId: string) => void;
  apiRef: MutableRefObject<MapApi | null>;
}

const POPUP_HEIGHT_PX = 440;
const DOCK_HEIGHT_PX = 190;

/** Top padding that puts a focused checkpoint below its popup and above the dock. */
function popupClearance(map: MapLibreMap): number {
  const height = map.getContainer().clientHeight;
  const pointY = Math.min(height - DOCK_HEIGHT_PX, POPUP_HEIGHT_PX);
  return Math.max(0, 2 * pointY - height);
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

  const layers = useMemo<PlanLayers>(
    () => (plan === null ? NO_PLAN : buildPlanLayers(plan)),
    [plan],
  );

  const layersRef = useRef<PlanLayers>(layers);
  const planRef = useRef<PlanResponse | null>(plan);
  const selectedRef = useRef<string | null>(selectedId);
  const onSelectRouteRef = useRef(onSelectRoute);
  const onPopupRef = useRef(onPopup);

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
      const narrow = window.matchMedia("(max-width: 900px)").matches;
      map.flyTo({
        center: [checkpoint.lon, checkpoint.lat],
        zoom: Math.max(map.getZoom(), 7),
        // On a phone the popup opens above the point and the dock covers the bottom,
        // so the point sits low enough for the whole popup and clear of the dock.
        padding: narrow
          ? { top: popupClearance(map), right: 0, bottom: 0, left: 0 }
          : undefined,
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
          onSelectRouteRef.current(routeId);
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
          if (event.error?.name === "GPUInitializationError") {
            setMapFailed("webgl");
            return;
          }
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
