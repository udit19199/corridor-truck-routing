import { DEMO_LOADS, type DemoLoad } from "./demo";
import { formatLoad } from "./format";
import { LEVELS } from "./levels";

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
        scripted storm, not live weather. Above 40,000 lb, 35 to 44 mph wind
        counts as Severe.
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
            disabled={disabled}
            onClick={() => onLoad(load)}
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
      <span className="spinner spinner-dark" aria-hidden="true" />
      Updating plan…
    </div>
  );
}
