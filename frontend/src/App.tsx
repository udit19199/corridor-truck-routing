import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  checkpointHour,
  maxHeatHour,
  type Checkpoint,
  type PlanRequest,
  type PlanResponse,
} from "./api";
import CheckpointList from "./components/CheckpointList";
import { demoRequest, type DemoLoad } from "./lib/demo";
import {
  formatClock,
  formatLoad,
  prefersReducedMotion,
  timeZoneAbbreviation,
} from "./lib/format";
import HourSlider from "./components/HourSlider";
import type { MapApi } from "./map/mapHandoff";
import MapUnavailable from "./components/MapUnavailable";
import {
  DemoBanner,
  EmptyState,
  ErrorBanner,
  LoadingState,
  RefreshState,
  RiskLegend,
} from "./components/PanelStates";
import type { PopupState } from "./components/CheckpointPopup";
import RouteCards from "./components/RouteCards";
import TripForm from "./components/TripForm";
import { usePlanRequest } from "./lib/usePlanRequest";

// The map pulls in MapLibre; loading it separately lets the form paint first.
const RouteMap = lazy(() => import("./components/RouteMap"));

// A failed map chunk or missing WebGL must not blank the form and route cards.
class MapErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <MapUnavailable reason="The map code could not be loaded." />;
    }
    return this.props.children;
  }
}

/** The plan on screen and the request that produced it. */
interface ShownPlan {
  plan: PlanResponse;
  request: PlanRequest;
  selectedId: string;
  /** The checkpoint whose popup is open. */
  focus: PopupState | null;
  /** Bumped for every plan, so the slider resets. */
  version: number;
  /** Set when a checkpoint opens, so the map shows the hour it was scored at. */
  hourJump: { hour: number } | null;
}

export default function App() {
  const [shown, setShown] = useState<ShownPlan | null>(null);
  const mapApiRef = useRef<MapApi | null>(null);
  const hourRef = useRef(0);
  // Holds a checkpoint focus made while the map code is still loading.
  const pendingFocusRef = useRef<PopupState | null>(null);

  const handlePlan = useCallback((plan: PlanResponse, request: PlanRequest) => {
    // Reset before the new plan can paint: the slider reads this ref, and remounts.
    hourRef.current = 0;
    pendingFocusRef.current = null;
    setShown((previous) => ({
      plan,
      request,
      selectedId: plan.recommended_id,
      focus: null,
      version: (previous?.version ?? 0) + 1,
      hourJump: null,
    }));
  }, []);

  const { request, runPlan, cancel: cancelPlan } = usePlanRequest(handlePlan);

  const runDemo = useCallback(
    (loadLb: DemoLoad) => runPlan(demoRequest(loadLb)),
    [runPlan],
  );

  const handleSelectRoute = useCallback((routeId: string) => {
    pendingFocusRef.current = null;
    setShown((previous) =>
      previous === null
        ? null
        : { ...previous, selectedId: routeId, focus: null },
    );
  }, []);

  const handlePopup = useCallback((focus: PopupState | null) => {
    if (focus === null) {
      // A popup closed before the map loaded must not reopen when it does.
      pendingFocusRef.current = null;
    }
    setShown((previous) =>
      previous === null || (previous.focus === null && focus === null)
        ? previous
        : {
            ...previous,
            focus,
            hourJump:
              focus === null
                ? previous.hourJump
                : { hour: checkpointHour(previous.plan, focus.checkpoint) },
          },
    );
  }, []);

  const handleHour = useCallback((hour: number) => {
    hourRef.current = hour;
    mapApiRef.current?.setHour(hour);
  }, []);

  const selectedRoute =
    shown?.plan.routes.find((route) => route.id === shown.selectedId) ?? null;

  const handleFocusCheckpoint = useCallback(
    (checkpoint: Checkpoint) => {
      if (selectedRoute === null) {
        return;
      }
      // Below 900 px the map sits under the panel, so a tapped checkpoint would
      // otherwise fly a map the user cannot see.
      if (window.matchMedia("(max-width: 900px)").matches) {
        document.querySelector(".map-shell")?.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "start",
        });
      }
      const focus = { routeId: selectedRoute.id, checkpoint };
      handlePopup(focus);
      if (mapApiRef.current === null) {
        pendingFocusRef.current = focus;
      } else {
        mapApiRef.current.focusCheckpoint(focus.routeId, checkpoint);
      }
    },
    [selectedRoute, handlePopup],
  );

  const maxHour = shown === null ? 0 : maxHeatHour(shown.plan);

  return (
    <div className="app">
      <aside className="panel">
        <header className="panel-head">
          <div className="brand">
            <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 16c3.2 0 2.6-8 6-8s2.8 8 6 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
            <h1>Haulcast</h1>
          </div>
        </header>

        <div className="panel-scroll">
          {request.status === "error" && (
            <ErrorBanner
              message={request.message}
              hasPreviousPlan={shown !== null}
            />
          )}

          <TripForm
            loading={request.status === "loading"}
            // A demo plan is not the form's trip, so the spacing buttons do not replan it.
            planIntervalMi={
              shown === null || shown.request.demo === true
                ? null
                : shown.plan.interval_mi
            }
            onSubmit={runPlan}
            onCancel={cancelPlan}
          />

          {request.status === "loading" && shown === null && <LoadingState />}

          {shown !== null && (
            <>
              {request.status === "loading" && <RefreshState />}
              {shown.request.demo === true ? (
                <DemoBanner
                  loadLb={shown.plan.load_lb}
                  disabled={request.status === "loading"}
                  onLoad={runDemo}
                />
              ) : (
                <p className="plan-summary" data-testid="plan-summary">
                  {shown.request.origin.label} to{" "}
                  {shown.request.destination.label},{" "}
                  {formatLoad(shown.plan.load_lb)}, leaving{" "}
                  {formatClock(shown.plan.departure)}
                </p>
              )}
              <div className="verdict">
                <p className="verdict-pick">
                  Take Route {shown.plan.recommended_id}
                </p>
                <p className="verdict-reason" data-testid="recommendation-reason">
                  {shown.plan.reason}
                </p>
              </div>
              <RouteCards
                plan={shown.plan}
                selectedId={shown.selectedId}
                onSelect={handleSelectRoute}
              />
              {selectedRoute !== null && (
                <CheckpointList
                  route={selectedRoute}
                  focusedMile={
                    shown.focus?.routeId === selectedRoute.id
                      ? shown.focus.checkpoint.mile
                      : null
                  }
                  onFocus={handleFocusCheckpoint}
                />
              )}
              <p className="fine-print">
                Times are in your time zone ({timeZoneAbbreviation()}).
              </p>
            </>
          )}

          {shown === null && request.status !== "loading" && (
            <EmptyState onDemo={() => runDemo(45_000)} />
          )}
        </div>
      </aside>

      <main className="map-shell">
        <MapErrorBoundary>
          <Suspense
            fallback={
              <div className="map-loading" role="status">
                Loading map
              </div>
            }
          >
            <RouteMap
              plan={shown?.plan ?? null}
              selectedId={shown?.selectedId ?? null}
              popup={shown?.focus ?? null}
              onPopup={handlePopup}
              hourRef={hourRef}
              pendingFocusRef={pendingFocusRef}
              onSelectRoute={handleSelectRoute}
              apiRef={mapApiRef}
            />
          </Suspense>
        </MapErrorBoundary>

        {shown !== null && (
          <div className="map-dock">
            <HourSlider
              key={shown.version}
              start={shown.plan.heatmap.start}
              maxHour={maxHour}
              jump={shown.hourJump}
              onHour={handleHour}
            />
            <div className="dock-foot">
              <RiskLegend />
            </div>
            <p className="dock-note">
              Squares show the forecast at this hour. Dots show it when the truck
              gets there. Open a dot to jump to its hour.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
