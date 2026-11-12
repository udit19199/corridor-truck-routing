import type { PlanResponse, Route } from "./api";
import { formatClock, formatDistance, formatDuration, formatMiles, formatRisk } from "./format";
import { LEVELS, levelInfo } from "./levels";

interface RouteCardProps {
  route: Route;
  recommended: boolean;
  selected: boolean;
  reason: string;
  onSelect: (routeId: string) => void;
}

function RouteCard({ route, recommended, selected, reason, onSelect }: RouteCardProps) {
  const segments = LEVELS.flatMap((info, level) => {
    const miles = route.summary.miles_by_level[level];
    return miles === undefined || miles <= 0 ? [] : [{ info, miles }];
  });
  const worst = levelInfo(route.summary.worst);
  const barLabel = segments
    .map((segment) => `${segment.info.name}: ${formatMiles(segment.miles)} miles`)
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
        <span className="rc-letter" aria-hidden="true">
          {route.id}
        </span>
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

      <span className="risk-bar" role="img" aria-label={`Miles by risk level (${barLabel})`}>
        {segments.map((segment) => (
          <span
            key={segment.info.name}
            title={`${segment.info.name}: ${formatMiles(segment.miles)} mi`}
            style={{
              flexGrow: segment.miles,
              flexBasis: 0,
              backgroundColor: segment.info.color,
            }}
          />
        ))}
      </span>

      <span className="rc-foot">
        <span>
          Avg risk <strong>{formatRisk(route.summary.avg_risk)}</strong>
        </span>
        <span className="worst-chip">
          <span className="worst-dot" style={{ backgroundColor: worst.color }} aria-hidden="true" />
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

export default function RouteCards({ plan, selectedId, onSelect }: RouteCardsProps) {
  return (
    <section className="section" aria-labelledby="routes-heading">
      <div className="section-head">
        <h2 id="routes-heading">Routes</h2>
        <span className="section-meta">
          {plan.routes.length} option{plan.routes.length === 1 ? "" : "s"}, ranked by risk
        </span>
      </div>
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
