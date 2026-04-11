import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Single source of truth for "load an election by id, or 404".
 *
 * Most route handlers start with the same pattern:
 *   1. Look up the election
 *   2. If missing, return { error: "Election not found" } with HTTP 404
 *
 * Route handlers call `getElection(db, id)` and check for `null` to keep
 * that pattern in one place.
 */

export interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

export function getElection(
  db: DatabaseType,
  id: number | string,
): Election | null {
  const row = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id) as Election | undefined;
  return row ?? null;
}

export function listElections(db: DatabaseType): Election[] {
  return db
    .prepare("SELECT id, name, date, type FROM elections ORDER BY date DESC")
    .all() as Election[];
}
