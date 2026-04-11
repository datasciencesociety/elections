import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getPersistence,
  getPersistenceSectionHistory,
  type PersistenceQuery,
} from "../api/persistence.js";

export function usePersistence(query: PersistenceQuery = {}) {
  return useQuery({
    queryKey: ["persistence", query],
    queryFn: () => getPersistence(query),
    staleTime: 60_000,
  });
}

/**
 * Infinite-scroll variant of `usePersistence`. Bumps `offset` page-by-page
 * and flattens via `flatMap` in the caller.
 */
export function usePersistenceInfinite(
  query: Omit<PersistenceQuery, "offset">,
  pageSize: number,
) {
  return useInfiniteQuery({
    queryKey: ["persistence-infinite", { ...query, limit: pageSize }],
    queryFn: ({ pageParam }) =>
      getPersistence({ ...query, limit: pageSize, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, _allPages, lastPageParam) => {
      const loaded = lastPageParam + last.sections.length;
      return loaded < last.total ? loaded : undefined;
    },
    staleTime: 60_000,
  });
}

export function usePersistenceSectionHistory(sectionCode: string | undefined) {
  return useQuery({
    queryKey: ["persistence-history", sectionCode],
    queryFn: () => getPersistenceSectionHistory(sectionCode!),
    enabled: !!sectionCode,
    staleTime: 5 * 60_000,
  });
}
