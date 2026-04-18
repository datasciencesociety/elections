/**
 * Score primitives — colour bands, badges, bars, formula rows, and the
 * collapsible methodology card. Anything in the UI that visualises a
 * 0–1 score should import from here.
 */

export { ScoreBadge } from "./score-badge.js";
export { ScoreBar } from "./score-bar.js";
export { FormulaRow } from "./formula-row.js";
export { MethodologyCard } from "./methodology-card.js";
export {
  SCORE_HEX,
  SCORE_SOLID_CLASS,
  SCORE_BORDER_LEFT_CLASS,
  scoreLevel,
} from "./thresholds.js";
