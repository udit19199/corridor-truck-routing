import type { Level, PlanResponse, Route, RouteSummary } from "../api";
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatMiles,
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
  onSelect: (routeId: string) => void;
}

function RouteCard({
  route,
  recommended,
  selected,
  onSelect,
}: RouteCardProps) {
  const levelMiles = milesByLevel(route.summary.miles_by_level, ALL_LEVELS);
  const rankMiles = milesByLevel(route.summary.miles_by_level, RANK_LEVELS);
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

      <span className="rc-line">
        {formatDuration(route.duration_s)}, {formatDistance(route.distance_mi)},
        arrives {formatClock(route.arrival)}
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
    </button>
  );
}

interface RouteCardsProps {
  plan: PlanResponse;
  selectedId: string | null;
  onSelect: (routeId: string) => void;
}

/**
 * Routes are ranked No Travel first, then Severe, so if the best route has any,
 * every route does. Nothing is hidden: the ranking stays, the warning only says
 * no option is clean.
 */
function noSafeRouteWarning(plan: PlanResponse): string | null {
  const miles = plan.routes[0]!.summary.miles_by_level;
  const level =
    miles[NO_TRAVEL_LEVEL] > 0 ? "No Travel" : miles[SEVERE_LEVEL] > 0 ? "Severe" : null;
  if (level === null) {
    return null;
  }
  const routes = plan.routes.length > 1 ? "Every route crosses" : "The only route crosses";
  return `${routes} ${level} weather. Consider a later departure.`;
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
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
