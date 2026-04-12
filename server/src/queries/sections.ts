import type { Database as DatabaseType } from "better-sqlite3";
import {
  BALLOT_JOIN_SQL,
  BALLOT_NAME_SQL,
  MAYOR_BALLOT_NAME_SQL,
  MAYOR_CANDIDATE_JOIN_SQL,
  getSectionBallot,
  isMayorCandidateType,
} from "../db/ballot.js";

/**
 * Section-level queries: per-section ballot detail with peer context for the
 * sidebar drill-down, and the per-section "geo" map data (top-5 parties +
 * coordinates).
 */

// ---------- /elections/:id/sections/:code ----------

export interface SectionProtocol {
  registered_voters: number;
  actual_voters: number;
  received_ballots: number;
  added_voters: number;
  invalid_votes: number;
  null_votes: number;
  machine_count: number;
  valid_votes: number;
}

export interface SectionParty {
  name: string;
  short_name: string;
  color: string | null;
  votes: number;
  paper: number;
  machine: number;
  pct: number;
}

export interface SectionContext {
  municipality_name: string | null;
  rik_avg_turnout: number | null;
  ekatte_avg_turnout: number | null;
  ekatte_peer_count: number | null;
  municipality_avg_turnout: number | null;
  municipality_turnout_q3: number | null;
  prev_election: { id: number; name: string; date: string } | null;
  prev_turnout: number | null;
}

export interface SectionDetail {
  protocol: SectionProtocol;
  parties: SectionParty[];
  context: SectionContext;
}

interface LocInfoRow {
  ekatte: string;
  settlement_name: string;
  municipality_id: number;
  rik_code: string;
  municipality_name: string | null;
}

export function getSectionDetail(
  db: DatabaseType,
  electionId: number | string,
  electionType: string,
  electionDate: string,
  sectionCode: string,
): SectionDetail | null {
  const protocol = db
    .prepare(
      `SELECT p.registered_voters, p.actual_voters, p.received_ballots,
              p.added_voters, p.invalid_votes, p.null_votes,
              s.machine_count
         FROM protocols p
         JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
         WHERE p.election_id = ? AND p.section_code = ?`,
    )
    .get(electionId, sectionCode) as
    | Omit<SectionProtocol, "valid_votes">
    | undefined;

  if (!protocol) return null;

  const ballotRows = getSectionBallot(db, electionId, sectionCode, electionType);
  const partyRows = ballotRows.map((r) => ({
    name: r.party_name,
    short_name: r.party_short_name,
    color: r.party_color,
    votes: r.votes,
    paper: r.paper,
    machine: r.machine,
  }));
  const validVotes = partyRows.reduce((sum, p) => sum + p.votes, 0);
  const parties: SectionParty[] = partyRows.map((p) => ({
    ...p,
    pct: validVotes > 0 ? (p.votes / validVotes) * 100 : 0,
  }));

  const locInfo = db
    .prepare(
      `SELECT l.ekatte, l.settlement_name, l.municipality_id, s.rik_code,
              m.name as municipality_name
         FROM sections s
         JOIN locations l ON l.id = s.location_id
         LEFT JOIN municipalities m ON m.id = l.municipality_id
         WHERE s.election_id = ? AND s.section_code = ?`,
    )
    .get(electionId, sectionCode) as LocInfoRow | undefined;

  const rikAvg = locInfo
    ? (db
        .prepare(
          `SELECT AVG(ss.turnout_rate) as avg_turnout
             FROM section_scores ss
             JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
             WHERE ss.election_id = ? AND s.rik_code = ? AND ss.section_type = 'normal'`,
        )
        .get(electionId, locInfo.rik_code) as
        | { avg_turnout: number }
        | undefined)
    : undefined;

  const ekatteAvg = locInfo
    ? (db
        .prepare(
          `SELECT AVG(ss.turnout_rate) as avg_turnout, COUNT(*) as peer_count
             FROM section_scores ss
             JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
             JOIN locations l ON l.id = s.location_id
             WHERE ss.election_id = ? AND l.ekatte = ? AND ss.section_type = 'normal'`,
        )
        .get(electionId, locInfo.ekatte) as
        | { avg_turnout: number; peer_count: number }
        | undefined)
    : undefined;

  const muniAvg = locInfo
    ? (db
        .prepare(
          `SELECT AVG(ss.turnout_rate) as avg_turnout
             FROM section_scores ss
             JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
             JOIN locations l ON l.id = s.location_id
             WHERE ss.election_id = ? AND l.municipality_id = ? AND ss.section_type = 'normal'`,
        )
        .get(electionId, locInfo.municipality_id) as
        | { avg_turnout: number }
        | undefined)
    : undefined;

  const muniOutlierThresholds = locInfo
    ? (db
        .prepare(
          `SELECT
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
             ) as turnout_q3`,
        )
        .get(
          electionId,
          locInfo.municipality_id,
          electionId,
          locInfo.municipality_id,
        ) as { turnout_q3: number } | undefined)
    : undefined;

  let prevElection:
    | { id: number; name: string; date: string }
    | null = null;
  let prevTurnout: number | null = null;

  const prevRow = db
    .prepare(
      `SELECT id, name, date FROM elections
        WHERE type = ? AND date < ? ORDER BY date DESC LIMIT 1`,
    )
    .get(electionType, electionDate) as
    | { id: number; name: string; date: string }
    | undefined;
  if (prevRow) {
    prevElection = prevRow;
    const prev = db
      .prepare(
        `SELECT ss.turnout_rate FROM section_scores ss
          WHERE ss.election_id = ? AND ss.section_code = ?`,
      )
      .get(prevRow.id, sectionCode) as { turnout_rate: number } | undefined;
    prevTurnout = prev?.turnout_rate ?? null;
  }

  return {
    protocol: { ...protocol, valid_votes: validVotes },
    parties,
    context: {
      municipality_name: locInfo?.municipality_name ?? null,
      rik_avg_turnout: rikAvg?.avg_turnout ?? null,
      ekatte_avg_turnout: ekatteAvg?.avg_turnout ?? null,
      ekatte_peer_count: ekatteAvg?.peer_count ?? null,
      municipality_avg_turnout: muniAvg?.avg_turnout ?? null,
      municipality_turnout_q3: muniOutlierThresholds?.turnout_q3 ?? null,
      prev_election: prevElection,
      prev_turnout: prevTurnout,
    },
  };
}

// ---------- /elections/:id/sections/geo ----------

export interface SectionGeoEntry {
  section_code: string;
  section_type: string;
  lat: number;
  lng: number;
  settlement_name: string;
  registered_voters: number;
  actual_voters: number;
  winner_party: string | null;
  winner_color: string;
  winner_pct: number;
  parties: { name: string; color: string; votes: number; pct: number }[];
}

export function getSectionsGeo(
  db: DatabaseType,
  electionId: number | string,
  geoFilter: { column: string; value: string } | null,
): SectionGeoEntry[] {
  const filterClause = geoFilter ? ` AND ${geoFilter.column} = ?` : "";
  const sectionParams: unknown[] = geoFilter
    ? [electionId, geoFilter.value]
    : [electionId];

  const electionType = (
    db
      .prepare("SELECT type FROM elections WHERE id = ?")
      .get(electionId) as { type: string } | undefined
  )?.type;
  const useCandidate = isMayorCandidateType(electionType);

  const sectionRows = db
    .prepare(
      `SELECT s.section_code, l.settlement_name,
              COALESCE(s.lat, l.lat) AS lat,
              COALESCE(s.lng, l.lng) AS lng,
              p.registered_voters, p.actual_voters,
              COALESCE(ss.section_type, 'normal') AS section_type
         FROM sections s
         JOIN locations l ON l.id = s.location_id
         JOIN protocols p ON p.election_id = s.election_id AND p.section_code = s.section_code
         LEFT JOIN section_scores ss
           ON ss.election_id = s.election_id AND ss.section_code = s.section_code
        WHERE s.election_id = ?${filterClause}`,
    )
    .all(...sectionParams) as {
    section_code: string;
    settlement_name: string;
    lat: number | null;
    lng: number | null;
    registered_voters: number;
    actual_voters: number;
    section_type: string;
  }[];

  const nameSql = useCandidate ? MAYOR_BALLOT_NAME_SQL : BALLOT_NAME_SQL;
  const candidateJoin = useCandidate ? MAYOR_CANDIDATE_JOIN_SQL : "";

  const partyRows = db
    .prepare(
      `SELECT section_code, party_name, color, votes, pct FROM (
         SELECT v.section_code, ${nameSql} AS party_name, p.color,
                v.total AS votes,
                ROUND(v.total * 100.0 / NULLIF(SUM(v.total) OVER (PARTITION BY v.section_code), 0), 1) AS pct,
                ROW_NUMBER() OVER (PARTITION BY v.section_code ORDER BY v.total DESC) AS rn
           FROM votes v
           JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
           JOIN locations l ON l.id = s.location_id
           ${BALLOT_JOIN_SQL}
           ${candidateJoin}
          WHERE v.election_id = ?${filterClause}
       ) ranked WHERE rn <= 5`,
    )
    .all(...sectionParams) as {
    section_code: string;
    party_name: string;
    color: string;
    votes: number;
    pct: number;
  }[];

  const partyMap = new Map<
    string,
    { name: string; color: string; votes: number; pct: number }[]
  >();
  for (const row of partyRows) {
    let arr = partyMap.get(row.section_code);
    if (!arr) {
      arr = [];
      partyMap.set(row.section_code, arr);
    }
    arr.push({
      name: row.party_name,
      color: row.color,
      votes: row.votes,
      pct: row.pct,
    });
  }

  return sectionRows
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => {
      const parties = partyMap.get(s.section_code) ?? [];
      const winner = parties[0] ?? null;
      return {
        section_code: s.section_code,
        section_type: s.section_type,
        lat: s.lat as number,
        lng: s.lng as number,
        settlement_name: s.settlement_name,
        registered_voters: s.registered_voters,
        actual_voters: s.actual_voters,
        winner_party: winner?.name ?? null,
        winner_color: winner?.color ?? "#999",
        winner_pct: winner?.pct ?? 0,
        parties,
      };
    });
}

// ---------- settlement peers (EKATTE) ----------

export interface SettlementPeer {
  section_code: string;
  turnout_rate: number;
  risk_score: number;
}

export interface SettlementPeersResult {
  settlement_name: string;
  peer_count: number;
  avg_turnout: number;
  peers: SettlementPeer[];
}

export function getSettlementPeers(
  db: DatabaseType,
  sectionCode: string,
): SettlementPeersResult | null {
  const locRow = db
    .prepare(
      `SELECT l.ekatte, l.settlement_name, e.id AS election_id
       FROM sections s
       JOIN locations l ON l.id = s.location_id
       JOIN elections e ON e.id = s.election_id
       WHERE s.section_code = ?
       ORDER BY e.date DESC
       LIMIT 1`,
    )
    .get(sectionCode) as
    | { ekatte: string; settlement_name: string; election_id: number }
    | undefined;

  if (!locRow || !locRow.ekatte) return null;

  const peers = db
    .prepare(
      `SELECT ss.section_code, ss.turnout_rate, ss.risk_score
       FROM section_scores ss
       JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
       JOIN locations l ON l.id = s.location_id
       WHERE ss.election_id = ? AND l.ekatte = ? AND ss.section_type = 'normal'
       ORDER BY ss.turnout_rate`,
    )
    .all(locRow.election_id, locRow.ekatte) as SettlementPeer[];

  const avgTurnout =
    peers.length > 0
      ? peers.reduce((s, p) => s + p.turnout_rate, 0) / peers.length
      : 0;

  return {
    settlement_name: locRow.settlement_name,
    peer_count: peers.length,
    avg_turnout: avgTurnout,
    peers,
  };
}
