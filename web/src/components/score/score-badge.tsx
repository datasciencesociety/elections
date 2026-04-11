import { SCORE_BG_CLASS, scoreLevel } from "./thresholds.js";

/**
 * Compact score chip — small numeric value with a coloured background.
 *
 * Replaces the four near-identical `RiskBadge` components that used to live
 * in `pages/persistence.tsx`, `pages/sections-table.tsx`,
 * `pages/section-detail.tsx`, and `components/section-preview.tsx`.
 *
 * `size="sm"` is the default (table cells, inline). `size="lg"` is used by
 * the section-detail stats strip.
 */
export function ScoreBadge({
  value,
  size = "sm",
}: {
  value: number;
  size?: "sm" | "lg";
}) {
  const bg = SCORE_BG_CLASS[scoreLevel(value)];
  const sizeClass =
    size === "lg" ? "text-sm px-2 py-0.5" : "text-[11px] px-1.5 py-0.5";
  return (
    <span
      className={`inline-block rounded font-mono font-semibold tabular-nums ${bg} ${sizeClass}`}
    >
      {value.toFixed(2)}
    </span>
  );
}
