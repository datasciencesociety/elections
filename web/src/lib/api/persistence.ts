import { apiGet } from "./client.js";
import type {
  PersistenceHistoryResponse,
  PersistenceResponse,
} from "./types.js";

/**
 * GET /api/elections/persistence — cross-election persistence index.
 *
 * Sections are grouped by `section_code` (which is stable across elections),
 * weighted by election type and recency, and scored by how consistently they
 * appear in the flagged set.
 */

export interface PersistenceQuery {
  minElections?: number;
  minScore?: number;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
  excludeSpecial?: boolean;
  /** Per-type allowlist. Sent as `section_types=a,b,c`. */
  sectionTypes?: string[];
  section?: string;
  district?: string;
  municipality?: string;
}

export function getPersistence(
  q: PersistenceQuery = {},
): Promise<PersistenceResponse> {
  return apiGet<PersistenceResponse>("/elections/persistence", {
    min_elections: q.minElections,
    min_score: q.minScore,
    sort: q.sort,
    order: q.order,
    limit: q.limit,
    offset: q.offset,
    exclude_special: q.excludeSpecial ? "true" : undefined,
    section_types: q.sectionTypes && q.sectionTypes.length > 0
      ? q.sectionTypes.join(",")
      : undefined,
    section: q.section,
    district: q.district,
    municipality: q.municipality,
  });
}

export function getPersistenceSectionHistory(
  sectionCode: string,
): Promise<PersistenceHistoryResponse> {
  return apiGet<PersistenceHistoryResponse>(
    `/elections/persistence/${sectionCode}`,
  );
}
