import type { Level, PlanResponse, Route, RouteSummary } from "../api";
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatMiles,
  formatRisk,
} from "../lib/format";
import {
  levelInfo,
  NO_TRAVEL_LEVEL,
  SEVERE_LEVEL,
} from "../lib/levels";

const ALL_LEVELS = [0, 1, 2, 3, 4] as const;
/** The miles the ranking compares first: No Travel, then Severe, then High. */
const RANK_LEVELS = [NO_TRAVEL_LEVEL, SEVERE_LEVEL, 2] as const;

/** The levels with miles above zero, in the order given. */
function milesByLevel(
  byLevel: RouteSummary["miles_by_level"],
  levels: readonly Level[],
): { level: Level; miles: number }[] {
  return levels.flatMap((level) => {
    const miles = byLevel[level] ?? 0;
    return miles > 0 ? [{ level, miles }] : [];
  });
}

interface RouteCardProps {
  route: Route;
  recommended: boolean;
  selected: boolean;
  reason: string;
  onSelect: (routeId: string) => void;
}

function RouteCard({
  route,
  recommended,
  selected,
  reason,
  onSelect,
}: RouteCardProps) {
  const levelMiles = milesByLevel(route.summary.miles_by_level, ALL_LEVELS);
  const rankMiles = milesByLevel(route.summary.miles_by_level, RANK_LEVELS);
  const worst = levelInfo(route.summary.worst);
  const barLabel = levelMiles
    .map(
      ({ level, miles }) =>
        `${levelInfo(level).name}: ${formatMiles(miles)} miles`,
    )
    .join(", ");

  return (
    <button
      type="button"
      className="route-card"
      data-testid="route-card"
      data-route-id={route.id}
      data-recommended={String(recommended)}
      data-selected={String(selected)}
      aria-pressed={selected}
      onClick={() => onSelect(route.id)}
    >
      <span className="rc-head">
        <span className="rc-letter">{route.id}</span>
        <span className="rc-name" title={route.name}>
          {route.name}
        </span>
        {recommended && (
          <span className="badge">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M1.6 5.2 4 7.5 8.5 2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Recommended
          </span>
        )}
      </span>

      <span className="rc-metrics">
        <span className="rc-metric">
          <span>Duration</span>
          <strong>{formatDuration(route.duration_s)}</strong>
        </span>
        <span className="rc-metric">
          <span>Distance</span>
          <strong>{formatDistance(route.distance_mi)}</strong>
        </span>
        <span className="rc-metric">
          <span>Arrival</span>
          <strong>{formatClock(route.arrival)}</strong>
        </span>
      </span>

      <span
        className="risk-bar"
        role="img"
        aria-label={`Miles by risk level (${barLabel})`}
      >
        {levelMiles.map(({ level, miles }) => {
          const levelMeta = levelInfo(level);
          return (
            <span
              key={levelMeta.name}
              title={`${levelMeta.name}: ${formatMiles(miles)} mi`}
              style={{
                flexGrow: miles,
                flexBasis: 0,
                backgroundColor: levelMeta.color,
              }}
            />
          );
        })}
      </span>

      <span className="rc-ranks">
        {rankMiles.length === 0 ? (
          <span className="rc-rank">No High or worse miles</span>
        ) : (
          rankMiles.map(({ level, miles }) => {
            const levelMeta = levelInfo(level);
            return (
              <span className="rc-rank" key={level}>
                <span
                  className="level-dot"
                  style={{ backgroundColor: levelMeta.color }}
                  aria-hidden="true"
                />
                {levelMeta.name} {formatMiles(miles)} mi
              </span>
            );
          })
        )}
      </span>

      <span className="rc-foot">
        <span>
          Avg risk <strong>{formatRisk(route.summary.avg_risk)}</strong> of 4
        </span>
        <span className="worst-chip">
          <span
            className="level-dot"
            style={{ backgroundColor: worst.color }}
            aria-hidden="true"
          />
          {worst.name} worst
        </span>
      </span>

      {recommended && (
        <span className="rc-reason" data-testid="recommendation-reason">
          {reason}
        </span>
      )}
    </button>
  );
}

interface RouteCardsProps {
  plan: PlanResponse;
  selectedId: string | null;
  onSelect: (routeId: string) => void;
}

/**
 * Routes are ranked by No Travel miles first, so if the best route has any, every
 * route does; the same holds for Severe once No Travel is zero. Nothing is hidden:
 * the ranking stays, the warning only says no option is clean.
 */
function noSafeRouteWarning(plan: PlanResponse): string | null {
  const best = plan.routes.find((route) => route.id === plan.recommended_id);
  if (best === undefined || plan.routes.length < 2) {
    return null;
  }
  if (best.summary.miles_by_level[NO_TRAVEL_LEVEL] > 0) {
    return "Every route crosses No Travel weather. Consider a later departure.";
  }
  if (best.summary.miles_by_level[SEVERE_LEVEL] > 0) {
    return "Every route crosses Severe weather. Consider a later departure.";
  }
  return null;
}

export default function RouteCards({
  plan,
  selectedId,
  onSelect,
}: RouteCardsProps) {
  const warning = noSafeRouteWarning(plan);
  return (
    <section className="section" aria-labelledby="routes-heading">
      <div className="section-head">
        <h2 id="routes-heading">Routes</h2>
        <span className="section-meta">
          {plan.routes.length} option{plan.routes.length === 1 ? "" : "s"}, ranked
          by risk
        </span>
      </div>
      {warning !== null && (
        <p className="no-safe-route" role="status" data-testid="no-safe-route">
          {warning}
        </p>
      )}
      <div className="route-list">
        {plan.routes.map((route) => (
          <RouteCard
            key={route.id}
            route={route}
            recommended={route.id === plan.recommended_id}
            selected={route.id === selectedId}
            reason={plan.reason}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
