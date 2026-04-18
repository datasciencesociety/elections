import { apiGet } from "./client.js";
import type { Election } from "./types.js";

/** GET /api/elections — list all elections, newest first. */
export function listElections(): Promise<Election[]> {
  return apiGet<Election[]>("/elections");
}
