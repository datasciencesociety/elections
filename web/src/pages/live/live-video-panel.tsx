import type { LiveSection } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";
import { LiveVideoCard } from "./live-video-card.js";

/**
 * Right-hand drawer that stacks all currently-opened video cards. Order:
 * most-recently-opened on top so the click target doesn't jump around while
 * the user is scanning the map.
 *
 * On narrow viewports the drawer drops to a scrollable strip under the map;
 * on desktop it's a fixed-width column that scrolls independently.
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

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-border bg-background/95 p-3 backdrop-blur md:w-[380px] md:border-l md:border-t-0">
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
    </aside>
  );
}
