import type { Checkpoint, Route } from "./api";
import { formatClock, formatClockDetailed, formatMiles } from "./format";
import { levelInfo } from "./levels";

interface CheckpointListProps {
  route: Route;
  onFocus: (checkpoint: Checkpoint) => void;
}

export default function CheckpointList({ route, onFocus }: CheckpointListProps) {
  return (
    <section className="section" aria-labelledby="checkpoints-heading">
      <div className="section-head">
        <h2 id="checkpoints-heading">Checkpoints</h2>
        <span className="section-meta">
          Route {route.id}, {route.checkpoints.length} stop
          {route.checkpoints.length === 1 ? "" : "s"}
        </span>
      </div>

      {route.checkpoints.length === 0 ? (
        <p className="section-empty">No checkpoints on this route.</p>
      ) : (
        <div className="cp-list">
          {route.checkpoints.map((checkpoint) => {
            const info = levelInfo(checkpoint.level);
            return (
              <button
                key={`${checkpoint.mile}-${checkpoint.eta}`}
                type="button"
                className="cp-row"
                data-testid="checkpoint-row"
                data-level={checkpoint.level}
                data-eta={checkpoint.eta}
                title={checkpoint.cause}
                aria-label={`Mile ${formatMiles(checkpoint.mile)}, ${info.name}, arriving ${formatClockDetailed(
                  checkpoint.eta,
                )}. ${checkpoint.cause}`}
                onClick={() => onFocus(checkpoint)}
              >
                <span
                  className="cp-dot"
                  style={{ backgroundColor: info.color }}
                  aria-hidden="true"
                />
                <span className="cp-mile">Mile {formatMiles(checkpoint.mile)}</span>
                <span className="cp-time">{formatClock(checkpoint.eta)}</span>
                <span className="cp-level">{info.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
