import { useEffect, useState } from "react";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";
import { LiveAddressCard } from "./live-video-card.js";

const CARD_WIDTH_PX = 360;
/** Rough card height estimate for the column-fill calc. 16:9 video at
 *  360 px is 203 px, plus ~200 px for header + actions + nearby chips. */
const CARD_HEIGHT_ESTIMATE_PX = 420;
/** Reserved vertical chrome (nav + title strip + breathing room). */
const VERTICAL_CHROME_PX = 120;

/**
 * Panel layout rules (desktop):
 *   - start at one 360 px column
 *   - stack cards vertically until they'd overflow the viewport
 *   - then start column 2, then column 3, ...
 *   - cap total panel width at half the viewport
 *   - once columns are capped, further cards extend below → scroll
 *
 * Implemented with `grid-auto-flow: column` + explicit row count computed
 * from viewport height. Cards flow top-to-bottom in each column, then
 * wrap to the next column, matching the user's "vertical first" intent.
 */
export function LiveVideoPanel({
  openAddresses,
  openIds,
  allAddresses,
  metrics,
  streamBySection,
  liveCodes,
  onOpen,
  onClose,
}: {
  openAddresses: LiveAddress[];
  openIds: string[];
  allAddresses: LiveAddress[];
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  liveCodes: Set<string>;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { cardsPerCol, cols } = useGridShape(openAddresses.length);

  if (openAddresses.length === 0) return null;

  const desktopWidthPx = cols * CARD_WIDTH_PX + (cols - 1) * 12;

  return (
    <aside
      className="flex w-full shrink-0 flex-col overflow-auto border-t border-border bg-background/95 p-3 backdrop-blur max-h-[60vh] md:max-h-none md:border-l md:border-t-0"
      style={{ ["--panel-width" as string]: `${desktopWidthPx}px` }}
    >
      <div
        className="grid gap-3 md:w-[var(--panel-width)] md:[grid-auto-flow:column] md:[grid-template-rows:repeat(var(--panel-rows),min-content)]"
        style={{ ["--panel-rows" as string]: String(cardsPerCol) }}
      >
        {openAddresses.map((a) => (
          <LiveAddressCard
            key={a.id}
            address={a}
            metrics={metrics}
            streamBySection={streamBySection}
            allAddresses={allAddresses}
            openIds={openIds}
            liveCodes={liveCodes}
            onOpen={onOpen}
            onClose={() => onClose(a.id)}
          />
        ))}
      </div>
    </aside>
  );
}

/**
 * Compute a rows × cols shape for the card grid based on current viewport
 * and how many addresses are open. Recomputed on resize.
 *
 *   cardsPerCol = floor(usable_height / card_height)    — vertical fit
 *   maxCols     = floor(viewport_width * 0.5 / card_w)  — half-screen cap
 *   cols        = min(maxCols, ceil(count / cardsPerCol))
 */
function useGridShape(count: number): { cardsPerCol: number; cols: number } {
  const [shape, setShape] = useState(() => computeShape(count));
  useEffect(() => {
    setShape(computeShape(count));
  }, [count]);
  useEffect(() => {
    const onResize = () => setShape(computeShape(count));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [count]);
  return shape;
}

function computeShape(count: number): { cardsPerCol: number; cols: number } {
  if (typeof window === "undefined") return { cardsPerCol: 2, cols: 1 };
  const usableH = Math.max(CARD_HEIGHT_ESTIMATE_PX, window.innerHeight - VERTICAL_CHROME_PX);
  const cardsPerCol = Math.max(1, Math.floor(usableH / CARD_HEIGHT_ESTIMATE_PX));
  const maxCols = Math.max(
    1,
    Math.floor((window.innerWidth * 0.5) / CARD_WIDTH_PX),
  );
  const cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.max(1, count) / cardsPerCol)));
  return { cardsPerCol, cols };
}
