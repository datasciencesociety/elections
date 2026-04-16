import BallotList from "@/components/ballot-list";
import type { AnomalySection } from "@/lib/api/types.js";
import { useSectionFull } from "./use-section-full.js";
import { SectionLinks } from "./section-links.js";
import { SectionProtocolSummary } from "./section-protocol-summary.js";
import { SectionViolations } from "./section-violations.js";
import { OverallScoreCard } from "./cards/overall-score-card.js";
import { TurnoutCard } from "./cards/turnout-card.js";
import { BinaryFlags } from "./cards/binary-flags.js";
import { BenfordCard } from "./cards/benford-card.js";
import { PeerCard } from "./cards/peer-card.js";
import { AcfCard } from "./cards/acf-card.js";

/**
 * Per-election section card. Reads everything for `(electionId, sectionCode)`
 * via `useSectionFull` and lays out:
 *
 *   - CIK protocol/scan/video links
 *   - protocol summary numbers
 *   - party / candidate ballot list
 *   - the methodology cards (overall, turnout, binary flags, Benford, peer, ACF)
 *     when the section has anomaly scores
 *   - protocol violations
 *
 * Used by:
 *   - the anomaly-map sidebar (one election, full layout)
 *   - the sections-table sidebar drilldown (same)
 *   - `pages/section-detail.tsx` and `components/section-preview.tsx`
 *     once per election in the section's history (with `compact`)
 *
 * Pass `initialAnomaly` when the parent already has the row (clicked
 * marker) so we skip the redundant `/anomalies` fetch.
 */
export function SectionElection({
  electionId,
  sectionCode,
  electionName,
  initialAnomaly,
  compact = false,
}: {
  electionId: string | number;
  sectionCode: string;
  /** Optional title — shown when the surface displays multiple elections. */
  electionName?: string;
  initialAnomaly?: AnomalySection | null;
  compact?: boolean;
}) {
  const { anomaly, detail, violations, isLoading } = useSectionFull(
    electionId,
    sectionCode,
    { initialAnomaly, skipAnomaly: compact },
  );

  // Whether to render the methodology cards: any section with a non-zero
  // overall score has data worth showing. The cards collapse by default.
  const hasScores = anomaly != null && anomaly.risk_score != null;

  return (
    <div className="space-y-3">
      {electionName && (
        <div className="text-xs font-semibold">{electionName}</div>
      )}

      <SectionLinks
        electionId={electionId}
        sectionCode={sectionCode}
        machineCount={detail?.protocol.machine_count}
      />

      <SectionProtocolSummary
        detail={detail}
        loading={isLoading}
        compact={compact}
      />

      {detail && detail.parties.length > 0 && (
        <BallotList
          entries={detail.parties}
          variant={compact ? "stacked-bar" : "full-rows"}
          density={compact ? "sm" : "md"}
        />
      )}

      <SectionViolations violations={violations} />

      {/* Methodology cards — only render in non-compact mode. The cards
          collapse by default, so showing all of them in the sidebar is
          fine; in a compact (multi-election) view we'd be repeating the
          same six headers per election, which is noisy. */}
      {!compact && hasScores && anomaly && (
        <>
          <OverallScoreCard section={anomaly} />
          <TurnoutCard section={anomaly} ctx={detail?.context ?? null} />
          <BinaryFlags section={anomaly} />
          <BenfordCard section={anomaly} parties={detail?.parties ?? null} />
          <PeerCard section={anomaly} ctx={detail?.context ?? null} />
          <AcfCard section={anomaly} ctx={detail?.context ?? null} />
        </>
      )}
    </div>
  );
}
