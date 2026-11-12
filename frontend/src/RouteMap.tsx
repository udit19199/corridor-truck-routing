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
  type MapRef,
} from "react-map-gl/maplibre";
import {
  setWorkerUrl,
  type Map as MapLibreMap,
  type MapMouseEvent,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Checkpoint, PlanResponse } from "./api";
import {
  formatClockDetailed,
  formatMiles,
  prefersReducedMotion,
} from "./format";
import { levelInfo } from "./levels";
import {
  MAP_STYLE,
  NORTH_AMERICA,
  applyHour,
  applyPlanData,
  applySelection,
  buildCheckpointData,
  buildHeatData,
  buildRouteData,
  buildTruckData,
  emptyLayers,
  fitToPlan,
  installLayers,
  pruneBasemap,
  readNumber,
  readString,
  tuneBasemap,
  type MapApi,
  type MapPending,
  type PlanLayers,
} from "./mapLayers";

// MapLibre 6 resolves its worker relative to the module URL, which a bundler
// rewrites. Vite's ?url import keeps the worker next to the app in dev and build.
// It lives here, not in main.tsx, so maplibre stays out of the first chunk.
setWorkerUrl(workerUrl);

interface RouteMapProps {
  plan: PlanResponse | null;
  selectedId: string | null;
  onSelectRoute: (routeId: string) => void;
  apiRef: MutableRefObject<MapApi | null>;
  pendingRef: MutableRefObject<MapPending>;
}

interface PopupState {
  routeId: string;
  checkpoint: Checkpoint;
}

function CheckpointPopup({ routeId, checkpoint }: PopupState) {
  const info = levelInfo(checkpoint.level);
  const weather = checkpoint.weather;

  return (
    <div className="popup">
      <div className="popup-head">
        <span
          className="popup-dot"
          style={{ backgroundColor: info.color }}
          aria-hidden="true"
        />
        <span className="popup-level">{info.name}</span>
        <span className="popup-mile">
          Route {routeId}, mile {formatMiles(checkpoint.mile)}
        </span>
      </div>
      <dl className="popup-grid">
        <div className="popup-wide">
          <dt>ETA</dt>
          <dd>{formatClockDetailed(checkpoint.eta)}</dd>
        </div>
        <div>
          <dt>Wind</dt>
          <dd>
            {weather.wind_mph.toFixed(1)} mph
            <span className="popup-sub">
              {" "}
              gust {weather.gust_mph.toFixed(1)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Rain</dt>
          <dd>{weather.rain_in_hr.toFixed(2)} in/hr</dd>
        </div>
        <div>
          <dt>Snow</dt>
          <dd>{weather.snow_in_hr.toFixed(2)} in/hr</dd>
        </div>
      </dl>
      <p className="popup-cause">{checkpoint.cause}</p>
    </div>
  );
}

function RouteMap({
  plan,
  selectedId,
  onSelectRoute,
  apiRef,
  pendingRef,
}: RouteMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const loadedRef = useRef(false);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  /**
   * The heatmap's 49-level properties are built once per plan; the hour slider
   * only swaps the fill-colour expression that reads r{h}, never this data.
   */
  const layers = useMemo<PlanLayers>(() => {
    if (plan === null) {
      return emptyLayers();
    }
    return {
      heat: buildHeatData(plan),
      routes: buildRouteData(plan),
      checkpoints: buildCheckpointData(plan),
      trucks: buildTruckData(plan),
    };
  }, [plan]);

  // Event handlers and effects read the latest render through these refs. A layout
  // effect writes them, so render stays pure and the writes still land before the
  // passive effects and the map load event read the values.
  const layersRef = useRef<PlanLayers>(layers);
  const planRef = useRef<PlanResponse | null>(plan);
  const selectedRef = useRef<string | null>(selectedId);
  const onSelectRouteRef = useRef(onSelectRoute);

  useLayoutEffect(() => {
    layersRef.current = layers;
    planRef.current = plan;
    selectedRef.current = selectedId;
    onSelectRouteRef.current = onSelectRoute;
  });

  const handleMapClick = useCallback((event: MapMouseEvent) => {
    if (!loadedRef.current) {
      return;
    }
    const map = event.target;
    const checkpointFeature = map.queryRenderedFeatures(event.point, {
      layers: ["cp-selected", "cp-other"],
    })[0];
    if (checkpointFeature !== undefined) {
      const routeId = readString(checkpointFeature.properties, "route");
      const index = readNumber(checkpointFeature.properties, "index");
      if (routeId !== null && index !== null) {
        const route = planRef.current?.routes.find(
          (candidate) => candidate.id === routeId,
        );
        const checkpoint = route?.checkpoints[index];
        if (checkpoint !== undefined) {
          setPopup({ routeId, checkpoint });
        }
        return;
      }
    }

    const routeFeature = map.queryRenderedFeatures(event.point, {
      layers: ["routes-selected", "routes-base"],
    })[0];
    if (routeFeature !== undefined) {
      const routeId = readString(routeFeature.properties, "id");
      if (routeId !== null) {
        setPopup(null);
        onSelectRouteRef.current(routeId);
        return;
      }
    }

    setPopup(null);
  }, []);

  const handleMouseMove = useCallback((event: MapMouseEvent) => {
    if (!loadedRef.current) {
      return;
    }
    const map = event.target;
    const hit = map.queryRenderedFeatures(event.point, {
      layers: ["cp-selected", "cp-other", "routes-selected", "routes-base"],
    });
    map.getCanvas().style.cursor = hit.length > 0 ? "pointer" : "";
  }, []);

  const debug =
    import.meta.env.DEV ||
    new URLSearchParams(window.location.search).has("debug");

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

  const focusOn = useCallback((map: MapLibreMap, checkpoint: Checkpoint) => {
    const route = planRef.current?.routes.find((candidate) =>
      candidate.checkpoints.includes(checkpoint),
    );
    setPopup({ routeId: route?.id ?? "", checkpoint });
    map.flyTo({
      center: [checkpoint.lon, checkpoint.lat],
      zoom: Math.max(map.getZoom(), 7),
      duration: prefersReducedMotion() ? 0 : 600,
    });
  }, []);

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map === undefined) {
      return;
    }
    loadedRef.current = true;
    pruneBasemap(map);
    tuneBasemap(map);
    installLayers(map);
    applyPlanData(
      map,
      layersRef.current,
      selectedRef.current,
      pendingRef.current.hour,
    );
    applyHour(map, pendingRef.current.hour, selectedRef.current);
    const focus = pendingRef.current.focus;
    pendingRef.current.focus = null;
    const focusInPlan =
      focus !== null &&
      planRef.current?.routes.some((route) => route.checkpoints.includes(focus)) === true;
    if (focus !== null && focusInPlan) {
      focusOn(map, focus);
    } else if (planRef.current !== null) {
      fitToPlan(map, planRef.current);
    }
  }, [focusOn, pendingRef]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map === undefined || !loadedRef.current) {
      return;
    }
    applyPlanData(map, layers, selectedRef.current, pendingRef.current.hour);
    // App resets the pending hour to 0 for a new plan; paint that hour so the
    // heatmap never shows the previous plan's hour under the new data.
    applyHour(map, pendingRef.current.hour, selectedRef.current);
    setPopup(null);
    if (plan !== null) {
      fitToPlan(map, plan);
    }
  }, [layers, plan, pendingRef]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map === undefined || !loadedRef.current) {
      return;
    }
    applySelection(map, selectedId, pendingRef.current.hour);
  }, [selectedId, pendingRef]);

  useEffect(() => {
    apiRef.current = {
      setHour(hour: number) {
        pendingRef.current.hour = hour;
        const map = mapRef.current?.getMap();
        if (map !== undefined && loadedRef.current) {
          applyHour(map, hour, selectedRef.current);
        }
      },
      focusCheckpoint(checkpoint: Checkpoint) {
        const map = mapRef.current?.getMap();
        if (map === undefined || !loadedRef.current) {
          pendingRef.current.focus = checkpoint;
          return;
        }
        focusOn(map, checkpoint);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, pendingRef, focusOn]);

  useEffect(() => {
    return () => {
      const map = mapRef.current?.getMap();
      if (map !== undefined && window.__map === map) {
        delete window.__map;
      }
    };
  }, []);

  if (mapFailed) {
    return (
      <div className="map-loading" role="alert">
        The map could not start in this browser. Routes and checkpoints are still listed on the
        left.
      </div>
    );
  }

  return (
    <div className="map" data-testid="map">
      <Map
        ref={setMapRef}
        mapStyle={MAP_STYLE}
        initialViewState={{ longitude: -96.6, latitude: 38.4, zoom: 3.6 }}
        onLoad={handleLoad}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onError={(event) => {
          // MapLibre reports a missing WebGL context as an error event, not a throw.
          if (!loadedRef.current && event.error?.name === "GPUInitializationError") {
            setMapFailed(true);
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
            onClose={() => setPopup(null)}
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
