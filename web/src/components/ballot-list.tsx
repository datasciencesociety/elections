/**
 * BallotList — single component for rendering "what people voted for" in a
 * polling station / region. Replaces three near-identical PartyBar
 * implementations and the SectionResults party block.
 *
 * Variants:
 *   - "stacked-bar" — horizontal stacked percentage bar + compact legend.
 *                     Used in section-preview and section-detail cards.
 *   - "full-rows"   — one row per entry with name/votes/pct + bar scaled to
 *                     the leader's votes. Used in the map sidebar.
 *
 * The component is variant-agnostic about election type. The display name
 * (`name` / `short_name`) is supplied by the API which already encodes the
 * candidates-vs-parties rule via `COALESCE(ep.name_on_ballot, ...)`.
 */

import type { CSSProperties } from "react";

export interface BallotEntry {
  party_id?: number;
  name: string;
  short_name: string;
  color: string | null;
  votes: number;
  pct: number;
  paper?: number;
  machine?: number;
}

type Variant = "stacked-bar" | "full-rows";
type Density = "sm" | "md";

interface Props {
  entries: BallotEntry[];
  variant?: Variant;
  /** Used by stacked-bar variant. `sm` = section-preview style, `md` = section-detail. */
  density?: Density;
  /** Limit visible rows. Defaults to 5 for stacked-bar, all for full-rows. */
  topN?: number;
  className?: string;
}

const FALLBACK_COLOR = "#cccccc";

/** Truncate to 2 decimals without rounding (3.999 → "3.99"). */
function pct2(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2);
}

export default function BallotList({
  entries,
  variant = "stacked-bar",
  density = "md",
  topN,
  className,
}: Props) {
  if (entries.length === 0) return null;

  const limit = topN ?? (variant === "stacked-bar" ? 5 : entries.length);
  const visible = entries.slice(0, limit);
  const totalVotes = entries.reduce((sum, e) => sum + e.votes, 0);
  if (totalVotes === 0) return null;

  if (variant === "stacked-bar") {
    return (
      <StackedBar entries={visible} density={density} className={className} />
    );
  }

  return <FullRows entries={visible} className={className} />;
}

// ---------- stacked-bar variant ----------

function StackedBar({
  entries,
  density,
  className,
}: {
  entries: BallotEntry[];
  density: Density;
  className?: string;
}) {
  const isCompact = density === "sm";
  const dotSize = isCompact ? "h-1.5 w-1.5" : "h-1.5 w-1.5";
  const dotShape = isCompact ? "rounded-sm" : "rounded-full";
  const itemText = isCompact ? "text-[9px]" : "text-[10px]";
  const valueText = isCompact ? "text-[9px]" : "text-[10px]";
  const legendGap = isCompact ? "gap-x-2 gap-y-0" : "gap-x-3 gap-y-0";
  const wrapperSpacing = isCompact ? "space-y-0.5" : "space-y-1";
  const trackBg = isCompact ? "" : "bg-muted";

  return (
    <div className={`${wrapperSpacing} ${className ?? ""}`.trim()}>
      <div
        className={`flex h-2.5 w-full overflow-hidden rounded-full ${trackBg}`.trim()}
      >
        {entries.map((entry, i) => (
          <div
            key={entry.party_id ?? `${entry.name}-${i}`}
            style={swatch(entry.color, entry.pct)}
            title={`${entry.short_name}: ${entry.pct.toFixed(1)}%`}
            className={isCompact ? undefined : "transition-opacity hover:opacity-80"}
          />
        ))}
      </div>
      <div className={`flex flex-wrap ${legendGap}`}>
        {entries.map((entry, i) => (
          <div
            key={entry.party_id ?? `${entry.name}-${i}`}
            className={`flex items-center gap-1 ${itemText}`}
          >
            <div
              className={`${dotSize} shrink-0 ${dotShape}`}
              style={{ backgroundColor: entry.color || FALLBACK_COLOR }}
            />
            <span className="truncate text-muted-foreground">{entry.short_name}</span>
            <span className={`font-mono tabular-nums ${valueText}`}>
              {entry.pct.toFixed(isCompact ? 0 : 1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function swatch(color: string | null, pct: number): CSSProperties {
  return {
    width: `${pct}%`,
    backgroundColor: color || FALLBACK_COLOR,
  };
}

// ---------- full-rows variant ----------

function FullRows({
  entries,
  className,
}: {
  entries: BallotEntry[];
  className?: string;
}) {
  const maxVotes = entries[0]?.votes ?? 1;

  return (
    <div className={`space-y-2 ${className ?? ""}`.trim()}>
      {entries.map((entry, i) => (
        <div key={entry.party_id ?? `${entry.name}-${i}`}>
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 overflow-hidden">
              <span
                className="size-2.5 flex-shrink-0 rounded-sm"
                style={{ background: entry.color || "#888" }}
              />
              <span className="truncate text-[11px]" title={entry.name}>
                {entry.short_name}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-[11px] font-mono font-semibold tabular-nums">
                {pct2(entry.pct)}%
              </span>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                {entry.votes.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(entry.votes / maxVotes) * 100}%`,
                background: entry.color || "#888",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
