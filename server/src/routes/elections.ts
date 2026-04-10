import { Hono } from "hono";
import getDb from "../db.js";
import {
  BALLOT_JOIN_SQL,
  BALLOT_NAME_SQL,
  getAggregatedBallot,
  getSectionBallot,
  resolveGeoFilter,
} from "../db/ballot.js";

// Single source of truth for /persistence sort: key = accepted query value,
// value = fully-qualified SQL column. Only the values are ever interpolated.
const PERSISTENCE_SORT_SQL = {
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
type PersistenceSortKey = keyof typeof PERSISTENCE_SORT_SQL;

const elections = new Hono();

elections.get("/", (c) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, name, date, type FROM elections ORDER BY date DESC")
    .all();
  return c.json(rows);
});

elections.get("/compare", (c) => {
  const db = getDb();
  const electionsParam = c.req.query("elections");

  if (!electionsParam) {
    return c.json({ error: "Missing required 'elections' query parameter" }, 400);
  }

  const ids = electionsParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (ids.length < 2) {
    return c.json({ error: "At least 2 elections are required" }, 400);
  }
  if (ids.length > 10) {
    return c.json({ error: "Maximum 10 elections allowed" }, 400);
  }

  const numericIds = ids.map(Number);
  if (numericIds.some(isNaN)) {
    return c.json({ error: "All election IDs must be numeric" }, 400);
  }

  // Verify all elections exist
  const placeholders = numericIds.map(() => "?").join(",");
  const existingElections = db
    .prepare(`SELECT id, name, date, type FROM elections WHERE id IN (${placeholders})`)
    .all(...numericIds) as { id: number; name: string; date: string; type: string }[];

  if (existingElections.length !== numericIds.length) {
    const foundIds = new Set(existingElections.map((e) => e.id));
    const missing = numericIds.find((id) => !foundIds.has(id));
    return c.json({ error: `Election with id ${missing} not found` }, 404);
  }

  // Geographic filter — resolveGeoFilter picks the most specific param.
  const geo = resolveGeoFilter({
    kmetstvo: c.req.query("kmetstvo"),
    local_region: c.req.query("local_region"),
    municipality: c.req.query("municipality"),
    district: c.req.query("district"),
    rik: c.req.query("rik"),
  });

  // Pull aggregated ballot per election, stamped with election_id so the
  // downstream cross-election aggregation logic keeps working unchanged.
  const rows: { election_id: number; party_id: number; party_name: string; votes: number }[] = [];
  for (const elId of numericIds) {
    const ballotRows = getAggregatedBallot(
      db,
      elId,
      geo ? { geoColumn: geo.column, geoValue: geo.value } : {},
    );
    for (const r of ballotRows) {
      rows.push({
        election_id: elId,
        party_id: r.party_id,
        party_name: r.party_name,
        votes: r.votes,
      });
    }
  }

  // Compute totals per election for percentage calculation
  const totalsByElection = new Map<number, number>();
  for (const row of rows) {
    totalsByElection.set(
      row.election_id,
      (totalsByElection.get(row.election_id) || 0) + row.votes
    );
  }

  // Group by party
  const partyMap = new Map<number, { party_name: string; elections: Map<number, number>; totalVotes: number }>();
  for (const row of rows) {
    let entry = partyMap.get(row.party_id);
    if (!entry) {
      entry = { party_name: row.party_name, elections: new Map(), totalVotes: 0 };
      partyMap.set(row.party_id, entry);
    }
    entry.elections.set(row.election_id, row.votes);
    entry.totalVotes += row.votes;
  }

  // Build sorted entries
  const sortedEntries = Array.from(partyMap.entries())
    .sort((a, b) => b[1].totalVotes - a[1].totalVotes);

  // For each election, compute percentages using largest remainder method
  // to ensure they sum to exactly 100.0
  const percentages = new Map<number, Map<number, number>>(); // elId -> partyId -> pct
  for (const elId of numericIds) {
    const total = totalsByElection.get(elId) || 1;
    const exact = sortedEntries.map(([partyId, data]) => {
      const votes = data.elections.get(elId) || 0;
      return { partyId, exact: (votes / total) * 100 };
    });
    const floored = exact.map((e) => Math.floor(e.exact * 10) / 10);
    const remainders = exact.map((e, i) => ({
      index: i,
      remainder: Math.round((e.exact * 10 - Math.floor(e.exact * 10)) * 1e9) / 1e9,
    }));
    const currentSum = Math.round(floored.reduce((a, b) => a + b, 0) * 10);
    const target = 1000; // 100.0 * 10
    let toDistribute = target - currentSum;
    remainders.sort((a, b) => b.remainder - a.remainder);
    for (const r of remainders) {
      if (toDistribute <= 0) break;
      floored[r.index] = Math.round((floored[r.index] + 0.1) * 10) / 10;
      toDistribute--;
    }
    const elMap = new Map<number, number>();
    sortedEntries.forEach(([partyId], i) => {
      elMap.set(partyId, floored[i]);
    });
    percentages.set(elId, elMap);
  }

  const results = sortedEntries.map(([partyId, data]) => {
    const electionsObj: Record<string, { votes: number; percentage: number }> = {};
    for (const elId of numericIds) {
      const votes = data.elections.get(elId) || 0;
      const pct = percentages.get(elId)!.get(partyId) || 0;
      electionsObj[String(elId)] = { votes, percentage: pct };
    }
    return {
      party_id: partyId,
      party_name: data.party_name,
      elections: electionsObj,
    };
  });

  return c.json({ elections: existingElections, results });
});

// Cross-election persistence index — sections flagged across many elections
// MUST be registered before /:id routes to avoid "persistence" matching as :id
elections.get("/persistence", (c) => {
  const db = getDb();

  const minElections = Math.max(parseInt(c.req.query("min_elections") ?? "5", 10), 1);
  const minScore = parseFloat(c.req.query("min_score") ?? "0");
  const sort = c.req.query("sort") ?? "persistence_score";
  const order = c.req.query("order") === "asc" ? "ASC" : "DESC";
  const limit = Math.max(parseInt(c.req.query("limit") ?? "100", 10), 1);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10), 0);
  const excludeSpecial = c.req.query("exclude_special") === "true";
  const section = c.req.query("section");

  const sortCol: PersistenceSortKey = (sort in PERSISTENCE_SORT_SQL)
    ? (sort as PersistenceSortKey)
    : "persistence_score";
  const sortColumnSql = PERSISTENCE_SORT_SQL[sortCol];

  // Election weights: type weight × recency weight
  // Type: parliament/president/european = 1.0, local_council/local_mayor = 0.7, kmetstvo/neighbourhood = 0.4
  // Recency: linear from 0.6 (oldest, 2021) to 1.0 (newest, 2024)
  const elRows = db.prepare(`SELECT id, name, date, type FROM elections ORDER BY date`).all() as {
    id: number; name: string; date: string; type: string;
  }[];

  const typeWeights: Record<string, number> = {
    parliament: 1.0, president: 1.0, european: 1.0,
    local_council: 0.7, local_mayor: 0.7,
    local_mayor_kmetstvo: 0.4, local_mayor_neighbourhood: 0.4,
  };

  const dates = elRows.map((e) => new Date(e.date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const dateRange = maxDate - minDate || 1;

  const electionWeights = new Map<number, number>();
  for (const e of elRows) {
    const typeW = typeWeights[e.type] ?? 0.7;
    const recencyW = 0.6 + 0.4 * ((new Date(e.date).getTime() - minDate) / dateRange);
    electionWeights.set(e.id, typeW * recencyW);
  }

  // Build weight CASE expression for SQL
  const weightCases = elRows
    .map((e) => `WHEN ${e.id} THEN ${electionWeights.get(e.id)!.toFixed(4)}`)
    .join(" ");
  const weightExpr = `CASE ss.election_id ${weightCases} ELSE 0.7 END`;

  const typeClause = excludeSpecial ? " AND ss.section_type = 'normal'" : "";
  const sectionClause = section ? " AND ss.section_code LIKE ?" : "";

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
      WHERE 1=1${typeClause}${sectionClause}
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
      SELECT sec.section_code, loc.settlement_name, loc.lat, loc.lng,
        ROW_NUMBER() OVER (PARTITION BY sec.section_code ORDER BY sec.election_id DESC) AS rn
      FROM sections sec
      JOIN locations loc ON loc.id = sec.location_id
    ) l ON l.section_code = s.section_code AND l.rn = 1
    LEFT JOIN voter_avgs va ON va.section_code = s.section_code
    WHERE s.persistence_score >= ?
    ORDER BY ${sortColumnSql} ${order}
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
      WHERE 1=1${typeClause}${sectionClause}
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

  const params: unknown[] = [];
  if (section) params.push(`%${section}%`);
  params.push(minElections);
  params.push(minScore);

  const countParams = [...params];
  params.push(limit, offset);

  const sections = db.prepare(sql).all(...params);
  const { total } = db.prepare(countSql).get(...countParams) as { total: number };

  return c.json({
    sections,
    total,
    limit,
    offset,
    elections_count: elRows.length,
    weights: Object.fromEntries(elRows.map((e) => [e.id, {
      name: e.name,
      weight: Math.round(electionWeights.get(e.id)! * 1000) / 1000,
    }])),
  });
});

// Per-section election history — detailed breakdown for expanded row
elections.get("/persistence/:sectionCode", (c) => {
  const db = getDb();
  const { sectionCode } = c.req.param();

  const rows = db.prepare(`
    SELECT ss.election_id, e.name AS election_name, e.date AS election_date, e.type AS election_type,
      ss.risk_score, ss.benford_risk, ss.peer_risk, ss.acf_risk,
      ss.turnout_rate, ss.arithmetic_error, ss.vote_sum_mismatch,
      ss.protocol_violation_count, s.protocol_url
    FROM section_scores ss
    JOIN elections e ON e.id = ss.election_id
    LEFT JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
    WHERE ss.section_code = ?
    ORDER BY e.date
  `).all(sectionCode);

  return c.json({ section_code: sectionCode, elections: rows });
});

const VALID_GROUP_BY = ["rik", "district", "municipality", "kmetstvo", "local_region"] as const;
type GroupByLevel = typeof VALID_GROUP_BY[number];

const GEO_TABLE_MAP: Record<GroupByLevel, { table: string; column: string }> = {
  rik: { table: "riks", column: "rik_id" },
  district: { table: "districts", column: "district_id" },
  municipality: { table: "municipalities", column: "municipality_id" },
  kmetstvo: { table: "kmetstva", column: "kmetstvo_id" },
  local_region: { table: "local_regions", column: "local_region_id" },
};

elections.get("/:id/turnout", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id) as { id: number; name: string; date: string; type: string } | undefined;

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  const groupBy = c.req.query("group_by") as string | undefined;

  if (!groupBy) {
    return c.json({ error: "Missing required 'group_by' query parameter" }, 400);
  }

  if (!VALID_GROUP_BY.includes(groupBy as GroupByLevel)) {
    return c.json({ error: `Invalid group_by value. Must be one of: ${VALID_GROUP_BY.join(", ")}` }, 400);
  }

  const geo = GEO_TABLE_MAP[groupBy as GroupByLevel];

  // Determine geographic filter — most specific wins
  const kmetstvo = c.req.query("kmetstvo");
  const localRegion = c.req.query("local_region");
  const municipality = c.req.query("municipality");
  const district = c.req.query("district");
  const rik = c.req.query("rik");

  let filterColumn: string | null = null;
  let filterValue: string | null = null;

  if (kmetstvo) {
    filterColumn = "l.kmetstvo_id";
    filterValue = kmetstvo;
  } else if (localRegion) {
    filterColumn = "l.local_region_id";
    filterValue = localRegion;
  } else if (municipality) {
    filterColumn = "l.municipality_id";
    filterValue = municipality;
  } else if (district) {
    filterColumn = "l.district_id";
    filterValue = district;
  } else if (rik) {
    filterColumn = "l.rik_id";
    filterValue = rik;
  }

  const filterClause = filterColumn && filterValue ? ` AND ${filterColumn} = ?` : "";
  const params: unknown[] = filterColumn && filterValue ? [id, filterValue] : [id];

  const sql = `SELECT g.id AS group_id, g.name AS group_name,
       SUM(COALESCE(p.registered_voters, 0)) AS registered_voters,
       SUM(COALESCE(p.actual_voters, 0)) AS actual_voters
FROM protocols p
JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
JOIN locations l ON l.id = s.location_id
JOIN ${geo.table} g ON g.id = l.${geo.column}
WHERE p.election_id = ?${filterClause}
GROUP BY g.id, g.name
ORDER BY group_name`;

  const rows = db.prepare(sql).all(...params) as {
    group_id: number;
    group_name: string;
    registered_voters: number;
    actual_voters: number;
  }[];

  const turnout = rows.map((r) => ({
    ...r,
    turnout_pct: r.registered_voters > 0
      ? Math.round((r.actual_voters / r.registered_voters) * 10000) / 100
      : 0,
  }));

  const totalRegistered = rows.reduce((s, r) => s + r.registered_voters, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual_voters, 0);

  return c.json({
    election,
    turnout,
    totals: {
      registered_voters: totalRegistered,
      actual_voters: totalActual,
      turnout_pct: totalRegistered > 0
        ? Math.round((totalActual / totalRegistered) * 10000) / 100
        : 0,
    },
  });
});

// Single source of truth for /:id/anomalies sort: key = accepted query value,
// value = fully-qualified SQL column. Keys feed the whitelist, values are the
// only strings ever interpolated into ORDER BY — never user input.
const ANOMALY_SORT_SQL = {
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
type AnomalySortKey = keyof typeof ANOMALY_SORT_SQL;
const VALID_SORT_COLUMNS = Object.keys(ANOMALY_SORT_SQL) as AnomalySortKey[];

elections.get("/:id/anomalies", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id) as { id: number; name: string; date: string; type: string } | undefined;

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  // Parse query params
  const minRisk = parseFloat(c.req.query("min_risk") ?? "0.3");
  const sort = c.req.query("sort") ?? "risk_score";
  const order = c.req.query("order") ?? "desc";
  const limitParam = c.req.query("limit");
  const limit = limitParam === "0" ? null : Math.max(parseInt(limitParam ?? "50", 10) || 50, 1);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  if (!(sort in ANOMALY_SORT_SQL)) {
    return c.json({ error: `Invalid sort column. Must be one of: ${VALID_SORT_COLUMNS.join(", ")}` }, 400);
  }
  const sortColumn = ANOMALY_SORT_SQL[sort as AnomalySortKey];

  const orderDir = order === "asc" ? "ASC" : "DESC";

  // Geographic filter — most specific wins
  const kmetstvo = c.req.query("kmetstvo");
  const localRegion = c.req.query("local_region");
  const municipality = c.req.query("municipality");
  const district = c.req.query("district");
  const rik = c.req.query("rik");

  let filterColumn: string | null = null;
  let filterValue: string | null = null;

  if (kmetstvo) {
    filterColumn = "l.kmetstvo_id";
    filterValue = kmetstvo;
  } else if (localRegion) {
    filterColumn = "l.local_region_id";
    filterValue = localRegion;
  } else if (municipality) {
    filterColumn = "l.municipality_id";
    filterValue = municipality;
  } else if (district) {
    filterColumn = "l.district_id";
    filterValue = district;
  } else if (rik) {
    filterColumn = "l.rik_id";
    filterValue = rik;
  }

  const sectionCode = c.req.query("section");
  const filterClause = filterColumn && filterValue ? ` AND ${filterColumn} = ?` : "";
  const sectionClause = sectionCode ? " AND ss.section_code LIKE ?" : "";
  const excludeSpecial = c.req.query("exclude_special") === "true";
  const typeClause = excludeSpecial ? " AND ss.section_type = 'normal'" : "";

  // Which risk column to filter by? Depends on methodology query param
  const methodology = c.req.query("methodology"); // "benford", "peer", "acf", "protocol", or default (combined)
  let riskColumn = "ss.risk_score";
  if (methodology === "benford") riskColumn = "ss.benford_risk";
  else if (methodology === "peer") riskColumn = "ss.peer_risk";
  else if (methodology === "acf") riskColumn = "ss.acf_risk";
  else if (methodology === "protocol") riskColumn = "ss.protocol_violation_count";

  // Separate protocol violations filter (additive with methodology)
  const minViolations = parseInt(c.req.query("min_violations") ?? "0", 10);
  const violationsClause = minViolations > 0 ? " AND ss.protocol_violation_count >= ?" : "";

  const baseParams: unknown[] = [id, minRisk];
  if (minViolations > 0) baseParams.push(minViolations);
  if (filterColumn && filterValue) baseParams.push(filterValue);
  if (sectionCode) baseParams.push(`%${sectionCode}%`);

  const sql = `SELECT ss.section_code, l.settlement_name, l.address, l.lat, l.lng, s.protocol_url,
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
       p.registered_voters, p.actual_voters
FROM section_scores ss
JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
JOIN locations l ON l.id = s.location_id
LEFT JOIN protocols p ON p.election_id = ss.election_id AND p.section_code = ss.section_code
WHERE ss.election_id = ? AND ${riskColumn} >= ?${violationsClause}${filterClause}${sectionClause}${typeClause}
ORDER BY ${sortColumn} ${orderDir}
${limit != null ? "LIMIT ? OFFSET ?" : ""}`;

  const countSql = `SELECT COUNT(*) as total
FROM section_scores ss
JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
JOIN locations l ON l.id = s.location_id
WHERE ss.election_id = ? AND ${riskColumn} >= ?${violationsClause}${filterClause}${sectionClause}${typeClause}`;

  const sections = limit != null
    ? db.prepare(sql).all(...baseParams, limit, offset)
    : db.prepare(sql).all(...baseParams);
  const { total } = db.prepare(countSql).get(...baseParams) as { total: number };

  return c.json({ election, sections, total, limit, offset });
});

// Protocol violations for a specific section
elections.get("/:id/violations/:sectionCode", (c) => {
  const db = getDb();
  const { id, sectionCode } = c.req.param();

  const violations = db
    .prepare(
      `SELECT rule_id, description, expected_value, actual_value, severity
       FROM protocol_violations
       WHERE election_id = ? AND section_code = ?
       ORDER BY rule_id`
    )
    .all(id, sectionCode);

  return c.json({ section_code: sectionCode, violations });
});

// Protocol violations summary for an election (counts by rule)
elections.get("/:id/violations", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  const summary = db
    .prepare(
      `SELECT rule_id, severity, COUNT(*) as count,
              COUNT(DISTINCT section_code) as sections_affected
       FROM protocol_violations
       WHERE election_id = ?
       GROUP BY rule_id, severity
       ORDER BY rule_id`
    )
    .all(id);

  const total = db
    .prepare(
      `SELECT COUNT(DISTINCT section_code) as sections_with_violations,
              COUNT(*) as total_violations
       FROM protocol_violations
       WHERE election_id = ?`
    )
    .get(id) as { sections_with_violations: number; total_violations: number };

  return c.json({ ...total, rules: summary });
});

// All sections with top-5 party results + coordinates (for sections map)
elections.get("/:id/sections/geo", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id) as { id: number; name: string; date: string; type: string } | undefined;

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  // Geographic filter
  const municipality = c.req.query("municipality");
  const district = c.req.query("district");
  const rik = c.req.query("rik");

  let filterColumn: string | null = null;
  let filterValue: string | null = null;

  if (municipality) {
    filterColumn = "l.municipality_id";
    filterValue = municipality;
  } else if (district) {
    filterColumn = "l.district_id";
    filterValue = district;
  } else if (rik) {
    filterColumn = "l.rik_id";
    filterValue = rik;
  }

  const filterClause = filterColumn && filterValue ? ` AND ${filterColumn} = ?` : "";
  const sectionParams: unknown[] = filterColumn && filterValue ? [id, filterValue] : [id];

  // Step 1: All sections with voter data + coordinates
  const sectionRows = db.prepare(`
    SELECT s.section_code, l.settlement_name, l.lat, l.lng,
           p.registered_voters, p.actual_voters
    FROM sections s
    JOIN locations l ON l.id = s.location_id
    JOIN protocols p ON p.election_id = s.election_id AND p.section_code = s.section_code
    WHERE s.election_id = ?${filterClause}
  `).all(...sectionParams) as {
    section_code: string;
    settlement_name: string;
    lat: number | null;
    lng: number | null;
    registered_voters: number;
    actual_voters: number;
  }[];

  // Step 2: Top 5 parties per section (window function)
  const partyRows = db.prepare(`
    SELECT section_code, party_name, color, votes, pct FROM (
      SELECT v.section_code, ${BALLOT_NAME_SQL} AS party_name, p.color,
             v.total AS votes,
             ROUND(v.total * 100.0 / NULLIF(SUM(v.total) OVER (PARTITION BY v.section_code), 0), 1) AS pct,
             ROW_NUMBER() OVER (PARTITION BY v.section_code ORDER BY v.total DESC) AS rn
      FROM votes v
      ${BALLOT_JOIN_SQL}
      JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
      JOIN locations l ON l.id = s.location_id
      WHERE v.election_id = ?${filterClause}
    ) ranked WHERE rn <= 5
  `).all(...sectionParams) as {
    section_code: string;
    party_name: string;
    color: string;
    votes: number;
    pct: number;
  }[];

  // Build lookup: section_code -> parties[]
  const partyMap = new Map<string, { name: string; color: string; votes: number; pct: number }[]>();
  for (const row of partyRows) {
    let arr = partyMap.get(row.section_code);
    if (!arr) {
      arr = [];
      partyMap.set(row.section_code, arr);
    }
    arr.push({ name: row.party_name, color: row.color, votes: row.votes, pct: row.pct });
  }

  // Combine into response
  const sections = sectionRows
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => {
      const parties = partyMap.get(s.section_code) ?? [];
      const winner = parties[0] ?? null;
      return {
        section_code: s.section_code,
        lat: s.lat,
        lng: s.lng,
        settlement_name: s.settlement_name,
        registered_voters: s.registered_voters,
        actual_voters: s.actual_voters,
        winner_party: winner?.name ?? null,
        winner_color: winner?.color ?? "#999",
        winner_pct: winner?.pct ?? 0,
        parties,
      };
    });

  c.header("Cache-Control", "public, max-age=86400");
  return c.json({ election, sections });
});

// Single section detail: protocol + party votes
elections.get("/:id/sections/:code", (c) => {
  const db = getDb();
  const { id, code } = c.req.param();

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id) as { id: number; name: string; date: string; type: string } | undefined;
  if (!election) return c.json({ error: "Election not found" }, 404);

  const protocol = db.prepare(`
    SELECT p.registered_voters, p.actual_voters, p.received_ballots,
           p.added_voters, p.invalid_votes, p.null_votes,
           s.machine_count
    FROM protocols p
    JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
    WHERE p.election_id = ? AND p.section_code = ?
  `).get(id, code) as {
    registered_voters: number; actual_voters: number; received_ballots: number;
    added_voters: number; invalid_votes: number; null_votes: number;
    machine_count: number;
  } | undefined;

  if (!protocol) return c.json({ error: "Section not found" }, 404);

  // Ballot list comes from the shared helper — single source of truth for the
  // "candidate pair for presidents, party name otherwise" rule.
  const ballotRows = getSectionBallot(db, id, code);
  const parties = ballotRows.map((r) => ({
    name: r.party_name,
    short_name: r.party_short_name,
    color: r.party_color,
    votes: r.votes,
    paper: r.paper,
    machine: r.machine,
  }));

  const validVotes = parties.reduce((sum, p) => sum + p.votes, 0);

  // --- Comparison context ---

  const locInfo = db.prepare(`
    SELECT l.ekatte, l.settlement_name, l.municipality_id, s.rik_code,
           m.name as municipality_name
    FROM sections s
    JOIN locations l ON l.id = s.location_id
    LEFT JOIN municipalities m ON m.id = l.municipality_id
    WHERE s.election_id = ? AND s.section_code = ?
  `).get(id, code) as { ekatte: string; settlement_name: string; municipality_id: number; rik_code: string; municipality_name: string } | undefined;

  const rikAvg = locInfo ? db.prepare(`
    SELECT AVG(ss.turnout_rate) as avg_turnout
    FROM section_scores ss
    JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
    WHERE ss.election_id = ? AND s.rik_code = ? AND ss.section_type = 'normal'
  `).get(id, locInfo.rik_code) as { avg_turnout: number } | undefined : undefined;

  const ekatteAvg = locInfo ? db.prepare(`
    SELECT AVG(ss.turnout_rate) as avg_turnout, COUNT(*) as peer_count
    FROM section_scores ss
    JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
    JOIN locations l ON l.id = s.location_id
    WHERE ss.election_id = ? AND l.ekatte = ? AND ss.section_type = 'normal'
  `).get(id, locInfo.ekatte) as { avg_turnout: number; peer_count: number } | undefined : undefined;

  const muniAvg = locInfo ? db.prepare(`
    SELECT AVG(ss.turnout_rate) as avg_turnout
    FROM section_scores ss
    JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
    JOIN locations l ON l.id = s.location_id
    WHERE ss.election_id = ? AND l.municipality_id = ? AND ss.section_type = 'normal'
  `).get(id, locInfo.municipality_id) as { avg_turnout: number } | undefined : undefined;

  const muniOutlierThresholds = locInfo ? db.prepare(`
    SELECT
      (SELECT ss2.turnout_rate FROM section_scores ss2
       JOIN sections s2 ON s2.election_id = ss2.election_id AND s2.section_code = ss2.section_code
       JOIN locations l2 ON l2.id = s2.location_id
       WHERE ss2.election_id = ? AND l2.municipality_id = ? AND ss2.section_type = 'normal'
       ORDER BY ss2.turnout_rate LIMIT 1 OFFSET (
         SELECT COUNT(*) * 3 / 4 FROM section_scores ss3
         JOIN sections s3 ON s3.election_id = ss3.election_id AND s3.section_code = ss3.section_code
         JOIN locations l3 ON l3.id = s3.location_id
         WHERE ss3.election_id = ? AND l3.municipality_id = ? AND ss3.section_type = 'normal'
       )
      ) as turnout_q3
  `).get(id, locInfo.municipality_id, id, locInfo.municipality_id) as { turnout_q3: number } | undefined : undefined;

  let prevElection: { id: number; name: string; date: string } | undefined;
  let prevTurnout: number | undefined;
  if (election) {
    prevElection = db.prepare(`
      SELECT id, name, date FROM elections
      WHERE type = ? AND date < ? ORDER BY date DESC LIMIT 1
    `).get(election.type, election.date) as { id: number; name: string; date: string } | undefined;

    if (prevElection) {
      const prev = db.prepare(`
        SELECT ss.turnout_rate FROM section_scores ss
        WHERE ss.election_id = ? AND ss.section_code = ?
      `).get(prevElection.id, code) as { turnout_rate: number } | undefined;
      prevTurnout = prev?.turnout_rate;
    }
  }

  return c.json({
    protocol: {
      ...protocol,
      valid_votes: validVotes,
    },
    parties: parties.map((p) => ({
      ...p,
      pct: validVotes > 0 ? (p.votes / validVotes) * 100 : 0,
    })),
    context: {
      municipality_name: locInfo?.municipality_name ?? null,
      rik_avg_turnout: rikAvg?.avg_turnout ?? null,
      ekatte_avg_turnout: ekatteAvg?.avg_turnout ?? null,
      ekatte_peer_count: ekatteAvg?.peer_count ?? null,
      municipality_avg_turnout: muniAvg?.avg_turnout ?? null,
      municipality_turnout_q3: muniOutlierThresholds?.turnout_q3 ?? null,
      prev_election: prevElection ?? null,
      prev_turnout: prevTurnout ?? null,
    },
  });
});

elections.get("/:id/results", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id);

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  const geo = resolveGeoFilter({
    kmetstvo: c.req.query("kmetstvo"),
    local_region: c.req.query("local_region"),
    municipality: c.req.query("municipality"),
    district: c.req.query("district"),
    rik: c.req.query("rik"),
  });

  const ballotRows = getAggregatedBallot(
    db,
    id,
    geo ? { geoColumn: geo.column, geoValue: geo.value } : {},
  );

  // Preserve the existing response shape: { party_id, party_name, total_votes }.
  const results = ballotRows.map((r) => ({
    party_id: r.party_id,
    party_name: r.party_name,
    total_votes: r.votes,
  }));

  return c.json({ election, results });
});

elections.get("/:id/results/geo/districts", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  if (!/^\d+$/.test(id)) {
    return c.json({ error: "Election ID must be numeric" }, 400);
  }

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id) as { id: number; name: string; date: string; type: string } | undefined;

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  // Population-weighted centroids per district (needs lat/lng)
  const centroidRows = db
    .prepare(`
      SELECT
        l.district_id,
        SUM(p.registered_voters * l.lat) / SUM(p.registered_voters) AS weighted_lat,
        SUM(p.registered_voters * l.lng) / SUM(p.registered_voters) AS weighted_lng
      FROM protocols p
      JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
      JOIN locations l ON l.id = s.location_id
      WHERE p.election_id = ? AND l.lat IS NOT NULL AND l.lng IS NOT NULL AND p.registered_voters > 0
      GROUP BY l.district_id
    `)
    .all(id) as {
      district_id: number;
      weighted_lat: number;
      weighted_lng: number;
    }[];

  const centroidMap = new Map(centroidRows.map((r) => [r.district_id, r]));

  // Voter totals per district (all sections, no lat/lng filter)
  const voterRows = db
    .prepare(`
      SELECT
        l.district_id,
        SUM(p.registered_voters) AS registered_voters,
        SUM(p.actual_voters) AS actual_voters,
        SUM(p.null_votes) AS null_votes
      FROM protocols p
      JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
      JOIN locations l ON l.id = s.location_id
      WHERE p.election_id = ?
      GROUP BY l.district_id
    `)
    .all(id) as {
      district_id: number;
      registered_voters: number;
      actual_voters: number;
      null_votes: number;
    }[];

  const voterMap = new Map(voterRows.map((r) => [r.district_id, r]));

  // Votes by district and party
  const voteRows = db
    .prepare(`
      SELECT
        l.district_id,
        ep.party_id,
        ${BALLOT_NAME_SQL} AS party_name,
        p.color AS party_color,
        SUM(v.total) AS votes
      FROM votes v
      JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
      JOIN locations l ON l.id = s.location_id
      ${BALLOT_JOIN_SQL}
      WHERE v.election_id = ?
      GROUP BY l.district_id, ep.party_id
    `)
    .all(id) as {
      district_id: number;
      party_id: number;
      party_name: string;
      party_color: string | null;
      votes: number;
    }[];

  const districtVotes = new Map<number, Map<number, { votes: number; party_name: string; party_color: string | null }>>();
  for (const row of voteRows) {
    if (!districtVotes.has(row.district_id)) {
      districtVotes.set(row.district_id, new Map());
    }
    districtVotes.get(row.district_id)!.set(row.party_id, {
      votes: row.votes,
      party_name: row.party_name,
      party_color: row.party_color,
    });
  }

  // Fetch districts with geo
  const districts = db
    .prepare("SELECT id, name, geo FROM districts WHERE geo IS NOT NULL ORDER BY id")
    .all() as { id: number; name: string; geo: string }[];

  const result = districts.map((dist) => {
    const centroid = centroidMap.get(dist.id);
    const voters = voterMap.get(dist.id);
    const partyMap = districtVotes.get(dist.id);

    const registered_voters = voters?.registered_voters ?? 0;
    const actual_voters = voters?.actual_voters ?? 0;
    const null_votes = voters?.null_votes ?? 0;
    const party_votes = partyMap
      ? Array.from(partyMap.values()).reduce((sum, p) => sum + p.votes, 0)
      : 0;
    const total_votes = party_votes + null_votes;

    const parties = partyMap
      ? Array.from(partyMap.entries())
          .map(([party_id, data]) => ({
            party_id,
            name: data.party_name,
            color: data.party_color ?? "#CCCCCC",
            votes: data.votes,
            pct: total_votes > 0 ? Math.round((data.votes / total_votes) * 10000) / 100 : 0,
          }))
          .sort((a, b) => b.votes - a.votes)
      : [];

    // Add "Не подкрепям никого" as a pseudo-party entry
    if (null_votes > 0) {
      parties.push({
        party_id: -1,
        name: "Не подкрепям никого",
        color: "#a0a0a0",
        votes: null_votes,
        pct: total_votes > 0 ? Math.round((null_votes / total_votes) * 10000) / 100 : 0,
      });
      parties.sort((a, b) => b.votes - a.votes);
    }

    const winner = parties.find((p) => p.party_id !== -1) ?? null;

    return {
      id: dist.id,
      name: dist.name,
      geo: JSON.parse(dist.geo),
      centroid: centroid
        ? { lat: Math.round(centroid.weighted_lat * 1e6) / 1e6, lng: Math.round(centroid.weighted_lng * 1e6) / 1e6 }
        : null,
      registered_voters,
      actual_voters,
      non_voters: registered_voters - actual_voters,
      total_votes,
      winner: winner
        ? { party_id: winner.party_id, name: winner.name, color: winner.color, votes: winner.votes, pct: winner.pct }
        : null,
      parties,
    };
  });

  return c.json({ election, districts: result });
});

elections.get("/:id/results/geo/municipalities", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  if (!/^\d+$/.test(id)) {
    return c.json({ error: "Election ID must be numeric" }, 400);
  }

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id) as { id: number; name: string; date: string; type: string } | undefined;

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  // Voter totals per municipality
  const voterRows = db
    .prepare(`
      SELECT
        l.municipality_id,
        SUM(p.registered_voters) AS registered_voters,
        SUM(p.actual_voters) AS actual_voters,
        SUM(p.null_votes) AS null_votes
      FROM protocols p
      JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
      JOIN locations l ON l.id = s.location_id
      WHERE p.election_id = ?
      GROUP BY l.municipality_id
    `)
    .all(id) as {
      municipality_id: number;
      registered_voters: number;
      actual_voters: number;
      null_votes: number;
    }[];

  const voterMap = new Map(voterRows.map((r) => [r.municipality_id, r]));

  // Votes by municipality and party
  const voteRows = db
    .prepare(`
      SELECT
        l.municipality_id,
        ep.party_id,
        ${BALLOT_NAME_SQL} AS party_name,
        p.color AS party_color,
        SUM(v.total) AS votes
      FROM votes v
      JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
      JOIN locations l ON l.id = s.location_id
      ${BALLOT_JOIN_SQL}
      WHERE v.election_id = ?
      GROUP BY l.municipality_id, ep.party_id
    `)
    .all(id) as {
      municipality_id: number;
      party_id: number;
      party_name: string;
      party_color: string | null;
      votes: number;
    }[];

  const muniVotes = new Map<number, Map<number, { votes: number; party_name: string; party_color: string | null }>>();
  for (const row of voteRows) {
    if (!muniVotes.has(row.municipality_id)) {
      muniVotes.set(row.municipality_id, new Map());
    }
    muniVotes.get(row.municipality_id)!.set(row.party_id, {
      votes: row.votes,
      party_name: row.party_name,
      party_color: row.party_color,
    });
  }

  const municipalities = db
    .prepare("SELECT id, name, geo FROM municipalities WHERE geo IS NOT NULL ORDER BY id")
    .all() as { id: number; name: string; geo: string }[];

  const result = municipalities.map((muni) => {
    const voters = voterMap.get(muni.id);
    const partyMap = muniVotes.get(muni.id);

    const registered_voters = voters?.registered_voters ?? 0;
    const actual_voters = voters?.actual_voters ?? 0;
    const null_votes = voters?.null_votes ?? 0;
    const party_votes = partyMap
      ? Array.from(partyMap.values()).reduce((sum, p) => sum + p.votes, 0)
      : 0;
    const total_votes = party_votes + null_votes;

    const parties = partyMap
      ? Array.from(partyMap.entries())
          .map(([party_id, data]) => ({
            party_id,
            name: data.party_name,
            color: data.party_color ?? "#CCCCCC",
            votes: data.votes,
            pct: total_votes > 0 ? Math.round((data.votes / total_votes) * 10000) / 100 : 0,
          }))
          .sort((a, b) => b.votes - a.votes)
      : [];

    if (null_votes > 0) {
      parties.push({
        party_id: -1,
        name: "Не подкрепям никого",
        color: "#a0a0a0",
        votes: null_votes,
        pct: total_votes > 0 ? Math.round((null_votes / total_votes) * 10000) / 100 : 0,
      });
      parties.sort((a, b) => b.votes - a.votes);
    }

    const winner = parties.find((p) => p.party_id !== -1) ?? null;

    return {
      id: muni.id,
      name: muni.name,
      geo: JSON.parse(muni.geo),
      registered_voters,
      actual_voters,
      non_voters: registered_voters - actual_voters,
      total_votes,
      winner: winner
        ? { party_id: winner.party_id, name: winner.name, color: winner.color, votes: winner.votes, pct: winner.pct }
        : null,
      parties,
    };
  });

  return c.json({ election, municipalities: result });
});

elections.get("/:id/results/geo/riks", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  if (!/^\d+$/.test(id)) {
    return c.json({ error: "Election ID must be numeric" }, 400);
  }

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id) as { id: number; name: string; date: string; type: string } | undefined;

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  const voterRows = db
    .prepare(`
      SELECT
        l.rik_id,
        SUM(p.registered_voters) AS registered_voters,
        SUM(p.actual_voters) AS actual_voters,
        SUM(p.null_votes) AS null_votes
      FROM protocols p
      JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
      JOIN locations l ON l.id = s.location_id
      WHERE p.election_id = ?
      GROUP BY l.rik_id
    `)
    .all(id) as {
      rik_id: number;
      registered_voters: number;
      actual_voters: number;
      null_votes: number;
    }[];

  const voterMap = new Map(voterRows.map((r) => [r.rik_id, r]));

  const voteRows = db
    .prepare(`
      SELECT
        l.rik_id,
        ep.party_id,
        ${BALLOT_NAME_SQL} AS party_name,
        p.color AS party_color,
        SUM(v.total) AS votes
      FROM votes v
      JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
      JOIN locations l ON l.id = s.location_id
      ${BALLOT_JOIN_SQL}
      WHERE v.election_id = ?
      GROUP BY l.rik_id, ep.party_id
    `)
    .all(id) as {
      rik_id: number;
      party_id: number;
      party_name: string;
      party_color: string | null;
      votes: number;
    }[];

  const rikVotes = new Map<number, Map<number, { votes: number; party_name: string; party_color: string | null }>>();
  for (const row of voteRows) {
    if (!rikVotes.has(row.rik_id)) {
      rikVotes.set(row.rik_id, new Map());
    }
    rikVotes.get(row.rik_id)!.set(row.party_id, {
      votes: row.votes,
      party_name: row.party_name,
      party_color: row.party_color,
    });
  }

  const riks = db
    .prepare("SELECT id, name, geo FROM riks WHERE geo IS NOT NULL ORDER BY id")
    .all() as { id: number; name: string; geo: string }[];

  const result = riks.map((rik) => {
    const voters = voterMap.get(rik.id);
    const partyMap = rikVotes.get(rik.id);

    const registered_voters = voters?.registered_voters ?? 0;
    const actual_voters = voters?.actual_voters ?? 0;
    const null_votes = voters?.null_votes ?? 0;
    const party_votes = partyMap
      ? Array.from(partyMap.values()).reduce((sum, p) => sum + p.votes, 0)
      : 0;
    const total_votes = party_votes + null_votes;

    const parties = partyMap
      ? Array.from(partyMap.entries())
          .map(([party_id, data]) => ({
            party_id,
            name: data.party_name,
            color: data.party_color ?? "#CCCCCC",
            votes: data.votes,
            pct: total_votes > 0 ? Math.round((data.votes / total_votes) * 10000) / 100 : 0,
          }))
          .sort((a, b) => b.votes - a.votes)
      : [];

    if (null_votes > 0) {
      parties.push({
        party_id: -1,
        name: "Не подкрепям никого",
        color: "#a0a0a0",
        votes: null_votes,
        pct: total_votes > 0 ? Math.round((null_votes / total_votes) * 10000) / 100 : 0,
      });
      parties.sort((a, b) => b.votes - a.votes);
    }

    const winner = parties.find((p) => p.party_id !== -1) ?? null;

    return {
      id: rik.id,
      name: rik.name,
      geo: JSON.parse(rik.geo),
      registered_voters,
      actual_voters,
      non_voters: registered_voters - actual_voters,
      total_votes,
      winner: winner
        ? { party_id: winner.party_id, name: winner.name, color: winner.color, votes: winner.votes, pct: winner.pct }
        : null,
      parties,
    };
  });

  return c.json({ election, riks: result });
});

elections.get("/:id/results/geo", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  // Validate numeric ID
  if (!/^\d+$/.test(id)) {
    return c.json({ error: "Election ID must be numeric" }, 400);
  }

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id) as { id: number; name: string; date: string; type: string } | undefined;

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  // Aggregate votes by municipality and party
  const voteRows = db
    .prepare(`
      SELECT
        l.municipality_id,
        ep.party_id,
        ${BALLOT_NAME_SQL} AS party_name,
        p.color AS party_color,
        SUM(v.total) AS votes
      FROM votes v
      JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
      JOIN locations l ON l.id = s.location_id
      ${BALLOT_JOIN_SQL}
      WHERE v.election_id = ?
      GROUP BY l.municipality_id, ep.party_id
    `)
    .all(id) as {
      municipality_id: number;
      party_id: number;
      party_name: string;
      party_color: string | null;
      votes: number;
    }[];

  // Build a map: municipality_id -> party_id -> { votes, party_name, party_color }
  const muniVotes = new Map<number, Map<number, { votes: number; party_name: string; party_color: string | null }>>();
  for (const row of voteRows) {
    if (!muniVotes.has(row.municipality_id)) {
      muniVotes.set(row.municipality_id, new Map());
    }
    muniVotes.get(row.municipality_id)!.set(row.party_id, {
      votes: row.votes,
      party_name: row.party_name,
      party_color: row.party_color,
    });
  }

  // Fetch all municipalities with non-null geo
  const municipalities = db
    .prepare("SELECT id, name, geo FROM municipalities WHERE geo IS NOT NULL ORDER BY id")
    .all() as { id: number; name: string; geo: string }[];

  const result = municipalities.map((muni) => {
    const partyMap = muniVotes.get(muni.id);

    if (!partyMap || partyMap.size === 0) {
      return {
        id: muni.id,
        name: muni.name,
        geo: JSON.parse(muni.geo),
        total_votes: 0,
        winner: null,
        parties: [],
      };
    }

    const total_votes = Array.from(partyMap.values()).reduce((sum, p) => sum + p.votes, 0);

    const parties = Array.from(partyMap.entries())
      .map(([party_id, data]) => ({
        party_id,
        name: data.party_name,
        color: data.party_color ?? "#CCCCCC",
        votes: data.votes,
        pct: total_votes > 0 ? Math.round((data.votes / total_votes) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.votes - a.votes);

    const winner = parties[0];

    return {
      id: muni.id,
      name: muni.name,
      geo: JSON.parse(muni.geo),
      total_votes,
      winner: {
        party_id: winner.party_id,
        name: winner.name,
        color: winner.color,
        votes: winner.votes,
        pct: winner.pct,
      },
      parties,
    };
  });

  return c.json({ election, municipalities: result });
});

export default elections;
