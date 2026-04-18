import { useQuery } from "@tanstack/react-query";
import {
  getAbroadBrowse,
  getAbroadSummary,
  getDistrictBrowse,
  getDistricts,
  getMissingCoordinates,
  getMunicipalities,
  getSectionSiblings,
  getSettlementPeers,
} from "../api/geography.js";

/**
 * Geography reference lookups — these almost never change so cache them
 * forever during the session.
 */

export function useDistricts() {
  return useQuery({
    queryKey: ["districts"],
    queryFn: getDistricts,
    staleTime: Infinity,
  });
}

export function useMunicipalities(districtId: string | undefined) {
  return useQuery({
    queryKey: ["municipalities", districtId ?? null],
    queryFn: () => getMunicipalities(districtId),
    enabled: !!districtId,
    staleTime: Infinity,
  });
}

export function useMissingCoordinates(query: {
  page?: number;
  search?: string;
}) {
  return useQuery({
    queryKey: ["missing-coordinates", query],
    queryFn: () => getMissingCoordinates(query),
    staleTime: 60_000,
  });
}

/**
 * Sibling sections at the same physical location. Stable per section_code
 * so we cache aggressively — the siblings list only changes when the DB
 * is rebuilt.
 */
export function useAbroadSummary() {
  return useQuery({
    queryKey: ["abroad-summary"],
    queryFn: getAbroadSummary,
    staleTime: Infinity,
  });
}

export function useDistrictBrowse(districtId: number | string | undefined, electionId?: string) {
  return useQuery({
    queryKey: ["district-browse", districtId, electionId],
    queryFn: () => getDistrictBrowse(districtId!, electionId),
    enabled: districtId != null,
    staleTime: Infinity,
  });
}

export function useAbroadBrowse(electionId?: string) {
  return useQuery({
    queryKey: ["abroad-browse", electionId],
    queryFn: () => getAbroadBrowse(electionId ?? undefined),
    staleTime: Infinity,
  });
}

export function useSectionSiblings(sectionCode: string | undefined) {
  return useQuery({
    queryKey: ["section-siblings", sectionCode],
    queryFn: () => getSectionSiblings(sectionCode!),
    enabled: !!sectionCode,
    staleTime: Infinity,
  });
}

export function useSettlementPeers(sectionCode: string | undefined) {
  return useQuery({
    queryKey: ["settlement-peers", sectionCode],
    queryFn: () => getSettlementPeers(sectionCode!),
    enabled: !!sectionCode,
    staleTime: Infinity,
  });
}
