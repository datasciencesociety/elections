import { useQuery } from "@tanstack/react-query";
import { getAnomalies, type AnomaliesQuery } from "../api/anomalies.js";

/**
 * React Query wrapper around `GET /api/elections/:id/anomalies`.
 *
 * Set `enabled: false` (via the `enabled` option) when you have nothing to
 * fetch yet — the rest of the page can render the empty state without
 * triggering a request.
 */
export function useAnomalies(query: AnomaliesQuery, enabled = true) {
  return useQuery({
    queryKey: ["anomalies", query],
    queryFn: () => getAnomalies(query),
    enabled: enabled && query.electionId != null,
    staleTime: 60_000,
  });
}
