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

/** Hex colour — used for inline styles (sparkline bars, SVG fills, …).
 *  Sourced from the design system (warm palette — never green for low,
 *  which would read as a verdict). */
export const SCORE_HEX: Record<ScoreLevel, string> = {
  high: "#ce463c",
  medium: "#9a6a1f",
  low: "#a8a096",
};

/** Tailwind background class — used for the badge body. */
export const SCORE_BG_CLASS: Record<ScoreLevel, string> = {
  high: "bg-score-high/10 text-score-high",
  medium: "bg-score-medium/10 text-score-medium",
  low: "bg-muted text-score-low",
};

/** Tailwind solid colour — used for bars and dots. */
export const SCORE_SOLID_CLASS: Record<ScoreLevel, string> = {
  high: "bg-score-high",
  medium: "bg-score-medium",
  low: "bg-score-low",
};

/** Tailwind border-left class — used for card spines. */
export const SCORE_BORDER_LEFT_CLASS: Record<ScoreLevel, string> = {
  high: "border-l-score-high",
  medium: "border-l-score-medium",
  low: "border-l-score-low",
};
