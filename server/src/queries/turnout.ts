import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Turnout aggregated by a geographic level (RIK / district / municipality /
 * kmetstvo / local region), optionally filtered down to a specific area.
 */

export const TURNOUT_LEVELS = [
  "rik",
  "district",
  "municipality",
  "kmetstvo",
  "local_region",
] as const;

export type TurnoutLevel = (typeof TURNOUT_LEVELS)[number];

const LEVEL_TO_TABLE: Record<TurnoutLevel, { table: string; column: string }> = {
  rik: { table: "riks", column: "rik_id" },
  district: { table: "districts", column: "district_id" },
  municipality: { table: "municipalities", column: "municipality_id" },
  kmetstvo: { table: "kmetstva", column: "kmetstvo_id" },
  local_region: { table: "local_regions", column: "local_region_id" },
};

export const TURNOUT_FILTER_COLUMNS = {
  kmetstvo: "l.kmetstvo_id",
  local_region: "l.local_region_id",
  municipality: "l.municipality_id",
  district: "l.district_id",
  rik: "l.rik_id",
} as const;

export type TurnoutFilterKey = keyof typeof TURNOUT_FILTER_COLUMNS;

export interface TurnoutRow {
  group_id: number;
  group_name: string;
  registered_voters: number;
  actual_voters: number;
  turnout_pct: number;
}

export interface TurnoutResult {
  rows: TurnoutRow[];
  totals: {
    registered_voters: number;
    actual_voters: number;
    turnout_pct: number;
  };
}

export function getTurnout(
  db: DatabaseType,
  electionId: number | string,
  level: TurnoutLevel,
  filter: { column: string; value: string } | null,
): TurnoutResult {
  const geo = LEVEL_TO_TABLE[level];
  const filterClause = filter ? ` AND ${filter.column} = ?` : "";
  const params: unknown[] = filter ? [electionId, filter.value] : [electionId];

  const rawRows = db
    .prepare(
      `SELECT g.id AS group_id, g.name AS group_name,
              SUM(COALESCE(p.registered_voters, 0)) AS registered_voters,
              SUM(COALESCE(p.actual_voters, 0)) AS actual_voters
         FROM protocols p
         JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
         JOIN locations l ON l.id = s.location_id
         JOIN ${geo.table} g ON g.id = l.${geo.column}
         WHERE p.election_id = ?${filterClause}
         GROUP BY g.id, g.name
         ORDER BY group_name`,
    )
    .all(...params) as Omit<TurnoutRow, "turnout_pct">[];

  const rows: TurnoutRow[] = rawRows.map((r) => ({
    ...r,
    turnout_pct:
      r.registered_voters > 0
        ? Math.round((r.actual_voters / r.registered_voters) * 10000) / 100
        : 0,
  }));

  const totalRegistered = rawRows.reduce((s, r) => s + r.registered_voters, 0);
  const totalActual = rawRows.reduce((s, r) => s + r.actual_voters, 0);

  return {
    rows,
    totals: {
      registered_voters: totalRegistered,
      actual_voters: totalActual,
      turnout_pct:
        totalRegistered > 0
          ? Math.round((totalActual / totalRegistered) * 10000) / 100
          : 0,
    },
  };
}

/**
 * Pick the most-specific geo filter from a query string.
 * Mirrors the behavior of resolveGeoFilter in db/ballot.ts but uses the
 * relaxed key set (which the turnout endpoint accepts).
 */
export function resolveTurnoutFilter(query: {
  kmetstvo?: string;
  local_region?: string;
  municipality?: string;
  district?: string;
  rik?: string;
}): { column: string; value: string } | null {
  if (query.kmetstvo)
    return { column: TURNOUT_FILTER_COLUMNS.kmetstvo, value: query.kmetstvo };
  if (query.local_region)
    return {
      column: TURNOUT_FILTER_COLUMNS.local_region,
      value: query.local_region,
    };
  if (query.municipality)
    return {
      column: TURNOUT_FILTER_COLUMNS.municipality,
      value: query.municipality,
    };
  if (query.district)
    return { column: TURNOUT_FILTER_COLUMNS.district, value: query.district };
  if (query.rik) return { column: TURNOUT_FILTER_COLUMNS.rik, value: query.rik };
  return null;
}
