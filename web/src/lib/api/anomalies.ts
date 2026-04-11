import { apiGet } from "./client.js";
import type { AnomaliesResponse, AnomalyMethodology } from "./types.js";

/**
 * GET /api/elections/:id/anomalies — sections flagged by one or more
 * statistical methodologies.
 *
 * `methodology="combined"` filters by the overall risk score; the others
 * filter by the per-methodology score column. Pass `limit: 0` (sent as null)
 * to disable pagination and fetch every matching section.
 */

export interface AnomaliesQuery {
  electionId: number | string;
  minRisk?: number;
  methodology?: AnomalyMethodology;
  district?: string;
  municipality?: string;
  rik?: string;
  kmetstvo?: string;
  localRegion?: string;
  section?: string;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
  minViolations?: number;
  excludeSpecial?: boolean;
}

export function getAnomalies(q: AnomaliesQuery): Promise<AnomaliesResponse> {
  const isProtocol = q.methodology === "protocol";
  return apiGet<AnomaliesResponse>(`/elections/${q.electionId}/anomalies`, {
    min_risk: isProtocol ? 1 : q.minRisk,
    sort: q.sort ?? (isProtocol ? "protocol_violation_count" : "risk_score"),
    order: q.order ?? "desc",
    limit: q.limit,
    offset: q.offset,
    methodology:
      q.methodology && q.methodology !== "combined" ? q.methodology : undefined,
    district: q.district,
    municipality: q.municipality,
    rik: q.rik,
    kmetstvo: q.kmetstvo,
    local_region: q.localRegion,
    section: q.section,
    min_violations: q.minViolations,
    exclude_special: q.excludeSpecial ? "true" : undefined,
  });
}
