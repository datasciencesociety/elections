import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Per-election anomaly listing — section_scores joined with section / location
 * / protocol metadata, filtered by methodology, geo, and minimum risk.
 *
 * Sort and methodology choices are looked up against fixed maps so user input
 * is never interpolated into SQL — only the corresponding column is.
 */

// ---------- sort + methodology whitelists ----------

export const ANOMALY_SORT_SQL = {
  risk_score: "ss.risk_score",
  turnout_rate: "ss.turnout_rate",
  turnout_zscore: "ss.turnout_zscore",
  benford_score: "ss.benford_score",
  peer_vote_deviation: "ss.peer_vote_deviation",
  arithmetic_error: "ss.arithmetic_error",
  vote_sum_mismatch: "ss.vote_sum_mismatch",
  protocol_violation_count: "ss.protocol_violation_count",
  section_code: "ss.section_code",
  settlement_name: "l.settlement_name",
  benford_risk: "ss.benford_risk",
  peer_risk: "ss.peer_risk",
  acf_risk: "ss.acf_risk",
  acf_multicomponent: "ss.acf_multicomponent",
  acf_turnout_shift_norm: "ss.acf_turnout_shift_norm",
  acf_party_shift_norm: "ss.acf_party_shift_norm",
  registered_voters: "p.registered_voters",
  actual_voters: "p.actual_voters",
} as const;

export type AnomalySortKey = keyof typeof ANOMALY_SORT_SQL;
export const VALID_ANOMALY_SORT_KEYS = Object.keys(
  ANOMALY_SORT_SQL,
) as AnomalySortKey[];

const METHODOLOGY_COLUMN: Record<string, string> = {
  benford: "ss.benford_risk",
  peer: "ss.peer_risk",
  acf: "ss.acf_risk",
  protocol: "ss.protocol_violation_count",
};

const ANOMALY_GEO_FILTER_COLUMNS = {
  kmetstvo: "l.kmetstvo_id",
  local_region: "l.local_region_id",
  municipality: "l.municipality_id",
  district: "l.district_id",
  rik: "l.rik_id",
} as const;

export function resolveAnomalyGeoFilter(query: {
  kmetstvo?: string;
  local_region?: string;
  municipality?: string;
  district?: string;
  rik?: string;
}): { column: string; value: string } | null {
  if (query.kmetstvo)
    return { column: ANOMALY_GEO_FILTER_COLUMNS.kmetstvo, value: query.kmetstvo };
  if (query.local_region)
    return {
      column: ANOMALY_GEO_FILTER_COLUMNS.local_region,
      value: query.local_region,
    };
  if (query.municipality)
    return {
      column: ANOMALY_GEO_FILTER_COLUMNS.municipality,
      value: query.municipality,
    };
  if (query.district)
    return { column: ANOMALY_GEO_FILTER_COLUMNS.district, value: query.district };
  if (query.rik)
    return { column: ANOMALY_GEO_FILTER_COLUMNS.rik, value: query.rik };
  return null;
}

// ---------- query function ----------

export interface AnomalyOptions {
  electionId: number | string;
  minRisk: number;
  sort: AnomalySortKey;
  order: "asc" | "desc";
  limit: number | null;
  offset: number;
  methodology?: string;
  minViolations: number;
  geoFilter: { column: string; value: string } | null;
  sectionCode?: string;
  excludeSpecial: boolean;
}

export interface AnomalySection {
  section_code: string;
  settlement_name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  protocol_url: string | null;
  risk_score: number;
  turnout_rate: number;
  turnout_zscore: number;
  benford_chi2: number;
  benford_p: number;
  benford_score: number;
  ekatte_turnout_zscore: number;
  ekatte_turnout_zscore_norm: number;
  peer_vote_deviation: number;
  peer_vote_deviation_norm: number;
  arithmetic_error: number;
  vote_sum_mismatch: number;
  protocol_violation_count: number;
  section_type: string;
  benford_risk: number;
  peer_risk: number;
  acf_risk: number;
  acf_turnout_outlier: number;
  acf_winner_outlier: number;
  acf_invalid_outlier: number;
  acf_multicomponent: number;
  acf_turnout_shift: number | null;
  acf_turnout_shift_norm: number;
  acf_party_shift: number | null;
  acf_party_shift_norm: number;
  registered_voters: number | null;
  actual_voters: number | null;
  turnout_history: string | null;
}

export interface AnomalyResult {
  sections: AnomalySection[];
  total: number;
}

export function getAnomalies(
  db: DatabaseType,
  opts: AnomalyOptions,
): AnomalyResult {
  const sortColumn = ANOMALY_SORT_SQL[opts.sort];
  const orderDir = opts.order === "asc" ? "ASC" : "DESC";
  const riskColumn = opts.methodology
    ? METHODOLOGY_COLUMN[opts.methodology] ?? "ss.risk_score"
    : "ss.risk_score";

  const violationsClause =
    opts.minViolations > 0 ? " AND ss.protocol_violation_count >= ?" : "";
  const filterClause = opts.geoFilter
    ? ` AND ${opts.geoFilter.column} = ?`
    : "";
  const sectionClause = opts.sectionCode ? " AND ss.section_code LIKE ?" : "";
  const typeClause = opts.excludeSpecial
    ? " AND ss.section_type = 'normal'"
    : "";

  const baseParams: unknown[] = [opts.electionId, opts.minRisk];
  if (opts.minViolations > 0) baseParams.push(opts.minViolations);
  if (opts.geoFilter) baseParams.push(opts.geoFilter.value);
  if (opts.sectionCode) baseParams.push(`%${opts.sectionCode}%`);

  // Location columns: sections can have per-election overrides in
  // s.address/s.lat/s.lng (e.g. a polling station was temporarily moved
  // while its usual building was under renovation). Prefer those over the
  // shared locations row — same rule getSectionsGeo already follows, so
  // the map pin and the sidebar header agree on where the section lives.
  const sql = `
    SELECT ss.section_code,
           COALESCE(s.settlement_name, l.settlement_name) AS settlement_name,
           COALESCE(s.address, l.address) AS address,
           COALESCE(s.lat, l.lat) AS lat,
           COALESCE(s.lng, l.lng) AS lng,
           s.protocol_url,
           ss.risk_score, ss.turnout_rate, ss.turnout_zscore,
           ss.benford_chi2, ss.benford_p, ss.benford_score,
           ss.ekatte_turnout_zscore, ss.ekatte_turnout_zscore_norm,
           ss.peer_vote_deviation, ss.peer_vote_deviation_norm,
           ss.arithmetic_error, ss.vote_sum_mismatch,
           ss.protocol_violation_count,
           ss.section_type,
           ss.benford_risk, ss.peer_risk, ss.acf_risk,
           ss.acf_turnout_outlier, ss.acf_winner_outlier, ss.acf_invalid_outlier,
           ss.acf_multicomponent,
           ss.acf_turnout_shift, ss.acf_turnout_shift_norm,
           ss.acf_party_shift, ss.acf_party_shift_norm,
           p.registered_voters, p.actual_voters,
           (SELECT json_group_array(t) FROM (
             SELECT ss2.turnout_rate AS t
             FROM section_scores ss2
             JOIN elections e2 ON e2.id = ss2.election_id
             WHERE ss2.section_code = ss.section_code
             ORDER BY e2.date
           )) AS turnout_history
      FROM section_scores ss
      JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
      JOIN locations l ON l.id = s.location_id
      LEFT JOIN protocols p ON p.election_id = ss.election_id AND p.section_code = ss.section_code
     WHERE ss.election_id = ? AND ${riskColumn} >= ?${violationsClause}${filterClause}${sectionClause}${typeClause}
     ORDER BY ${sortColumn} ${orderDir}
     ${opts.limit != null ? "LIMIT ? OFFSET ?" : ""}
  `;

  const countSql = `
    SELECT COUNT(*) as total
      FROM section_scores ss
      JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
      JOIN locations l ON l.id = s.location_id
     WHERE ss.election_id = ? AND ${riskColumn} >= ?${violationsClause}${filterClause}${sectionClause}${typeClause}
  `;

  const sections =
    opts.limit != null
      ? (db
          .prepare(sql)
          .all(...baseParams, opts.limit, opts.offset) as AnomalySection[])
      : (db.prepare(sql).all(...baseParams) as AnomalySection[]);

  const { total } = db.prepare(countSql).get(...baseParams) as {
    total: number;
  };

  return { sections, total };
}
