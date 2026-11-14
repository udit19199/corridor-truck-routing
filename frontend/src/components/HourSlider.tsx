import { useState } from "react";
import { formatHourLabel } from "../lib/format";

interface HourSliderProps {
  /** Heatmap hour 0: the departure floored to the whole hour. */
  start: string;
  /** Highest forecast hour, the number of levels per cell minus 1. */
  maxHour: number;
  onHour: (hour: number) => void;
}

// App remounts this with a new key per plan, so each plan starts at hour 0.
export default function HourSlider({ start, maxHour, onHour }: HourSliderProps) {
  const [hour, setHour] = useState(0);

  const label = formatHourLabel(start, hour);
  const span = Math.max(maxHour, 1);
  const fill = `${(hour / span) * 100}%`;
  const midpointHour = Math.round(maxHour / 2);

  return (
    <div className="hour-slider">
      <div className="hour-slider-head">
        <span className="hour-label" data-testid="hour-label">
          {label}
        </span>
        <span className="hour-context">Corridor forecast</span>
      </div>
      <input
        className="hour-range"
        data-testid="hour-slider"
        type="range"
        min={0}
        max={maxHour}
        step={1}
        value={hour}
        aria-label="Forecast hour"
        aria-valuetext={label}
        style={{
          backgroundImage: `linear-gradient(to right, var(--accent-bright) 0%, var(--accent-bright) ${fill}, var(--line-strong) ${fill}, var(--line-strong) 100%)`,
        }}
        onChange={(event) => {
          const nextHour = Number(event.target.value);
          setHour(nextHour);
          onHour(nextHour);
        }}
      />
      <div className="range-ticks" aria-hidden="true">
        <span>0 h</span>
        <span>{midpointHour} h</span>
        <span>{maxHour} h</span>
      </div>
    </div>
  );
}
