import type { Checkpoint, Route } from "../api";
import { formatClock, formatMiles } from "../lib/format";
import { levelInfo } from "../lib/levels";

interface CheckpointListProps {
  route: Route;
  /** Mile of the checkpoint whose popup is open on this route, if any. */
  focusedMile: number | null;
  onFocus: (checkpoint: Checkpoint) => void;
}

export default function CheckpointList({
  route,
  focusedMile,
  onFocus,
}: CheckpointListProps) {
  return (
    <section className="section" aria-labelledby="checkpoints-heading">
      <div className="section-head">
        <h2 id="checkpoints-heading">Checkpoints</h2>
        <span className="section-meta">
          Route {route.id}
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
                <span className="cp-mile">
                  Mile {formatMiles(checkpoint.mile)}
                </span>
                {checkpoint.level > 0 ? (
                  <span className="cp-cause">
                    {levelMeta.name}: {checkpoint.cause}
                  </span>
                ) : (
                  <span className="sr-only">{levelMeta.name}</span>
                )}
                <span className="cp-time">{formatClock(checkpoint.eta)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
