import { useQuery } from "@tanstack/react-query";
import {
  getGeoResults,
  getGeoResultsLean,
  type GeoLevel,
} from "../api/geo-results.js";

export function useGeoResults(
  electionId: string | number | undefined,
  level: GeoLevel,
) {
  return useQuery({
    queryKey: ["geo-results", electionId, level],
    queryFn: () => getGeoResults(electionId!, level),
    enabled: electionId != null,
    staleTime: 5 * 60_000,
  });
}

export function useGeoResultsLean(electionId: string | number | undefined) {
  return useQuery({
    queryKey: ["geo-results-lean", electionId],
    queryFn: () => getGeoResultsLean(electionId!),
    enabled: electionId != null,
    staleTime: 5 * 60_000,
  });
}
