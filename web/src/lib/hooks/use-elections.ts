import { useQuery } from "@tanstack/react-query";
import { listElections, findElection } from "../api/elections.js";

/**
 * React Query wrapper around `GET /api/elections`.
 *
 * Election metadata never changes during a session, so the list is cached
 * forever (`staleTime: Infinity`). Pages that need a single election look it
 * up locally via `findElection` instead of hitting an extra endpoint.
 */
export function useElections() {
  return useQuery({
    queryKey: ["elections"],
    queryFn: listElections,
    staleTime: Infinity,
  });
}

export function useElection(id: number | string | undefined) {
  const { data, ...rest } = useElections();
  return {
    ...rest,
    data: id != null && data ? findElection(data, id) : null,
  };
}
