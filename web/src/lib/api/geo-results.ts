import { apiGet } from "./client.js";
import type {
  GeoArea,
  GeoMunicipalityLean,
  GeoResultsLeanResponse,
  Election,
} from "./types.js";

/**
 * Per-area aggregated election results, with GeoJSON geometry attached.
 *
 * `getGeoResults(electionId, level)` returns the rich shape with voter
 * totals, used by the proportional district pie map and the rich district
 * popups. `getGeoResultsLean(electionId)` is the smaller payload used as a
 * background outline / municipality list.
 */

export type GeoLevel = "districts" | "municipalities" | "riks";

export interface GeoResultsByLevel {
  election: Election;
  areas: GeoArea[];
}

export async function getGeoResults(
  electionId: number | string,
  level: GeoLevel,
): Promise<GeoResultsByLevel> {
  type Raw = {
    election: Election;
    districts?: GeoArea[];
    municipalities?: GeoArea[];
    riks?: GeoArea[];
  };
  const raw = await apiGet<Raw>(
    `/elections/${electionId}/results/geo/${level}`,
  );
  const areas = raw[level] ?? [];
  return { election: raw.election, areas };
}

export function getGeoResultsLean(
  electionId: number | string,
): Promise<GeoResultsLeanResponse> {
  return apiGet<GeoResultsLeanResponse>(`/elections/${electionId}/results/geo`);
}

export type { GeoArea, GeoMunicipalityLean };
