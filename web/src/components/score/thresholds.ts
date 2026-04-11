/**
 * Single source of truth for the 0–1 score colour bands.
 *
 * Every place in the UI that says "this score is high / medium / low" reads
 * its colour from this file. If the API ever changes the cutoffs, edit them
 * here and the badges, bars, sparklines, table cells, and SVG layers all
 * update together.
 *
 * The thresholds match `score_sections.py` — anything ≥ 0.3 is "flagged"
 * by the build pipeline. Below that the section is treated as in-norm.
 */

export const SCORE_THRESHOLDS = {
  high: 0.6,
  medium: 0.3,
} as const;

export type ScoreLevel = "high" | "medium" | "low";

export function scoreLevel(value: number): ScoreLevel {
  if (value >= SCORE_THRESHOLDS.high) return "high";
  if (value >= SCORE_THRESHOLDS.medium) return "medium";
  return "low";
}

/** Hex colour — used for inline styles (sparkline bars, SVG fills, …). */
export const SCORE_HEX: Record<ScoreLevel, string> = {
  high: "#ce463c", // brand red
  medium: "#c4860b", // amber
  low: "#2d8a4e", // green
};

/** Tailwind background class — used for the badge body. */
export const SCORE_BG_CLASS: Record<ScoreLevel, string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-orange-100 text-orange-800",
  low: "bg-green-100 text-green-800",
};

/** Tailwind solid colour — used for bars and dots. */
export const SCORE_SOLID_CLASS: Record<ScoreLevel, string> = {
  high: "bg-red-500",
  medium: "bg-orange-400",
  low: "bg-green-500",
};

/** Tailwind border-left class — used for card spines. */
export const SCORE_BORDER_LEFT_CLASS: Record<ScoreLevel, string> = {
  high: "border-l-red-500",
  medium: "border-l-orange-400",
  low: "border-l-green-500",
};
