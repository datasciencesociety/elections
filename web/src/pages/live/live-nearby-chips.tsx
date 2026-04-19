import { useMemo } from "react";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";
import { cn } from "@/lib/utils";
import { addressTone } from "./live-map.js";
import { findNearbyAddresses } from "./nearby.js";

/**
 * "Other polling places down the street" — a small chip row inside each
 * open card. Clicking a chip opens that address's card. Already-open
 * addresses show greyed-out so the chip row reflects panel state.
 */
export function LiveNearbyChips({
  target,
  allAddresses,
  metrics,
  liveCodes,
  openIds,
  onOpen,
}: {
  target: LiveAddress;
  allAddresses: LiveAddress[];
  metrics: LiveMetrics | undefined;
  liveCodes: Set<string>;
  openIds: string[];
  onOpen: (id: string) => void;
}) {
  const nearby = useMemo(
    () => findNearbyAddresses(target, allAddresses),
    [target, allAddresses],
  );

  if (nearby.length === 0) return null;

  const openSet = new Set(openIds);

  return (
    <div className="flex flex-col gap-1 border-t border-border px-3 py-2">
      <span className="text-3xs font-medium uppercase tracking-eyebrow text-muted-foreground">
        Наблизо
      </span>
      <div className="flex flex-wrap gap-1">
        {nearby.map((a) => (
          <NearbyChip
            key={a.id}
            address={a}
            tone={addressTone(a, metrics, liveCodes)}
            open={openSet.has(a.id)}
            onClick={() => onOpen(a.id)}
          />
        ))}
      </div>
    </div>
  );
}

function NearbyChip({
  address,
  tone,
  open,
  onClick,
}: {
  address: LiveAddress;
  tone: "green" | "red" | "grey";
  open: boolean;
  onClick: () => void;
}) {
  const dotClass =
    tone === "green"
      ? "bg-emerald-500"
      : tone === "red"
        ? "bg-score-high"
        : "bg-muted-foreground/50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={open}
      title={address.address}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-3xs tabular-nums transition-colors",
        open
          ? "cursor-default border-border/60 bg-muted/40 text-muted-foreground"
          : "border-border bg-background text-foreground hover:bg-secondary",
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      {address.section_codes[0]}
      {address.section_codes.length > 1 && (
        <span className="text-3xs text-muted-foreground">
          +{address.section_codes.length - 1}
        </span>
      )}
      {open && <span className="text-3xs uppercase tracking-eyebrow">·отв.</span>}
    </button>
  );
}
