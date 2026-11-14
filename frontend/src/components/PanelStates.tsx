import { DEMO_LOADS, type DemoLoad } from "../lib/demo";
import { formatLoad } from "../lib/format";
import { LEVELS } from "../lib/levels";

export function RiskLegend() {
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

export function ErrorBanner({
  message,
  hasPreviousPlan,
}: {
  message: string;
  /** Says the results below belong to the older plan the replan failed to replace. */
  hasPreviousPlan: boolean;
}) {
  return (
    <div className="error-banner" data-testid="error-banner" role="alert">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
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
        <p>{message}</p>
        {hasPreviousPlan && (
          <p className="error-previous">
            The results below are from the previous plan.
          </p>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ onDemo }: { onDemo: () => void }) {
  return (
    <div className="empty">
      <h2>Plan a weather-safe run</h2>
      <p>
        Pick two US cities, a departure time and a load. You’ll get three routes
        ranked by risk, with the forecast along each corridor.
      </p>
      <div className="demo-callout">
        <p>
          Calm weather everywhere today? Run the storm demo: recorded Dallas to
          Chicago routes under a scripted storm, to see the risk and load rules
          change the pick.
        </p>
        <button
          type="button"
          className="secondary-button"
          data-testid="demo-start"
          onClick={onDemo}
        >
          Run the storm demo
        </button>
      </div>
    </div>
  );
}

export function DemoBanner({
  loadLb,
  disabled,
  onLoad,
}: {
  loadLb: number;
  disabled: boolean;
  onLoad: (loadLb: DemoLoad) => void;
}) {
  return (
    <div className="demo-banner" data-testid="demo-banner">
      <p>
        <strong>Storm demo.</strong> Recorded Dallas to Chicago routes under a
        scripted storm, not live weather. Switch the load and the same wind
        changes level.
      </p>
      <div
        className="segmented demo-loads"
        role="group"
        aria-label="Demo load"
      >
        {DEMO_LOADS.map((load) => (
          <button
            key={load}
            type="button"
            data-testid={`demo-load-${load}`}
            aria-pressed={loadLb === load}
            // aria-disabled, not disabled: a disabled button drops keyboard focus mid-replan.
            aria-disabled={disabled}
            onClick={() => {
              if (!disabled && load !== loadLb) {
                onLoad(load);
              }
            }}
          >
            {formatLoad(load)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LoadingState() {
  return (
    <div
      className="results-loading"
      data-testid="loading"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Planning trip</span>
      <p className="loading-note">
        Getting truck routes, then the hourly forecast at every checkpoint and
        heatmap cell. This can take several seconds.
      </p>
      <div className="skeleton skeleton-bar" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
    </div>
  );
}

export function RefreshState() {
  return (
    <div
      className="refresh-state"
      data-testid="refreshing"
      role="status"
      aria-live="polite"
    >
      <span className="spinner" aria-hidden="true" />
      Updating plan…
    </div>
  );
}
