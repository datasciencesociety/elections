/**
 * Ballot query helpers.
 *
 * Single source of truth for the "what shows on the ballot" display rule and
 * the votes→election_parties→parties join. Every endpoint that returns a list
 * of parties (or presidential candidate pairs) must route through this module
 * so the rule only lives in one place.
 *
 * The rule: use `election_parties.name_on_ballot` when present (set by the
 * import pipeline — `fix_president_parties.py` populates it with the candidate
 * pair for president elections, committee/party name otherwise), falling back
 * to `parties.canonical_name` / `parties.short_name`.
 *
 * Fragments use fixed aliases: `p` for parties, `ep` for election_parties,
 * `v` for votes. If a route query uses `p` for something else (e.g. protocols),
 * rename it locally before composing these fragments.
 */

import type { Database as DatabaseType } from "better-sqlite3";

// ---------- SQL fragments (inline into larger queries) ----------

/** Display name: candidate pair for presidents, party/committee name otherwise. */
export const BALLOT_NAME_SQL =
  "COALESCE(ep.name_on_ballot, p.canonical_name)";

/** Shorter display name for dense UI. */
export const BALLOT_SHORT_SQL =
  "COALESCE(ep.name_on_ballot, p.short_name, p.canonical_name)";

/** JOIN fragment that binds `v.party_number` → election_parties → parties. */
export const BALLOT_JOIN_SQL = `
  JOIN election_parties ep
    ON ep.election_id = v.election_id
   AND ep.ballot_number = v.party_number
  JOIN parties p ON p.id = ep.party_id
`;

/** Standard column projection for a detailed per-section list. */
export const BALLOT_DETAIL_COLS = `
  p.id AS party_id,
  ${BALLOT_NAME_SQL} AS party_name,
  ${BALLOT_SHORT_SQL} AS party_short_name,
  p.color AS party_color
`;

// ---------- TypeScript row types ----------

export interface SectionBallotRow {
  party_id: number;
  party_name: string;
  party_short_name: string;
  party_color: string | null;
  votes: number;
  paper: number;
  machine: number;
}

export interface AggregatedBallotRow {
  party_id: number;
  party_name: string;
  party_color: string | null;
  votes: number;
}

/** Valid geo filter columns used by the results/compare endpoints. */
export type GeoColumn =
  | "l.kmetstvo_id"
  | "l.local_region_id"
  | "l.municipality_id"
  | "l.district_id"
  | "l.rik_id";

// ---------- High-level helpers ----------

/**
 * Full ballot list for a single section, sorted by votes DESC.
 * Used by the section-detail sidebar and per-section drill-downs.
 */
export function getSectionBallot(
  db: DatabaseType,
  electionId: number | string,
  sectionCode: string,
): SectionBallotRow[] {
  return db
    .prepare(
      `
      SELECT
        ${BALLOT_DETAIL_COLS},
        v.total AS votes,
        v.paper,
        v.machine
      FROM votes v
      ${BALLOT_JOIN_SQL}
      WHERE v.election_id = ?
        AND v.section_code = ?
        AND v.total > 0
      ORDER BY v.total DESC
      `,
    )
    .all(electionId, sectionCode) as SectionBallotRow[];
}

/**
 * Aggregated ballot list for an entire election or a geo-filtered subset.
 * Returns one row per party, sorted by votes DESC.
 */
export function getAggregatedBallot(
  db: DatabaseType,
  electionId: number | string,
  opts: { geoColumn?: GeoColumn; geoValue?: string | number } = {},
): AggregatedBallotRow[] {
  const { geoColumn, geoValue } = opts;

  if (geoColumn && geoValue != null) {
    return db
      .prepare(
        `
        SELECT
          p.id AS party_id,
          ${BALLOT_NAME_SQL} AS party_name,
          p.color AS party_color,
          SUM(v.total) AS votes
        FROM votes v
        JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
        JOIN locations l ON l.id = s.location_id
        ${BALLOT_JOIN_SQL}
        WHERE v.election_id = ? AND ${geoColumn} = ?
        GROUP BY p.id
        ORDER BY votes DESC
        `,
      )
      .all(electionId, geoValue) as AggregatedBallotRow[];
  }

  return db
    .prepare(
      `
      SELECT
        p.id AS party_id,
        ${BALLOT_NAME_SQL} AS party_name,
        p.color AS party_color,
        SUM(v.total) AS votes
      FROM votes v
      ${BALLOT_JOIN_SQL}
      WHERE v.election_id = ?
      GROUP BY p.id
      ORDER BY votes DESC
      `,
    )
    .all(electionId) as AggregatedBallotRow[];
}

/**
 * Resolve query params to a GeoColumn + value. Returns null if no geo filter.
 * Order matches existing route behavior: most specific wins.
 */
export function resolveGeoFilter(query: {
  kmetstvo?: string;
  local_region?: string;
  municipality?: string;
  district?: string;
  rik?: string;
}): { column: GeoColumn; value: string } | null {
  if (query.kmetstvo) return { column: "l.kmetstvo_id", value: query.kmetstvo };
  if (query.local_region) return { column: "l.local_region_id", value: query.local_region };
  if (query.municipality) return { column: "l.municipality_id", value: query.municipality };
  if (query.district) return { column: "l.district_id", value: query.district };
  if (query.rik) return { column: "l.rik_id", value: query.rik };
  return null;
}
