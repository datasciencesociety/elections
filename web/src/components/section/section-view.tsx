import type { AnomalySection } from "@/lib/api/types.js";
import { useSectionFull } from "./use-section-full.js";
import { SectionLocation } from "./section-location.js";
import { SectionElection } from "./section-election.js";
import { ShareButton } from "@/components/ui/share-button.js";

/**
 * Canonical "show one election + section" composition: location at the top
 * (with map and the suggest-better-location button), then everything for
 * the chosen election (links, protocol, ballot, methodology cards).
 *
 * This is what the anomaly-map sidebar and the sections-table drilldown
 * render. The multi-election walkers (`pages/section-detail.tsx`,
 * `components/section-preview.tsx`) compose `SectionLocation` once and
 * `SectionElection compact` per history entry directly — they don't use
 * `SectionView` because they need to interleave their own page chrome
 * between the location and the per-election cards.
 *
 * The hook is called twice (here and inside `SectionElection`); React
 * Query dedupes the underlying network requests so this is free.
 */
export function SectionView({
  electionId,
  sectionCode,
  initialAnomaly,
}: {
  electionId: string | number;
  sectionCode: string;
  initialAnomaly?: AnomalySection | null;
}) {
  // Pulls the anomaly row for the location info — settlement, address, etc.
  // come from there. The same hook fires inside `SectionElection`; React
  // Query dedupes the request.
  const { anomaly } = useSectionFull(electionId, sectionCode, {
    initialAnomaly,
  });

  return (
    <div className="space-y-4">
      <SectionLocation
        electionId={electionId}
        sectionCode={sectionCode}
        settlementName={anomaly?.settlement_name ?? null}
        address={anomaly?.address ?? null}
        sectionType={anomaly?.section_type}
        lat={anomaly?.lat ?? null}
        lng={anomaly?.lng ?? null}
      />

      <div className="flex gap-2">
        <a
          href={`/section/${sectionCode}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-center text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Отвори ↗
        </a>
        <ShareButton
          url={`${window.location.origin}/section/${sectionCode}`}
          title={`Секция ${sectionCode}`}
          variant="button"
          className="flex-1"
        />
      </div>

      <SectionElection
        electionId={electionId}
        sectionCode={sectionCode}
        initialAnomaly={anomaly}
      />
    </div>
  );
}
