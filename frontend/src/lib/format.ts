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

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
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
  return `${weekday} ${hour}:${minute}`.trim();
}

/** "Thu 18:00" in the browser's time zone; the zone is named once in the fine print. */
export function formatClock(iso: string): string {
  return clockText(new Date(iso));
}

/** The browser's time zone abbreviation, e.g. "CST" or "PDT". */
export function timeZoneAbbreviation(): string {
  return formatParts(clockFormatter, new Date()).get("timeZoneName") ?? "";
}

/** "Thu, Nov 13, 18:00", used where the date matters. */
export function formatClockDetailed(iso: string): string {
  const parts = formatParts(detailedFormatter, new Date(iso));
  const weekday = parts.get("weekday") ?? "";
  const month = parts.get("month") ?? "";
  const day = parts.get("day") ?? "";
  const hour = parts.get("hour") ?? "00";
  const minute = parts.get("minute") ?? "00";
  return `${weekday}, ${month} ${day}, ${hour}:${minute}`.trim();
}

/** "+12 h, Thu 18:00", where hour 0 is `heatmap.start`. */
export function formatHourLabel(startIso: string, hour: number): string {
  const date = new Date(new Date(startIso).getTime() + hour * 3_600_000);
  return `+${hour} h, ${clockText(date)}`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return `${hours} h ${String(minutes).padStart(2, "0")} min`;
}

export function formatDistance(miles: number): string {
  return `${whole.format(miles)} mi`;
}

/** "45,000 lb" */
export function formatLoad(pounds: number): string {
  return `${whole.format(pounds)} lb`;
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

/** A `datetime-local` value for the given moment, in local wall-clock time. */
export function dateTimeInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value for the next full local hour. */
export function nextHourInputValue(now = new Date()): string {
  const next = new Date(now.getTime());
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return dateTimeInputValue(next);
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
