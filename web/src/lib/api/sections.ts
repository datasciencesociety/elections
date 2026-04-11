import { apiGet } from "./client.js";
import type {
  SectionDetail,
  SectionsGeoResponse,
  SectionViolationsResponse,
} from "./types.js";

/**
 * GET /api/elections/:id/sections/geo — every section in this election with
 * coordinates, top-5 parties, and winner colour. Powers the section map.
 */
export function getSectionsGeo(
  electionId: number | string,
  filter: { district?: string; municipality?: string; rik?: string } = {},
): Promise<SectionsGeoResponse> {
  return apiGet<SectionsGeoResponse>(`/elections/${electionId}/sections/geo`, {
    district: filter.district,
    municipality: filter.municipality,
    rik: filter.rik,
  });
}

/**
 * GET /api/elections/:id/sections/:code — single section drill-down with
 * peer/RIK/municipality context for the sidebar.
 */
export function getSectionDetail(
  electionId: number | string,
  sectionCode: string,
): Promise<SectionDetail> {
  return apiGet<SectionDetail>(
    `/elections/${electionId}/sections/${sectionCode}`,
  );
}

/**
 * GET /api/elections/:id/violations/:sectionCode — protocol arithmetic /
 * vote-sum violations for a single section.
 */
export function getSectionViolations(
  electionId: number | string,
  sectionCode: string,
): Promise<SectionViolationsResponse> {
  return apiGet<SectionViolationsResponse>(
    `/elections/${electionId}/violations/${sectionCode}`,
  );
}
