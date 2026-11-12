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
  planTrip,
  type Checkpoint,
  type PlanRequest,
  type PlanResponse,
} from "./api";
import CheckpointList from "./CheckpointList";
import HourSlider from "./HourSlider";
import { LEVELS } from "./levels";
import RouteCards from "./RouteCards";
import type { MapApi, MapPending } from "./RouteMap";
import TripForm from "./TripForm";

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
      return (
        <div className="map-loading" role="alert">
          The map could not load. Routes and checkpoints are still listed on the
          left.
        </div>
      );
    }
    return this.props.children;
  }
}

type PlanState =
  | { status: "idle" }
  | { status: "loading"; plan: PlanResponse | null }
  | { status: "ready"; plan: PlanResponse }
  | { status: "error"; plan: PlanResponse | null; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "Cannot reach the planning server. Check that the API is running, then try again.";
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
        <li>48-hour corridor heatmap</li>
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

export default function App() {
  const [state, setState] = useState<PlanState>({ status: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planVersion, setPlanVersion] = useState(0);
  const planRef = useRef<PlanResponse | null>(null);
  const requestRef = useRef(0);
  const mapApiRef = useRef<MapApi | null>(null);
  const mapPendingRef = useRef<MapPending>({ hour: 0, focus: null });

  const runPlan = useCallback(async (request: PlanRequest) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    mapPendingRef.current.focus = null;
    setState({ status: "loading", plan: planRef.current });

    try {
      const plan = await planTrip(request);
      if (requestRef.current !== requestId) {
        return;
      }
      planRef.current = plan;
      setSelectedId(plan.recommended_id);
      setPlanVersion((version) => version + 1);
      setState({ status: "ready", plan });
    } catch (error) {
      if (requestRef.current !== requestId) {
        return;
      }
      setState({
        status: "error",
        plan: planRef.current,
        message: errorMessage(error),
      });
    }
  }, []);

  const handleSubmit = useCallback(
    (request: PlanRequest) => {
      void runPlan(request);
    },
    [runPlan],
  );

  const handleSelectRoute = useCallback((routeId: string) => {
    setSelectedId(routeId);
  }, []);

  const handleFocusCheckpoint = useCallback((checkpoint: Checkpoint) => {
    if (mapApiRef.current === null) {
      mapPendingRef.current.focus = checkpoint;
    } else {
      mapApiRef.current.focusCheckpoint(checkpoint);
    }
  }, []);

  // A fast drag can fire more input events than the map draws frames; keep only
  // the newest hour and apply it once per frame.
  const pendingHour = useRef<number | null>(null);
  const hourFrame = useRef(0);

  const handleHour = useCallback((hour: number) => {
    mapPendingRef.current.hour = hour;
    pendingHour.current = hour;
    if (hourFrame.current !== 0) {
      return;
    }
    hourFrame.current = window.requestAnimationFrame(() => {
      hourFrame.current = 0;
      const next = pendingHour.current;
      pendingHour.current = null;
      if (next !== null) {
        mapApiRef.current?.setHour(next);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (hourFrame.current !== 0) {
        window.cancelAnimationFrame(hourFrame.current);
      }
    };
  }, []);

  const plan = state.status === "idle" ? null : state.plan;
  const selectedRoute =
    plan?.routes.find((route) => route.id === selectedId) ??
    plan?.routes[0] ??
    null;

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
          {state.status === "error" && (
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
                <p>{state.message}</p>
              </div>
            </div>
          )}

          <TripForm
            loading={state.status === "loading"}
            hasPlan={plan !== null}
            onSubmit={handleSubmit}
          />

          {state.status === "loading" && plan === null && <LoadingState />}

          {plan !== null && (
            <>
              {state.status === "loading" && <RefreshState />}
              <RouteCards
                plan={plan}
                selectedId={selectedId}
                onSelect={handleSelectRoute}
              />
              {selectedRoute !== null && (
                <CheckpointList
                  route={selectedRoute}
                  onFocus={handleFocusCheckpoint}
                />
              )}
              <p className="fine-print">
                Forecast covers 48 h from departure. Times are local; weather
                comes from the nearest hourly forecast.
              </p>
            </>
          )}

          {plan === null && state.status !== "loading" && <EmptyState />}
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
              plan={plan}
              selectedId={selectedId}
              onSelectRoute={handleSelectRoute}
              apiRef={mapApiRef}
              pendingRef={mapPendingRef}
            />
          </Suspense>
        </MapErrorBoundary>

        {plan !== null && (
          <div className="map-dock">
            <HourSlider
              departure={plan.departure}
              resetKey={planVersion}
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
