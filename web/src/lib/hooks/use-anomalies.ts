import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
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

/**
 * Infinite-scroll variant of `useAnomalies`. Caller passes the page size;
 * each successive page bumps the `offset` until we've fetched `total`.
 *
 * `queryKey` omits the offset so all pages for the same filter set live
 * under the same cache entry — exactly what React Query's infinite-query
 * model expects.
 */
export function useAnomaliesInfinite(
  query: Omit<AnomaliesQuery, "offset">,
  pageSize: number,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: ["anomalies-infinite", { ...query, limit: pageSize }],
    queryFn: ({ pageParam }) =>
      getAnomalies({ ...query, limit: pageSize, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, _allPages, lastPageParam) => {
      const loaded = lastPageParam + last.sections.length;
      return loaded < last.total ? loaded : undefined;
    },
    enabled: enabled && query.electionId != null,
    staleTime: 60_000,
  });
}
