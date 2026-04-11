import { apiGet } from "./client.js";
import type { GeoEntity, MissingCoordinatesResponse } from "./types.js";

/**
 * Geographic reference lookups — read from `riks`, `districts`,
 * `municipalities`, `kmetstva`, `local_regions`. Used by filter dropdowns
 * and the missing-coordinates contributor page.
 */

export function getDistricts(): Promise<GeoEntity[]> {
  return apiGet<GeoEntity[]>("/geography/districts");
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
