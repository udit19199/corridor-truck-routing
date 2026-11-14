import type { Level } from "./api";

interface LevelInfo {
  readonly name: string;
  readonly color: string;
}

/**
 * The only place risk levels get names or colours. Indexed by Level.
 * The map, cards, checkpoint list and legend all read from this table.
 * Lightness is tuned for the dark map and panel: every hue clears 3:1 there.
 */
export const LEVELS = [
  { name: "Low", color: "#3fb96b" },
  { name: "Moderate", color: "#f2c230" },
  { name: "High", color: "#ff8f3c" },
  { name: "Severe", color: "#f04b45" },
  { name: "No Travel", color: "#b46bff" },
] as const satisfies readonly [LevelInfo, LevelInfo, LevelInfo, LevelInfo, LevelInfo];

export function levelInfo(level: Level): LevelInfo {
  return LEVELS[level];
}

// The two levels the ranking and the "no safe route" warning name explicitly.
export const SEVERE_LEVEL = 3 satisfies Level;
export const NO_TRAVEL_LEVEL = 4 satisfies Level;
