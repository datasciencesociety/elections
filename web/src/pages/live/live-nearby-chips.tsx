import { useMemo } from "react";
import type { LiveSection } from "@/lib/api/live-sections.js";
import type { LiveMetrics, LiveSectionMetric } from "@/lib/api/live-metrics.js";
import { cn } from "@/lib/utils";
import { statusTone, type UiStatus } from "./live-status-badge.js";
import { findNearby } from "./nearby.js";

/**
 * Two short rows of "other sections in this building / down the street"
 * chips. Same-address gets a bulk "open all" pill on the side — common
 * case for observers watching a multi-room school. Other-nearby chips
 * open one at a time.
 *
 * Each chip carries the target's live status as a coloured dot so the
 * viewer can pick the red one first.
 */
export function LiveNearbyChips({
  target,
  allSections,
  metrics,
  streamBySection,
  openCodes,
  onOpen,
  onOpenMany,
}: {
  target: LiveSection;
  allSections: LiveSection[];
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  openCodes: string[];
  onOpen: (code: string) => void;
  onOpenMany: (codes: string[]) => void;
}) {
  const { sameAddress, nearby } = useMemo(
    () => findNearby(target, allSections),
    [target, allSections],
  );

  if (sameAddress.length === 0 && nearby.length === 0) return null;

  const openSet = new Set(openCodes);
  const sameAddressToOpen = sameAddress
    .filter((s) => !openSet.has(s.section_code))
    .map((s) => s.section_code);

  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
      {sameAddress.length > 0 && (
        <NearbyRow
          label={`Още ${pluralSection(sameAddress.length)} на същия адрес`}
          sections={sameAddress}
          metrics={metrics}
          streamBySection={streamBySection}
          openCodes={openSet}
          onOpen={onOpen}
          action={
            sameAddressToOpen.length > 0
              ? {
                  label: `отвори всички (${sameAddressToOpen.length})`,
                  onClick: () => onOpenMany(sameAddressToOpen),
                }
              : undefined
          }
        />
      )}
      {nearby.length > 0 && (
        <NearbyRow
          label="Наблизо"
          sections={nearby}
          metrics={metrics}
          streamBySection={streamBySection}
          openCodes={openSet}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}

function NearbyRow({
  label,
  sections,
  metrics,
  streamBySection,
  openCodes,
  onOpen,
  action,
}: {
  label: string;
  sections: LiveSection[];
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  openCodes: Set<string>;
  onOpen: (code: string) => void;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xs font-medium uppercase tracking-eyebrow text-muted-foreground">
          {label}
        </span>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="text-3xs font-medium uppercase tracking-eyebrow text-score-high transition-colors hover:text-foreground"
          >
            {action.label} →
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {sections.map((s) => (
          <NearbyChip
            key={s.section_code}
            section={s}
            metric={metrics?.[s.section_code]}
            hasStream={streamBySection.has(s.section_code)}
            open={openCodes.has(s.section_code)}
            onClick={() => onOpen(s.section_code)}
          />
        ))}
      </div>
    </div>
  );
}

function NearbyChip({
  section,
  metric,
  hasStream,
  open,
  onClick,
}: {
  section: LiveSection;
  metric: LiveSectionMetric | undefined;
  hasStream: boolean;
  open: boolean;
  onClick: () => void;
}) {
  const uiStatus: UiStatus = hasStream
    ? metric?.status && metric.status !== "ok"
      ? metric.status
      : "live"
    : metric
      ? metric.status
      : "no_camera";
  const tone = statusTone(uiStatus);
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
      title={section.address}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-3xs tabular-nums transition-colors",
        open
          ? "cursor-default border-border/60 bg-muted/40 text-muted-foreground"
          : "border-border bg-background text-foreground hover:bg-secondary",
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      {section.section_code}
      {open && <span className="text-3xs uppercase tracking-eyebrow">·отв.</span>}
    </button>
  );
}

function pluralSection(n: number): string {
  return n === 1 ? "1 секция" : `${n} секции`;
}
