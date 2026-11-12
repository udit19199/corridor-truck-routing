import { useEffect, useState } from "react";
import { formatHourLabel } from "./format";

interface HourSliderProps {
  departure: string;
  resetKey: number;
  onHour: (hour: number) => void;
}

export default function HourSlider({ departure, resetKey, onHour }: HourSliderProps) {
  const [hour, setHour] = useState(0);

  // A new plan starts at its departure hour; the map controller applies hour 0.
  useEffect(() => {
    setHour(0);
    onHour(0);
  }, [resetKey, onHour]);

  const label = formatHourLabel(departure, hour);
  const fill = `${(hour / 48) * 100}%`;

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
        max={48}
        step={1}
        value={hour}
        aria-label="Forecast hour"
        aria-valuetext={label}
        style={{
          backgroundImage: `linear-gradient(to right, var(--accent-bright) 0%, var(--accent-bright) ${fill}, var(--line-strong) ${fill}, var(--line-strong) 100%)`,
        }}
        onChange={(event) => {
          const next = Number(event.target.value);
          setHour(next);
          onHour(next);
        }}
      />
      <div className="range-ticks" aria-hidden="true">
        <span>0 h</span>
        <span>24 h</span>
        <span>48 h</span>
      </div>
    </div>
  );
}
