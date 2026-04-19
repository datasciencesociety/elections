import { useQuery } from "@tanstack/react-query";
import { getLiveAddresses, type LiveAddress } from "../api/live-sections.js";

/**
 * Load the per-address polling index once per session. The file is
 * static, so we mark it fresh forever and never refetch.
 */
export function useLiveAddresses() {
  return useQuery<LiveAddress[]>({
    queryKey: ["live-addresses"],
    queryFn: getLiveAddresses,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
