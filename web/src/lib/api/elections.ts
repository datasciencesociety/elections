import { apiGet } from "./client.js";
import type { Election } from "./types.js";

/**
 * GET /api/elections — list all elections, newest first.
 *
 * The endpoint returns a flat array; we use the same lookup function on the
 * client when we need a single election by id (the list is small enough that
 * a separate call is wasteful).
 */
export function listElections(): Promise<Election[]> {
  return apiGet<Election[]>("/elections");
}

export function findElection(
  list: Election[],
  id: number | string,
): Election | null {
  const numeric = typeof id === "string" ? parseInt(id, 10) : id;
  return list.find((e) => e.id === numeric) ?? null;
}
