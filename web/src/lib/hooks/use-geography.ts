import { useQuery } from "@tanstack/react-query";
import {
  getAbroadBrowse,
  getAbroadSummary,
  getDistrictBrowse,
  getDistricts,
  getMissingCoordinates,
  getMunicipalities,
  getRiks,
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

export function useRiks() {
  return useQuery({
    queryKey: ["riks"],
    queryFn: getRiks,
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

export function useDistrictBrowse(districtId: number | string | undefined) {
  return useQuery({
    queryKey: ["district-browse", districtId],
    queryFn: () => getDistrictBrowse(districtId!),
    enabled: districtId != null,
    staleTime: Infinity,
  });
}

export function useAbroadBrowse() {
  return useQuery({
    queryKey: ["abroad-browse"],
    queryFn: getAbroadBrowse,
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
