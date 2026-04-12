import { apiGet } from "./client.js";
import type {
  AbroadBrowseResponse,
  AbroadSummary,
  District,
  DistrictBrowseResponse,
  GeoEntity,
  MissingCoordinatesResponse,
  SectionSiblingsResponse,
  SettlementPeersResponse,
} from "./types.js";

/**
 * Geographic reference lookups — read from `riks`, `districts`,
 * `municipalities`, `kmetstva`, `local_regions`. Used by filter dropdowns
 * and the missing-coordinates contributor page.
 */

export function getDistricts(): Promise<District[]> {
  return apiGet<District[]>("/geography/districts");
}

export function getAbroadSummary(): Promise<AbroadSummary> {
  return apiGet<AbroadSummary>("/geography/abroad-summary");
}

export function getDistrictBrowse(
  districtId: number | string,
): Promise<DistrictBrowseResponse> {
  return apiGet<DistrictBrowseResponse>(
    `/geography/district/${districtId}/browse`,
  );
}

export function getAbroadBrowse(): Promise<AbroadBrowseResponse> {
  return apiGet<AbroadBrowseResponse>("/geography/abroad/browse");
}

export function getRiks(): Promise<GeoEntity[]> {
  return apiGet<GeoEntity[]>("/geography/riks");
}

export function getMunicipalities(districtId?: string): Promise<GeoEntity[]> {
  return apiGet<GeoEntity[]>("/geography/municipalities", {
    district: districtId,
  });
}

export function getKmetstva(municipalityId?: string): Promise<GeoEntity[]> {
  return apiGet<GeoEntity[]>("/geography/kmetstva", {
    municipality: municipalityId,
  });
}

export function getLocalRegions(municipalityId?: string): Promise<GeoEntity[]> {
  return apiGet<GeoEntity[]>("/geography/local-regions", {
    municipality: municipalityId,
  });
}

export function getMissingCoordinates(query: {
  page?: number;
  search?: string;
}): Promise<MissingCoordinatesResponse> {
  return apiGet<MissingCoordinatesResponse>("/geography/missing-coordinates", {
    page: query.page,
    search: query.search,
  });
}

/**
 * Peer check: all sibling sections at the same physical location, with
 * latest-election turnout + winner. Used by search (multi-section results)
 * and by section-detail to render the peer-comparison strip.
 */
export function getSectionSiblings(
  sectionCode: string,
): Promise<SectionSiblingsResponse> {
  return apiGet<SectionSiblingsResponse>(
    `/geography/section-siblings/${encodeURIComponent(sectionCode)}`,
  );
}

export function getSettlementPeers(
  sectionCode: string,
): Promise<SettlementPeersResponse> {
  return apiGet<SettlementPeersResponse>(
    `/geography/settlement-peers/${encodeURIComponent(sectionCode)}`,
  );
}
