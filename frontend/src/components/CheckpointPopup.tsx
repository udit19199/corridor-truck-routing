import type { ReactNode } from "react";
import type { Checkpoint, Level } from "../api";
import { formatClockDetailed, formatDistance, formatMiles } from "../lib/format";
import { levelInfo } from "../lib/levels";

const CONDITION_LABELS = { wind: "Wind", rain: "Rain", snow: "Snow" } as const;

type Condition = keyof typeof CONDITION_LABELS;

export interface PopupState {
  routeId: string;
  checkpoint: Checkpoint;
}

function settingCondition(checkpoint: Checkpoint): Condition | null {
  if (checkpoint.level === 0) {
    return null;
  }
  const levels = checkpoint.levels;
  if (levels.wind === checkpoint.level) {
    return "wind";
  }
  if (levels.snow === checkpoint.level) {
    return "snow";
  }
  if (levels.rain === checkpoint.level) {
    return "rain";
  }
  return null;
}

function ConditionRow({
  condition,
  level,
  setsLevel,
  children,
}: {
  condition: Condition;
  level: Level;
  setsLevel: boolean;
  children: ReactNode;
}) {
  const info = levelInfo(level);
  return (
    <div className={condition === "wind" ? "popup-wide" : undefined}>
      <dt>{CONDITION_LABELS[condition]}</dt>
      <dd>
        {children}
        <span className="popup-condition" style={{ color: info.color }}>
          {info.name}
          {setsLevel ? ", sets the level" : ""}
        </span>
      </dd>
    </div>
  );
}

export default function CheckpointPopup({ routeId, checkpoint }: PopupState) {
  const info = levelInfo(checkpoint.level);
  const weather = checkpoint.weather;
  const warns = checkpoint.level > 0;
  const setBy = settingCondition(checkpoint);

  return (
    <div className="popup">
      <div className="popup-head">
        <span
          className="popup-dot"
          style={{ backgroundColor: info.color }}
          aria-hidden="true"
        />
        <span className="popup-level">{info.name}</span>
        <span className="popup-mile">
          Route {routeId}, mile {formatMiles(checkpoint.mile)}
        </span>
      </div>
      <dl className="popup-grid">
        <div className="popup-wide">
          <dt>ETA</dt>
          <dd>{formatClockDetailed(checkpoint.eta)}</dd>
        </div>
        <div>
          <dt>Covers</dt>
          <dd>{formatDistance(checkpoint.covers_mi)}</dd>
        </div>
        <ConditionRow
          condition="wind"
          level={checkpoint.levels.wind}
          setsLevel={setBy === "wind"}
        >
          {weather.wind_mph.toFixed(1)} mph (gusts {weather.gust_mph.toFixed(1)} mph)
        </ConditionRow>
        <ConditionRow
          condition="rain"
          level={checkpoint.levels.rain}
          setsLevel={setBy === "rain"}
        >
          {weather.rain_in_hr.toFixed(2)} in/hr
        </ConditionRow>
        <ConditionRow
          condition="snow"
          level={checkpoint.levels.snow}
          setsLevel={setBy === "snow"}
        >
          {weather.snow_in_hr.toFixed(2)} in/hr
        </ConditionRow>
      </dl>
      {warns && <p className="popup-cause">{checkpoint.cause}</p>}
    </div>
  );
}
