const clockFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

const detailedFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

const wholeMiles = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fractionalMiles = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function formatParts(formatter: Intl.DateTimeFormat, date: Date): Map<string, string> {
  const parts = new Map<string, string>();
  for (const part of formatter.formatToParts(date)) {
    parts.set(part.type, part.value);
  }
  return parts;
}

function clockText(date: Date): string {
  const parts = formatParts(clockFormatter, date);
  const weekday = parts.get("weekday") ?? "";
  const hour = parts.get("hour") ?? "00";
  const minute = parts.get("minute") ?? "00";
  const zone = parts.get("timeZoneName") ?? "";
  return `${weekday} ${hour}:${minute} ${zone}`.trim();
}

/** "Thu 18:00 CST" in the browser's time zone. */
export function formatClock(iso: string): string {
  return clockText(new Date(iso));
}

/** "Thu, Nov 13, 18:00 CST" — used where the date matters. */
export function formatClockDetailed(iso: string): string {
  const parts = formatParts(detailedFormatter, new Date(iso));
  const weekday = parts.get("weekday") ?? "";
  const month = parts.get("month") ?? "";
  const day = parts.get("day") ?? "";
  const hour = parts.get("hour") ?? "00";
  const minute = parts.get("minute") ?? "00";
  const zone = parts.get("timeZoneName") ?? "";
  return `${weekday}, ${month} ${day}, ${hour}:${minute} ${zone}`.trim();
}

/** "+12 h, Thu 18:00 CST" */
export function formatHourLabel(departureIso: string, hour: number): string {
  const date = new Date(new Date(departureIso).getTime() + hour * 3_600_000);
  return `+${hour} h, ${clockText(date)}`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} m`;
  }
  return `${hours} h ${String(minutes).padStart(2, "0")} m`;
}

export function formatDistance(miles: number): string {
  return `${wholeMiles.format(miles)} mi`;
}

export function formatMiles(miles: number): string {
  return fractionalMiles.format(miles);
}

export function formatRisk(value: number): string {
  return value.toFixed(2);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** A `datetime-local` value for the next full local hour. */
export function nextHourInputValue(now = new Date()): string {
  const next = new Date(now.getTime());
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(
    next.getHours(),
  )}:00`;
}

/** `datetime-local` values are local wall-clock time; the API wants UTC ISO. */
export function localDateTimeToIso(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
