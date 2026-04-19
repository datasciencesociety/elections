import type { LiveSection } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";
import { LiveVideoCard } from "./live-video-card.js";

/** Base card width on desktop — matches the MapLibre tooltip / sidebar
 * rhythm used across the site. Stays readable for a single ~16:9 stream. */
const CARD_WIDTH_PX = 360;
/** Cap so an observer opening 10 sections doesn't eat the whole map. */
const MAX_COLS = 3;

/**
 * Right-hand drawer that stacks all currently-opened video cards. The
 * drawer grows wider as more cards open so the viewer can actually see
 * each stream instead of squinting at a 380 px column. Layout rules:
 *
 *   - mobile: vertical strip under the map, single column, full width.
 *   - desktop, 1–2 cards: single 360 px column.
 *   - desktop, 3–4 cards: two columns (720 px sidebar).
 *   - desktop, 5+ cards:  three columns (1080 px), capped so the map
 *     still occupies at least 40 % of the viewport.
 */
export function LiveVideoPanel({
  openSections,
  openCodes,
  allSections,
  metrics,
  streamBySection,
  latestElectionId,
  onOpen,
  onOpenMany,
  onClose,
}: {
  openSections: LiveSection[];
  openCodes: string[];
  allSections: LiveSection[];
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  latestElectionId: string | number | undefined;
  onOpen: (code: string) => void;
  onOpenMany: (codes: string[]) => void;
  onClose: (code: string) => void;
}) {
  if (openSections.length === 0) return null;

  const cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(openSections.length / 2)));
  const desktopWidthPx = cols * CARD_WIDTH_PX;

  return (
    <aside
      className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-border bg-background/95 p-3 backdrop-blur md:max-w-[60vw] md:border-l md:border-t-0"
      style={{ ["--panel-width" as string]: `${desktopWidthPx}px` }}
    >
      <div
        className="grid gap-3 md:[grid-template-columns:repeat(var(--panel-cols),minmax(0,1fr))] md:w-[var(--panel-width)]"
        style={{ ["--panel-cols" as string]: String(cols) }}
      >
        {openSections.map((s) => (
          <LiveVideoCard
            key={s.section_code}
            section={s}
            metric={metrics?.[s.section_code]}
            streamUrl={streamBySection.get(s.section_code)}
            latestElectionId={latestElectionId}
            allSections={allSections}
            metrics={metrics}
            streamBySection={streamBySection}
            openCodes={openCodes}
            onOpen={onOpen}
            onOpenMany={onOpenMany}
            onClose={() => onClose(s.section_code)}
          />
        ))}
      </div>
    </aside>
  );
}
