import { SCORE_SOLID_CLASS, scoreLevel } from "./thresholds.js";

/**
 * Horizontal progress bar showing a score from 0 to 1, coloured by the same
 * thresholds as `ScoreBadge`. Used inside `MethodologyCard` headers and
 * anywhere else a card wants a continuous visual instead of a chip.
 */
export function ScoreBar({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const color = SCORE_SOLID_CLASS[scoreLevel(value)];
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-muted ${className ?? ""}`}
    >
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.min(value * 100, 100)}%` }}
      />
    </div>
  );
}
