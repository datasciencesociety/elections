import { useEffect, useState, type CSSProperties } from "react";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";
import { LiveVideoCard } from "./live-video-card.js";

const CARD_HEIGHT_ESTIMATE_PX = 420;
const VERTICAL_CHROME_PX = 120;
/** Keep this much viewport reserved for the map before the panel
 *  eats it — prevents the page from horizontally scrolling. */
const MIN_MAP_WIDTH_PX = 420;

/**
 * Sidebar with one card per watched section. Cards flow top-to-bottom in
 * column 1 until they'd overflow the viewport height, then a new column
 * opens to the right. If columns exceed the viewport budget, the panel
 * itself horizontally scrolls — the page never does.
 *
 * Ordering: the most recently added section is always the first item in
 * the array, so it lands in the top slot of column 1.
 */
export function LiveVideoPanel({
  watchCodes,
  addressBySectionCode,
  metrics,
  streamBySection,
  onClose,
}: {
  watchCodes: string[];
  addressBySectionCode: Map<string, LiveAddress>;
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  onClose: (code: string) => void;
}) {
  const cardsPerCol = useCardsPerCol();

  if (watchCodes.length === 0) return null;

  return (
    <aside
      className="flex w-full shrink-0 flex-col overflow-auto border-t border-border bg-background/95 p-3 backdrop-blur max-h-[60vh] md:h-full md:max-h-none md:w-auto md:max-w-[calc(100vw-var(--min-map-width))] md:border-l md:border-t-0 md:overflow-x-auto md:overflow-y-hidden"
      style={
        {
          ["--panel-rows" as string]: String(cardsPerCol),
          ["--min-map-width" as string]: `${MIN_MAP_WIDTH_PX}px`,
        } as CSSProperties
      }
    >
      <div className="grid gap-3 md:h-full md:auto-cols-[360px] md:grid-flow-col md:[grid-template-rows:repeat(var(--panel-rows),minmax(0,1fr))]">
        {watchCodes.map((code) => (
          <LiveVideoCard
            key={code}
            sectionCode={code}
            address={addressBySectionCode.get(code)}
            metric={metrics?.[code]}
            streamUrl={streamBySection.get(code)}
            onClose={() => onClose(code)}
          />
        ))}
      </div>
    </aside>
  );
}

/** How many cards stack per column on desktop before the grid wraps to
 *  a new column. Based on viewport height so the user doesn't get
 *  vertical scroll inside the panel. */
function useCardsPerCol(): number {
  const [n, setN] = useState(computeCardsPerCol);
  useEffect(() => {
    const onResize = () => setN(computeCardsPerCol());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return n;
}

function computeCardsPerCol(): number {
  if (typeof window === "undefined") return 2;
  const usableH = Math.max(
    CARD_HEIGHT_ESTIMATE_PX,
    window.innerHeight - VERTICAL_CHROME_PX,
  );
  return Math.max(1, Math.floor(usableH / CARD_HEIGHT_ESTIMATE_PX));
}
