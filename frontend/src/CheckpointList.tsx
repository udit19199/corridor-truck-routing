import type { Checkpoint, IntervalMi, Route } from "./api";
import { formatClock, formatMiles } from "./format";
import { levelInfo } from "./levels";

interface CheckpointListProps {
  route: Route;
  /** The plan's checkpoint spacing, which a short route can differ from. */
  intervalMi: IntervalMi;
  /** Mile of the checkpoint whose popup is open on this route, if any. */
  focusedMile: number | null;
  onFocus: (checkpoint: Checkpoint) => void;
}

export default function CheckpointList({
  route,
  intervalMi,
  focusedMile,
  onFocus,
}: CheckpointListProps) {
  return (
    <section className="section" aria-labelledby="checkpoints-heading">
      <div className="section-head">
        <h2 id="checkpoints-heading">Checkpoints</h2>
        <span className="section-meta">
          Route {route.id}, {route.checkpoints.length} checkpoint
          {route.checkpoints.length === 1 ? "" : "s"} every {intervalMi} mi
        </span>
      </div>

      {route.checkpoints.length === 0 ? (
        <p className="section-empty">No checkpoints on this route.</p>
      ) : (
        <div className="cp-list">
          {route.checkpoints.map((checkpoint) => {
            const levelMeta = levelInfo(checkpoint.level);
            return (
              <button
                key={`${checkpoint.mile}-${checkpoint.eta}`}
                type="button"
                className="cp-row"
                data-testid="checkpoint-row"
                data-level={checkpoint.level}
                data-eta={checkpoint.eta}
                data-mile={checkpoint.mile}
                aria-current={checkpoint.mile === focusedMile ? "true" : undefined}
                onClick={() => onFocus(checkpoint)}
              >
                <span
                  className="cp-dot"
                  style={{ backgroundColor: levelMeta.color }}
                  aria-hidden="true"
                />
                <span className="cp-main">
                  <span className="cp-line">
                    <span className="cp-mile">Mile {formatMiles(checkpoint.mile)}</span>
                    <span className="cp-time">{formatClock(checkpoint.eta)}</span>
                  </span>
                  <span className="cp-detail">
                    <span
                      className="cp-level"
                      style={{ color: levelMeta.color }}
                    >
                      {levelMeta.name}
                    </span>
                    {checkpoint.level > 0 && (
                      <span className="cp-cause">{checkpoint.cause}</span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
