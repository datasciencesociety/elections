import { useQuery } from "@tanstack/react-query";
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

export function usePersistenceSectionHistory(sectionCode: string | undefined) {
  return useQuery({
    queryKey: ["persistence-history", sectionCode],
    queryFn: () => getPersistenceSectionHistory(sectionCode!),
    enabled: !!sectionCode,
    staleTime: 5 * 60_000,
  });
}
