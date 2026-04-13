import type { Database as DatabaseType } from "better-sqlite3";

/** Lightweight queries for OG image data — no heavy joins, just what we need for the card. */

export interface OgElection {
  id: number;
  name: string;
  date: string;
  type: string;
  total_sections: number;
  flagged_sections: number;
}

export function getOgElection(
  db: DatabaseType,
  electionId: number,
): OgElection | null {
  return (
    (db
      .prepare(
        `SELECT e.id, e.name, e.date, e.type,
              (SELECT COUNT(*) FROM section_scores ss WHERE ss.election_id = e.id) AS total_sections,
              (SELECT COUNT(*) FROM section_scores ss WHERE ss.election_id = e.id AND ss.risk_score >= 0.3) AS flagged_sections
         FROM elections e WHERE e.id = ?`,
      )
      .get(electionId) as OgElection | undefined) ?? null
  );
}

export interface OgTopParty {
  name: string;
  color: string;
  votes: number;
  /** Percentage of registered voters (or votes cast when showNonVoters=false). */
  pct: number;
  /** Percentage of votes cast (only for parties, not non-voters/null). */
  votePct?: number;
}

const PARTY_THRESHOLD_PCT = 3.5;

/**
 * Parties as share of registered voters (includes non-voters and null votes).
 * Returns all parties above 3.5% threshold, plus "Не подкрепям никого" and "Негласували".
 */
export function getOgTopParties(
  db: DatabaseType,
  electionId: number,
  showNonVoters = true,
  /** Colors visible on the map — parties with these colors are included even if below threshold. */
  includeColors?: Set<string>,
): OgTopParty[] {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(p.registered_voters), 0) AS registered,
              COALESCE(SUM(p.actual_voters), 0) AS actual,
              COALESCE(SUM(p.null_votes), 0) AS null_votes
         FROM protocols p WHERE p.election_id = ?`,
    )
    .get(electionId) as { registered: number; actual: number; null_votes: number };

  // Denominator: registered voters (with non-voters) or total votes cast (without)
  const denom = showNonVoters ? (totals.registered || 1) : (totals.actual || 1);
  const voteDenom = totals.actual || 1;

  const allParties = db
    .prepare(
      `SELECT ep.name_on_ballot AS name,
              COALESCE(p.color, '#888888') AS color,
              SUM(v.total) AS votes,
              ROUND(100.0 * SUM(v.total) / ?, 1) AS pct
         FROM votes v
         JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
         JOIN parties p ON p.id = ep.party_id
        WHERE v.election_id = ?
        GROUP BY v.party_number
        ORDER BY votes DESC`,
    )
    .all(denom, electionId) as OgTopParty[];

  // Add votePct (% of votes cast) to each party
  for (const p of allParties) {
    p.votePct = Math.round((1000 * p.votes) / voteDenom) / 10;
  }

  const parties = allParties.filter((p) => {
    if (p.pct >= PARTY_THRESHOLD_PCT) return true;
    // Include if this party's color is visible on the map
    if (includeColors && includeColors.has(p.color.toLowerCase())) return true;
    return false;
  });

  // Null votes
  if (totals.null_votes > 0) {
    const pct = Math.round((1000 * totals.null_votes) / denom) / 10;
    if (pct >= 1) {
      parties.push({ name: "Не подкрепям никого", color: "#a3a3a3", votes: totals.null_votes, pct });
    }
  }

  // Non-voters (only when showNonVoters)
  if (showNonVoters) {
    const nonVoters = totals.registered - totals.actual;
    if (nonVoters > 0) {
      parties.push({ name: "Негласували", color: "#d4d4d4", votes: nonVoters, pct: Math.round((1000 * nonVoters) / denom) / 10 });
    }
  }

  parties.sort((a, b) => b.pct - a.pct);
  return parties;
}

export interface OgMunicipality {
  id: number;
  name: string;
  registered_voters: number;
  actual_voters: number;
}

export function getOgMunicipality(
  db: DatabaseType,
  municipalityId: number,
  electionId?: number,
): OgMunicipality | null {
  if (!electionId) {
    return (
      (db
        .prepare(`SELECT id, name, 0 AS registered_voters, 0 AS actual_voters FROM municipalities WHERE id = ?`)
        .get(municipalityId) as OgMunicipality | undefined) ?? null
    );
  }
  return (
    (db
      .prepare(
        `SELECT m.id, m.name,
                COALESCE(SUM(p.registered_voters), 0) AS registered_voters,
                COALESCE(SUM(p.actual_voters), 0) AS actual_voters
           FROM municipalities m
           JOIN locations l ON l.municipality_id = m.id
           JOIN sections s ON s.location_id = l.id AND s.election_id = ?
           LEFT JOIN protocols p ON p.election_id = s.election_id AND p.section_code = s.section_code
          WHERE m.id = ?
          GROUP BY m.id`,
      )
      .get(electionId, municipalityId) as OgMunicipality | undefined) ?? null
  );
}

/** Parties for a municipality, as share of registered voters, plus null votes and non-voters. */
export function getOgMunicipalityParties(
  db: DatabaseType,
  electionId: number,
  municipalityId: number,
  showNonVoters = true,
): OgTopParty[] {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(p.registered_voters), 0) AS registered,
              COALESCE(SUM(p.actual_voters), 0) AS actual,
              COALESCE(SUM(p.null_votes), 0) AS null_votes
         FROM protocols p
         JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
         JOIN locations l ON l.id = s.location_id
        WHERE p.election_id = ? AND l.municipality_id = ?`,
    )
    .get(electionId, municipalityId) as { registered: number; actual: number; null_votes: number };

  const denom = showNonVoters ? (totals.registered || 1) : (totals.actual || 1);
  const voteDenom = totals.actual || 1;

  const allParties = db
    .prepare(
      `SELECT ep.name_on_ballot AS name,
              COALESCE(pa.color, '#888888') AS color,
              SUM(v.total) AS votes,
              ROUND(100.0 * SUM(v.total) / ?, 1) AS pct
         FROM votes v
         JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
         JOIN locations l ON l.id = s.location_id
         JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
         JOIN parties pa ON pa.id = ep.party_id
        WHERE v.election_id = ? AND l.municipality_id = ?
        GROUP BY v.party_number
        ORDER BY votes DESC`,
    )
    .all(denom, electionId, municipalityId) as OgTopParty[];

  for (const p of allParties) {
    p.votePct = Math.round((1000 * p.votes) / voteDenom) / 10;
  }

  const parties = allParties.filter((p) => p.pct >= PARTY_THRESHOLD_PCT);

  if (totals.null_votes > 0) {
    const pct = Math.round((1000 * totals.null_votes) / denom) / 10;
    if (pct >= 1) {
      parties.push({ name: "Не подкрепям никого", color: "#a3a3a3", votes: totals.null_votes, pct });
    }
  }

  if (showNonVoters) {
    const nonVoters = totals.registered - totals.actual;
    if (nonVoters > 0) {
      parties.push({ name: "Негласували", color: "#d4d4d4", votes: nonVoters, pct: Math.round((1000 * nonVoters) / denom) / 10 });
    }
  }

  parties.sort((a, b) => b.pct - a.pct);
  return parties;
}

export interface OgSectionDetail {
  section_code: string;
  settlement_name: string | null;
  address: string | null;
  elections_present: number;
  elections_flagged: number;
  avg_risk: number;
  max_risk: number;
  total_violations: number;
}

export function getOgSectionDetail(
  db: DatabaseType,
  sectionCode: string,
): OgSectionDetail | null {
  return (
    (db
      .prepare(
        `SELECT ss.section_code,
              COALESCE(s.settlement_name, l.settlement_name) AS settlement_name,
              COALESCE(s.address, l.address) AS address,
              COUNT(*) AS elections_present,
              SUM(CASE WHEN ss.risk_score >= 0.3 THEN 1 ELSE 0 END) AS elections_flagged,
              ROUND(AVG(ss.risk_score), 3) AS avg_risk,
              ROUND(MAX(ss.risk_score), 3) AS max_risk,
              SUM(ss.protocol_violation_count) AS total_violations
         FROM section_scores ss
         JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
         JOIN locations l ON l.id = s.location_id
        WHERE ss.section_code = ?
        GROUP BY ss.section_code`,
      )
      .get(sectionCode) as OgSectionDetail | undefined) ?? null
  );
}

export interface OgSectionHistoryElection {
  election_id: number;
  election_name: string;
  election_date: string;
  risk_score: number;
  turnout_rate: number;
  registered_voters: number;
  actual_voters: number;
  added_voters: number;
  protocol_violation_count: number;
  parties: { name: string; color: string; pct: number }[];
}

export function getOgSectionHistory(
  db: DatabaseType,
  sectionCode: string,
): OgSectionHistoryElection[] {
  const rows = db
    .prepare(
      `SELECT ss.election_id,
              e.name AS election_name,
              e.date AS election_date,
              ss.risk_score,
              ss.turnout_rate,
              COALESCE(p.registered_voters, 0) AS registered_voters,
              COALESCE(p.actual_voters, 0) AS actual_voters,
              COALESCE(p.added_voters, 0) AS added_voters,
              ss.protocol_violation_count
         FROM section_scores ss
         JOIN elections e ON e.id = ss.election_id
         LEFT JOIN protocols p ON p.election_id = ss.election_id AND p.section_code = ss.section_code
        WHERE ss.section_code = ?
        ORDER BY e.date DESC`,
    )
    .all(sectionCode) as Omit<OgSectionHistoryElection, "parties">[];

  return rows.map((r) => {
    const totalVotes = db
      .prepare(`SELECT SUM(total) AS t FROM votes WHERE election_id = ? AND section_code = ?`)
      .get(r.election_id, sectionCode) as { t: number };
    const denom = totalVotes.t || 1;

    const parties = db
      .prepare(
        `SELECT COALESCE(ep.name_on_ballot, pa.short_name, pa.canonical_name) AS name,
                COALESCE(pa.color, '#888888') AS color,
                ROUND(100.0 * v.total / ?, 0) AS pct
           FROM votes v
           JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
           JOIN parties pa ON pa.id = ep.party_id
          WHERE v.election_id = ? AND v.section_code = ? AND v.total > 0
          ORDER BY v.total DESC
          LIMIT 6`,
      )
      .all(denom, r.election_id, sectionCode) as { name: string; color: string; pct: number }[];

    return { ...r, parties };
  });
}

// ---------- Per-election section detail (for /:electionId/sections or /table shares) ----------

export interface OgSectionElection {
  section_code: string;
  settlement_name: string | null;
  address: string | null;
  registered_voters: number;
  actual_voters: number;
  turnout_pct: number;
  invalid_votes: number;
  null_votes: number;
  risk_score: number;
  protocol_violation_count: number;
  parties: OgTopParty[];
}

export function getOgSectionElection(
  db: DatabaseType,
  electionId: number,
  sectionCode: string,
): OgSectionElection | null {
  const row = db
    .prepare(
      `SELECT ss.section_code,
              COALESCE(s.settlement_name, l.settlement_name) AS settlement_name,
              COALESCE(s.address, l.address) AS address,
              p.registered_voters,
              p.actual_voters,
              ROUND(100.0 * p.actual_voters / NULLIF(p.registered_voters, 0), 1) AS turnout_pct,
              p.invalid_votes,
              p.null_votes,
              ss.risk_score,
              ss.protocol_violation_count
         FROM section_scores ss
         JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
         JOIN locations l ON l.id = s.location_id
         LEFT JOIN protocols p ON p.election_id = ss.election_id AND p.section_code = ss.section_code
        WHERE ss.election_id = ? AND ss.section_code = ?`,
    )
    .get(electionId, sectionCode) as Omit<OgSectionElection, "parties"> | undefined;

  if (!row) return null;

  const validVotes = db
    .prepare(
      `SELECT SUM(v.total) AS total FROM votes v WHERE v.election_id = ? AND v.section_code = ?`,
    )
    .get(electionId, sectionCode) as { total: number };

  const denom = validVotes.total || 1;

  const parties = db
    .prepare(
      `SELECT COALESCE(ep.name_on_ballot, pa.short_name, pa.canonical_name) AS name,
              COALESCE(pa.color, '#888888') AS color,
              v.total AS votes,
              ROUND(100.0 * v.total / ?, 1) AS pct
         FROM votes v
         JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
         JOIN parties pa ON pa.id = ep.party_id
        WHERE v.election_id = ? AND v.section_code = ? AND v.total > 0
        ORDER BY v.total DESC`,
    )
    .all(denom, electionId, sectionCode) as OgTopParty[];

  return { ...row, parties };
}

export interface OgDistrict {
  id: number;
  name: string;
  municipality_count: number;
  section_count: number;
}

export function getOgDistrict(
  db: DatabaseType,
  districtId: number,
): OgDistrict | null {
  return (
    (db
      .prepare(
        `SELECT d.id, d.name,
              (SELECT COUNT(DISTINCT l.municipality_id) FROM locations l WHERE l.district_id = d.id) AS municipality_count,
              (SELECT COUNT(DISTINCT s.section_code) FROM sections s JOIN locations l ON l.id = s.location_id WHERE l.district_id = d.id) AS section_count
         FROM districts d WHERE d.id = ?`,
      )
      .get(districtId) as OgDistrict | undefined) ?? null
  );
}

export interface OgPersistenceSummary {
  total_persistent: number;
  total_sections: number;
}

export function getOgPersistenceSummary(
  db: DatabaseType,
): OgPersistenceSummary {
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(DISTINCT section_code) FROM section_scores) AS total_sections,
        (SELECT COUNT(*) FROM (
          SELECT section_code
          FROM section_scores
          GROUP BY section_code
          HAVING SUM(CASE WHEN risk_score >= 0.3 THEN 1 ELSE 0 END) >= 2
        )) AS total_persistent`,
    )
    .get() as OgPersistenceSummary;
  return row;
}
