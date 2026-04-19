import { useQuery } from "@tanstack/react-query";
import { getLiveSections, type LiveSection } from "../api/live-sections.js";

/**
 * Load the flattened CIK polling-section list once per session. The file is
 * static, so we mark it fresh forever and never refetch.
 */
export function useLiveSections() {
  return useQuery<LiveSection[]>({
    queryKey: ["live-sections"],
    queryFn: getLiveSections,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
