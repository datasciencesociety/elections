import { useQuery } from "@tanstack/react-query";
import {
  getDistricts,
  getMissingCoordinates,
  getMunicipalities,
  getRiks,
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
