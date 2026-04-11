import { useAnomalies } from "@/lib/hooks/use-anomalies.js";
import {
  useSectionDetail,
  useSectionViolations,
} from "@/lib/hooks/use-sections.js";
import type {
  AnomalySection,
  ProtocolViolation,
  SectionDetail,
} from "@/lib/api/types.js";

/**
 * Single hook that bundles every per-section query the UI needs:
 *
 *   - section detail (protocol numbers + per-party votes + peer context)
 *   - protocol violations
 *   - the section's anomaly score row (for header location info, plus the
 *     methodology cards if any score is non-zero)
 *
 * Pass `initialAnomaly` when the parent already has the anomaly row in
 * scope (e.g. the user clicked an anomaly marker on the map). The
 * `useAnomalies` query is then skipped, saving a round trip.
 *
 * Returns one flat object instead of three nested query results so the
 * `<SectionView>` component can render without wiring three loading states.
 */
export interface SectionFullData {
  /** Anomaly row — provides settlement, address, lat/lng, section_type, scores. */
  anomaly: AnomalySection | null;
  /** Detailed protocol + party votes + peer-comparison context. */
  detail: SectionDetail | null;
  /** Protocol violation list (empty when none). */
  violations: ProtocolViolation[];
  /** True while any of the underlying queries is still loading. */
  isLoading: boolean;
}

export function useSectionFull(
  electionId: string | number | undefined,
  sectionCode: string | undefined,
  options: { initialAnomaly?: AnomalySection | null } = {},
): SectionFullData {
  const detailQ = useSectionDetail(electionId, sectionCode);
  const violationsQ = useSectionViolations(electionId, sectionCode);

  // Skip the anomaly fetch when the parent already supplied it.
  const skipAnomaly = options.initialAnomaly != null;
  const anomalyQ = useAnomalies(
    {
      electionId: electionId as string | number,
      minRisk: 0,
      limit: 1,
      section: sectionCode,
    },
    !skipAnomaly && electionId != null && !!sectionCode,
  );

  const fetchedAnomaly = anomalyQ.data?.sections?.[0] ?? null;

  return {
    anomaly: options.initialAnomaly ?? fetchedAnomaly,
    detail: detailQ.data ?? null,
    violations: violationsQ.data?.violations ?? [],
    isLoading:
      detailQ.isLoading ||
      violationsQ.isLoading ||
      (!skipAnomaly && anomalyQ.isLoading),
  };
}
