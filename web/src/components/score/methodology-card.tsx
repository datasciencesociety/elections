import { useState, type ReactNode } from "react";
import { ScoreBar } from "./score-bar.js";

/**
 * Collapsible card with a title, a numeric score, a coloured bar, and an
 * arbitrary expandable body. Used by every per-methodology card in the
 * section view (Benford, peer, ACF, …) and is the right place for any
 * future "expandable detail" sections in the same family.
 *
 * Pure presentation — `useState` for the expanded toggle is the only
 * internal state.
 */
export function MethodologyCard({
  title,
  score,
  children,
  show = true,
}: {
  title: string;
  score: number;
  children: ReactNode;
  show?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!show) return null;

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">{title}</span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground">
              {score.toFixed(2)}
            </span>
          </div>
          <ScoreBar value={score} className="mt-1.5" />
        </div>
        <span className="text-[10px] text-muted-foreground">
          {expanded ? "▲" : "▼"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2">{children}</div>
      )}
    </div>
  );
}
