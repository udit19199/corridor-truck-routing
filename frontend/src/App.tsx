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
  maxHeatHour,
  type Checkpoint,
  type PlanRequest,
  type PlanResponse,
} from "./api";
import CheckpointList from "./CheckpointList";
import {
  formatClock,
  formatLoad,
  prefersReducedMotion,
  timeZoneAbbreviation,
} from "./format";
import HourSlider from "./HourSlider";
import type { MapApi } from "./mapHandoff";
import MapUnavailable from "./MapUnavailable";
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  RefreshState,
  RiskLegend,
} from "./PanelStates";
import type { PopupState } from "./CheckpointPopup";
import RouteCards from "./RouteCards";
import TripForm from "./TripForm";
import { usePlanRequest } from "./usePlanRequest";

// The map pulls in MapLibre; loading it separately lets the form paint first.
const RouteMap = lazy(() => import("./RouteMap"));

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
  /** Bumped for every plan, so the slider and checkpoint focus reset. */
  version: number;
}

function PlanSummary({ shown }: { shown: ShownPlan }) {
  const { plan, request } = shown;
  return (
    <p className="plan-summary" data-testid="plan-summary">
      {request.origin.label} to {request.destination.label},{" "}
      {formatLoad(plan.load_lb)}, checkpoints every {plan.interval_mi} mi,
      departs {formatClock(plan.departure)}
    </p>
  );
}

export default function App() {
  const [shown, setShown] = useState<ShownPlan | null>(null);
  const mapApiRef = useRef<MapApi | null>(null);
  const hourRef = useRef(0);
  // Holds a checkpoint focus made while the map code is still loading.
  const pendingFocusRef = useRef<PopupState | null>(null);

  const handlePlan = useCallback((plan: PlanResponse, request: PlanRequest) => {
    // The new plan starts at hour 0: the slider remounts there, and the map reads
    // this ref, so reset it before either can paint.
    hourRef.current = 0;
    pendingFocusRef.current = null;
    setShown((previous) => ({
      plan,
      request,
      selectedId: plan.recommended_id,
      version: (previous?.version ?? 0) + 1,
    }));
  }, []);

  const { request, runPlan } = usePlanRequest(handlePlan);

  const handleSelectRoute = useCallback((routeId: string) => {
    setShown((previous) =>
      previous === null ? null : { ...previous, selectedId: routeId },
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
      if (mapApiRef.current === null) {
        pendingFocusRef.current = { routeId: selectedRoute.id, checkpoint };
      } else {
        mapApiRef.current.focusCheckpoint(selectedRoute.id, checkpoint);
      }
    },
    [selectedRoute],
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
            <div>
              <h1>Corridor</h1>
              <p>Weather-aware truck routing</p>
            </div>
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
            planIntervalMi={shown?.plan.interval_mi ?? null}
            onSubmit={runPlan}
          />

          {request.status === "loading" && shown === null && <LoadingState />}

          {shown !== null && (
            <>
              {request.status === "loading" && <RefreshState />}
              <PlanSummary shown={shown} />
              <RouteCards
                plan={shown.plan}
                selectedId={shown.selectedId}
                onSelect={handleSelectRoute}
              />
              {selectedRoute !== null && (
                <CheckpointList
                  key={shown.version}
                  route={selectedRoute}
                  intervalMi={shown.plan.interval_mi}
                  onFocus={handleFocusCheckpoint}
                />
              )}
              <p className="fine-print">
                Times are in your time zone ({timeZoneAbbreviation()}). The
                corridor heatmap covers {maxHour} h from the first forecast
                hour; each checkpoint uses the forecast hour nearest its ETA.
              </p>
            </>
          )}

          {shown === null && request.status !== "loading" && <EmptyState />}
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
              onHour={handleHour}
            />
            <div className="dock-foot">
              <RiskLegend />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
