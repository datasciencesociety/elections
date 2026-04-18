import type { Database as DatabaseType } from "better-sqlite3";
import { computeElectionWeights, type ElectionRow } from "../lib/election-weights.js";

/**
 * Cross-election persistence index — sections that get flagged in many
 * elections, weighted by election type and recency.
 *
 * The score is `weighted_avg_risk × sqrt(elections_flagged / elections_present)`,
 * which rewards both high average risk AND consistency across elections.
 */

export const PERSISTENCE_SORT_SQL = {
  persistence_score: "s.persistence_score",
  elections_flagged: "s.elections_flagged",
  elections_present: "s.elections_present",
  avg_risk: "s.avg_risk",
  max_risk: "s.max_risk",
  consistency: "s.consistency",
  total_violations: "s.total_violations",
  avg_turnout: "s.avg_turnout",
  section_code: "s.section_code",
  settlement_name: "l.settlement_name",
  avg_registered: "va.avg_registered",
  avg_voted: "va.avg_voted",
} as const;

export type PersistenceSortKey = keyof typeof PERSISTENCE_SORT_SQL;

export interface PersistenceOptions {
  minElections: number;
  minScore: number;
  sort: PersistenceSortKey;
  order: "asc" | "desc";
  limit: number;
  offset: number;
  excludeSpecial: boolean;
  sectionFilter?: string;
  district?: string;
  municipality?: string;
}

export interface PersistenceSection {
  section_code: string;
  elections_present: number;
  elections_flagged: number;
  weighted_avg_risk: number;
  avg_risk: number;
  max_risk: number;
  total_violations: number;
  total_arith_errors: number;
  total_vote_mismatches: number;
  benford_flags: number;
  peer_flags: number;
  acf_flags: number;
  protocol_flags: number;
  avg_turnout: number;
  persistence_score: number;
  consistency: number;
  settlement_name: string | null;
  lat: number | null;
  lng: number | null;
  avg_registered: number;
  avg_voted: number;
}

export interface PersistenceResult {
  sections: PersistenceSection[];
  total: number;
  elections: ElectionRow[];
  weights: Map<number, number>;
}

export function getPersistence(
  db: DatabaseType,
  opts: PersistenceOptions,
): PersistenceResult {
  const { rows: elections, weights, sqlExpr: weightExpr } =
    computeElectionWeights(db);

  const sortColumnSql = PERSISTENCE_SORT_SQL[opts.sort];
  const orderDir = opts.order === "asc" ? "ASC" : "DESC";

  const typeClause = opts.excludeSpecial
    ? " AND ss.section_type = 'normal'"
    : "";
  const sectionClause = opts.sectionFilter ? " AND ss.section_code LIKE ?" : "";

  // District/municipality filter operates on the most-recent location per
  // section — matches how persistence aggregates across elections. Built as
  // an EXISTS subquery so it only fires when asked.
  const locBuild = () => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.district) {
      clauses.push("loc.district_id = ?");
      params.push(Number(opts.district));
    }
    if (opts.municipality) {
      clauses.push("loc.municipality_id = ?");
      params.push(Number(opts.municipality));
    }
    if (clauses.length === 0) return { clause: "", params };
    const clause = ` AND EXISTS (
      SELECT 1 FROM sections sec
      JOIN locations loc ON loc.id = sec.location_id
      WHERE sec.section_code = ss.section_code
        AND ${clauses.join(" AND ")}
    )`;
    return { clause, params };
  };
  const loc = locBuild();

  const sql = `
    WITH agg AS (
      SELECT
        ss.section_code,
        COUNT(DISTINCT ss.election_id) AS elections_present,
        COUNT(DISTINCT CASE WHEN ss.risk_score >= 0.3 THEN ss.election_id END) AS elections_flagged,
        ROUND(SUM(${weightExpr} * ss.risk_score) / SUM(${weightExpr}), 4) AS weighted_avg_risk,
        ROUND(AVG(ss.risk_score), 4) AS avg_risk,
        ROUND(MAX(ss.risk_score), 4) AS max_risk,
        SUM(ss.protocol_violation_count) AS total_violations,
        SUM(ss.arithmetic_error) AS total_arith_errors,
        SUM(ss.vote_sum_mismatch) AS total_vote_mismatches,
        COUNT(DISTINCT CASE WHEN ss.benford_risk >= 0.3 THEN ss.election_id END) AS benford_flags,
        COUNT(DISTINCT CASE WHEN ss.peer_risk >= 0.3 THEN ss.election_id END) AS peer_flags,
        COUNT(DISTINCT CASE WHEN ss.acf_risk >= 0.3 THEN ss.election_id END) AS acf_flags,
        COUNT(DISTINCT CASE WHEN ss.protocol_violation_count > 0 THEN ss.election_id END) AS protocol_flags,
        ROUND(AVG(ss.turnout_rate), 4) AS avg_turnout
      FROM section_scores ss
      WHERE 1=1${typeClause}${sectionClause}${loc.clause}
      GROUP BY ss.section_code
      HAVING elections_present >= ?
    ),
    scored AS (
      SELECT *,
        ROUND(weighted_avg_risk * POWER(CAST(elections_flagged AS REAL) / elections_present, 0.5), 4) AS persistence_score,
        ROUND(CAST(elections_flagged AS REAL) / elections_present, 4) AS consistency
      FROM agg
    ),
    voter_avgs AS (
      SELECT p.section_code,
        ROUND(AVG(p.registered_voters)) AS avg_registered,
        ROUND(AVG(p.actual_voters)) AS avg_voted
      FROM protocols p
      GROUP BY p.section_code
    )
    SELECT s.*,
      l.settlement_name,
      l.lat, l.lng,
      COALESCE(va.avg_registered, 0) AS avg_registered,
      COALESCE(va.avg_voted, 0) AS avg_voted
    FROM scored s
    LEFT JOIN (
      SELECT sec.section_code, COALESCE(sec.settlement_name, loc.settlement_name) AS settlement_name,
        loc.lat, loc.lng,
        ROW_NUMBER() OVER (PARTITION BY sec.section_code ORDER BY sec.election_id DESC) AS rn
      FROM sections sec
      JOIN locations loc ON loc.id = sec.location_id
    ) l ON l.section_code = s.section_code AND l.rn = 1
    LEFT JOIN voter_avgs va ON va.section_code = s.section_code
    WHERE s.persistence_score >= ?
    ORDER BY ${sortColumnSql} ${orderDir}
    LIMIT ? OFFSET ?
  `;

  const countSql = `
    WITH agg AS (
      SELECT
        ss.section_code,
        COUNT(DISTINCT ss.election_id) AS elections_present,
        COUNT(DISTINCT CASE WHEN ss.risk_score >= 0.3 THEN ss.election_id END) AS elections_flagged,
        ROUND(SUM(${weightExpr} * ss.risk_score) / SUM(${weightExpr}), 4) AS weighted_avg_risk
      FROM section_scores ss
      WHERE 1=1${typeClause}${sectionClause}${loc.clause}
      GROUP BY ss.section_code
      HAVING elections_present >= ?
    ),
    scored AS (
      SELECT *,
        ROUND(weighted_avg_risk * POWER(CAST(elections_flagged AS REAL) / elections_present, 0.5), 4) AS persistence_score
      FROM agg
    )
    SELECT COUNT(*) AS total FROM scored WHERE persistence_score >= ?
  `;

  // Param order must match SQL placeholder order:
  // (1) sectionFilter LIKE? (2) loc.district/municipality? (3) minElections (HAVING) (4) minScore (WHERE)
  const params: unknown[] = [];
  if (opts.sectionFilter) params.push(`%${opts.sectionFilter}%`);
  params.push(...loc.params);
  params.push(opts.minElections);
  params.push(opts.minScore);

  const countParams = [...params];
  params.push(opts.limit, opts.offset);

  const sections = db.prepare(sql).all(...params) as PersistenceSection[];
  const { total } = db.prepare(countSql).get(...countParams) as {
    total: number;
  };

  return { sections, total, elections, weights };
}

export interface PersistenceSectionHistoryRow {
  election_id: number;
  election_name: string;
  election_date: string;
  election_type: string;
  risk_score: number;
  benford_risk: number;
  peer_risk: number;
  acf_risk: number;
  turnout_rate: number;
  arithmetic_error: number;
  vote_sum_mismatch: number;
  protocol_violation_count: number;
  protocol_url: string | null;
  settlement_name: string | null;
  address: string | null;
}

export function getPersistenceSectionHistory(
  db: DatabaseType,
  sectionCode: string,
): PersistenceSectionHistoryRow[] {
  return db
    .prepare(
      `SELECT ss.election_id, e.name AS election_name, e.date AS election_date, e.type AS election_type,
              ss.risk_score, ss.benford_risk, ss.peer_risk, ss.acf_risk,
              ss.turnout_rate, ss.arithmetic_error, ss.vote_sum_mismatch,
              ss.protocol_violation_count, s.protocol_url,
              COALESCE(s.settlement_name, l.settlement_name) AS settlement_name,
              COALESCE(s.address, l.address) AS address
         FROM section_scores ss
         JOIN elections e ON e.id = ss.election_id
         LEFT JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
         LEFT JOIN locations l ON l.id = s.location_id
        WHERE ss.section_code = ?
        ORDER BY e.date`,
    )
    .all(sectionCode) as PersistenceSectionHistoryRow[];
}
