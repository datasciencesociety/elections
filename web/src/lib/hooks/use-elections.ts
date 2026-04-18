import { useQuery } from "@tanstack/react-query";
import { listElections } from "../api/elections.js";

/**
 * React Query wrapper around `GET /api/elections`.
 *
 * Election metadata never changes during a session, so the list is cached
 * forever (`staleTime: Infinity`).
 */
export function useElections() {
  return useQuery({
    queryKey: ["elections"],
    queryFn: listElections,
    staleTime: Infinity,
  });
}
