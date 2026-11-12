import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  maxHeatHour,
  planTrip,
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
import { LEVELS } from "./levels";
import type { MapApi } from "./mapHandoff";
import MapUnavailable from "./MapUnavailable";
import RouteCards from "./RouteCards";
import TripForm from "./TripForm";

// The map pulls in MapLibre; loading it separately lets the form paint first.
const RouteMap = lazy(() => import("./RouteMap"));

const PLAN_TIMEOUT_MS = 30_000;

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
  /** Bumped for every plan, so the slider remounts at hour 0. */
  version: number;
}

interface RequestState {
  status: "idle" | "loading" | "error";
  message?: string;
}

const IDLE: RequestState = { status: "idle" };

function errorMessage(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "Planning took too long. Try again.";
  }
  if (error instanceof TypeError) {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "The trip could not be planned.";
}

function RiskLegend() {
  return (
    <ul className="legend" aria-label="Risk levels">
      {LEVELS.map((info) => (
        <li key={info.name}>
          <span
            className="legend-dot"
            style={{ backgroundColor: info.color }}
            aria-hidden="true"
          />
          {info.name}
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <svg
        className="empty-art"
        viewBox="0 0 320 84"
        role="img"
        aria-label="Two cities joined by a dotted route with weather cells"
      >
        <rect
          x="0"
          y="0"
          width="320"
          height="84"
          rx="12"
          fill="var(--surface-sunken)"
        />
        <rect x="24" y="20" width="42" height="42" rx="6" fill="#1b2735" />
        <rect x="230" y="12" width="50" height="50" rx="6" fill="#222f3e" />
        <rect x="150" y="48" width="38" height="38" rx="6" fill="#18232f" />
        <path
          d="M62 57 C 108 57, 112 27, 158 27 S 214 46, 248 46"
          fill="none"
          stroke="var(--accent-bright)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="1 6"
        />
        <circle
          cx="62"
          cy="57"
          r="5"
          fill="var(--panel)"
          stroke="var(--accent-bright)"
          strokeWidth="2"
        />
        <circle cx="248" cy="46" r="5" fill="var(--accent-bright)" />
      </svg>
      <h2>Plan a weather-safe run</h2>
      <p>
        Pick two US cities, a departure time and a load. You’ll get three routes
        ranked by risk, with the forecast along each corridor.
      </p>
      <ul className="empty-points">
        <li>Three routes, ranked by risk</li>
        <li>Weather at every checkpoint</li>
        <li>Hourly corridor heatmap</li>
      </ul>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      className="results-loading"
      data-testid="loading"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Planning trip</span>
      <div className="skeleton skeleton-bar" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
    </div>
  );
}

function RefreshState() {
  return (
    <div
      className="refresh-state"
      data-testid="loading"
      role="status"
      aria-live="polite"
    >
      <span className="spinner spinner-dark" aria-hidden="true" />
      Updating plan…
    </div>
  );
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
  const [request, setRequest] = useState<RequestState>(IDLE);
  const requestRef = useRef<AbortController | null>(null);
  const mapApiRef = useRef<MapApi | null>(null);
  const hourRef = useRef(0);

  const runPlan = useCallback((nextRequest: PlanRequest) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setRequest({ status: "loading" });

    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(PLAN_TIMEOUT_MS),
    ]);
    planTrip(nextRequest, signal)
      .then((plan) => {
        // A superseded or timed out request must not replace what is on screen.
        if (controller.signal.aborted) {
          return;
        }
        // The new plan starts at hour 0: the slider remounts there, and the map
        // reads this ref, so reset it before either can paint.
        hourRef.current = 0;
        setShown((previous) => ({
          plan,
          request: nextRequest,
          selectedId: plan.recommended_id,
          version: (previous?.version ?? 0) + 1,
        }));
        setRequest(IDLE);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setRequest({ status: "error", message: errorMessage(error) });
      });
  }, []);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
    };
  }, []);

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
      mapApiRef.current?.focusCheckpoint(selectedRoute.id, checkpoint);
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
            <div
              className="error-banner"
              data-testid="error-banner"
              role="alert"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M8 2.2 14.4 13H1.6L8 2.2Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 6.2v3.1M8 11.3v.1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <div>
                <strong>Couldn’t plan this trip</strong>
                <p>{request.message}</p>
                {shown !== null && (
                  <p className="error-previous">
                    The results below are from the previous plan.
                  </p>
                )}
              </div>
            </div>
          )}

          <TripForm
            loading={request.status === "loading"}
            hasPlan={shown !== null}
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
                  route={selectedRoute}
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
