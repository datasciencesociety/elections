import type { Database as DatabaseType } from "better-sqlite3";
import { BALLOT_JOIN_SQL, BALLOT_NAME_SQL } from "../db/ballot.js";

/**
 * Per-area aggregated election results, with the GeoJSON geometry attached.
 *
 * One function — `getGeoResults(db, electionId, level)` — handles districts,
 * municipalities, and RIKs. The three were previously copy-pasted as
 * separate handlers; the only difference is which join column + table we
 * use, which is captured in `LEVEL_CONFIG`.
 *
 * Districts also include population-weighted centroids for label placement.
 */

export const GEO_RESULT_LEVELS = ["district", "municipality", "rik"] as const;
export type GeoResultLevel = (typeof GEO_RESULT_LEVELS)[number];

interface LevelConfig {
  /** Foreign key column on `locations` */
  locationColumn: "district_id" | "municipality_id" | "rik_id";
  /** Reference table holding name + geo */
  table: "districts" | "municipalities" | "riks";
  /** Whether this level should also return weighted centroids */
  withCentroid: boolean;
}

const LEVEL_CONFIG: Record<GeoResultLevel, LevelConfig> = {
  district: { locationColumn: "district_id", table: "districts", withCentroid: true },
  municipality: { locationColumn: "municipality_id", table: "municipalities", withCentroid: false },
  rik: { locationColumn: "rik_id", table: "riks", withCentroid: false },
};

export interface GeoArea {
  id: number;
  name: string;
  geo: unknown;
  centroid: { lat: number; lng: number } | null;
  registered_voters: number;
  actual_voters: number;
  non_voters: number;
  total_votes: number;
  winner: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
    pct: number;
  } | null;
  parties: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
    pct: number;
  }[];
}

const NULL_VOTES_LABEL = "Не подкрепям никого";
const NULL_VOTES_COLOR = "#a0a0a0";

export function getGeoResults(
  db: DatabaseType,
  electionId: number | string,
  level: GeoResultLevel,
): GeoArea[] {
  const cfg = LEVEL_CONFIG[level];

  // Voter totals per area
  const voterRows = db
    .prepare(
      `SELECT
         l.${cfg.locationColumn} AS area_id,
         SUM(p.registered_voters) AS registered_voters,
         SUM(p.actual_voters) AS actual_voters,
         SUM(p.null_votes) AS null_votes
       FROM protocols p
       JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
       JOIN locations l ON l.id = s.location_id
       WHERE p.election_id = ?
       GROUP BY l.${cfg.locationColumn}`,
    )
    .all(electionId) as {
    area_id: number;
    registered_voters: number;
    actual_voters: number;
    null_votes: number;
  }[];
  const voterMap = new Map(voterRows.map((r) => [r.area_id, r]));

  // Optional: weighted centroid (currently districts only)
  const centroidMap = cfg.withCentroid
    ? new Map(
        (
          db
            .prepare(
              `SELECT
                 l.${cfg.locationColumn} AS area_id,
                 SUM(p.registered_voters * COALESCE(s.lat, l.lat)) / SUM(p.registered_voters) AS weighted_lat,
                 SUM(p.registered_voters * COALESCE(s.lng, l.lng)) / SUM(p.registered_voters) AS weighted_lng
               FROM protocols p
               JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
               JOIN locations l ON l.id = s.location_id
               WHERE p.election_id = ? AND COALESCE(s.lat, l.lat) IS NOT NULL AND COALESCE(s.lng, l.lng) IS NOT NULL AND p.registered_voters > 0
               GROUP BY l.${cfg.locationColumn}`,
            )
            .all(electionId) as {
            area_id: number;
            weighted_lat: number;
            weighted_lng: number;
          }[]
        ).map((r) => [r.area_id, r]),
      )
    : null;

  // Votes by area + party
  const voteRows = db
    .prepare(
      `SELECT
         l.${cfg.locationColumn} AS area_id,
         ep.party_id,
         ${BALLOT_NAME_SQL} AS party_name,
         p.color AS party_color,
         SUM(v.total) AS votes
       FROM votes v
       JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
       JOIN locations l ON l.id = s.location_id
       ${BALLOT_JOIN_SQL}
       WHERE v.election_id = ?
       GROUP BY l.${cfg.locationColumn}, ep.party_id`,
    )
    .all(electionId) as {
    area_id: number;
    party_id: number;
    party_name: string;
    party_color: string | null;
    votes: number;
  }[];

  const areaPartyMap = new Map<
    number,
    Map<number, { votes: number; party_name: string; party_color: string | null }>
  >();
  for (const row of voteRows) {
    let inner = areaPartyMap.get(row.area_id);
    if (!inner) {
      inner = new Map();
      areaPartyMap.set(row.area_id, inner);
    }
    inner.set(row.party_id, {
      votes: row.votes,
      party_name: row.party_name,
      party_color: row.party_color,
    });
  }

  // Reference areas (with non-null geo)
  const areas = db
    .prepare(
      `SELECT id, name, geo FROM ${cfg.table} WHERE geo IS NOT NULL ORDER BY id`,
    )
    .all() as { id: number; name: string; geo: string }[];

  return areas.map((area) => buildGeoArea(area, voterMap, centroidMap, areaPartyMap));
}

// ---------- legacy /results/geo (municipality, lean shape) ----------

/**
 * Lean municipality results — no voter totals, no null-vote pseudo-party.
 *
 * Powers the legacy `/elections/:id/results/geo` endpoint, which is the
 * smallest payload used by the proportional district pie map. Empty
 * municipalities return `{total_votes: 0, winner: null, parties: []}`
 * (no synthetic entries).
 */

export interface GeoMunicipalityLean {
  id: number;
  name: string;
  geo: unknown;
  total_votes: number;
  winner: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
    pct: number;
  } | null;
  parties: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
    pct: number;
  }[];
}

export function getGeoResultsLean(
  db: DatabaseType,
  electionId: number | string,
): GeoMunicipalityLean[] {
  const voteRows = db
    .prepare(
      `SELECT
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
       GROUP BY l.municipality_id, ep.party_id`,
    )
    .all(electionId) as {
    municipality_id: number;
    party_id: number;
    party_name: string;
    party_color: string | null;
    votes: number;
  }[];

  const muniVotes = new Map<
    number,
    Map<
      number,
      { votes: number; party_name: string; party_color: string | null }
    >
  >();
  for (const row of voteRows) {
    let inner = muniVotes.get(row.municipality_id);
    if (!inner) {
      inner = new Map();
      muniVotes.set(row.municipality_id, inner);
    }
    inner.set(row.party_id, {
      votes: row.votes,
      party_name: row.party_name,
      party_color: row.party_color,
    });
  }

  const municipalities = db
    .prepare(
      "SELECT id, name, geo FROM municipalities WHERE geo IS NOT NULL ORDER BY id",
    )
    .all() as { id: number; name: string; geo: string }[];

  return municipalities.map((muni) => {
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

    const total_votes = Array.from(partyMap.values()).reduce(
      (sum, p) => sum + p.votes,
      0,
    );

    const parties = Array.from(partyMap.entries())
      .map(([party_id, data]) => ({
        party_id,
        name: data.party_name,
        color: data.party_color ?? "#CCCCCC",
        votes: data.votes,
        pct:
          total_votes > 0
            ? Math.round((data.votes / total_votes) * 10000) / 100
            : 0,
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
}

function buildGeoArea(
  area: { id: number; name: string; geo: string },
  voterMap: Map<
    number,
    {
      registered_voters: number;
      actual_voters: number;
      null_votes: number;
    }
  >,
  centroidMap: Map<
    number,
    { weighted_lat: number; weighted_lng: number }
  > | null,
  areaPartyMap: Map<
    number,
    Map<number, { votes: number; party_name: string; party_color: string | null }>
  >,
): GeoArea {
  const voters = voterMap.get(area.id);
  const partyMap = areaPartyMap.get(area.id);
  const centroid = centroidMap?.get(area.id) ?? null;

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
          pct:
            total_votes > 0
              ? Math.round((data.votes / total_votes) * 10000) / 100
              : 0,
        }))
        .sort((a, b) => b.votes - a.votes)
    : [];

  if (null_votes > 0) {
    parties.push({
      party_id: -1,
      name: NULL_VOTES_LABEL,
      color: NULL_VOTES_COLOR,
      votes: null_votes,
      pct:
        total_votes > 0
          ? Math.round((null_votes / total_votes) * 10000) / 100
          : 0,
    });
    parties.sort((a, b) => b.votes - a.votes);
  }

  const winner = parties.find((p) => p.party_id !== -1) ?? null;

  return {
    id: area.id,
    name: area.name,
    geo: JSON.parse(area.geo),
    centroid: centroid
      ? {
          lat: Math.round(centroid.weighted_lat * 1e6) / 1e6,
          lng: Math.round(centroid.weighted_lng * 1e6) / 1e6,
        }
      : null,
    registered_voters,
    actual_voters,
    non_voters: registered_voters - actual_voters,
    total_votes,
    winner: winner
      ? {
          party_id: winner.party_id,
          name: winner.name,
          color: winner.color,
          votes: winner.votes,
          pct: winner.pct,
        }
      : null,
    parties,
  };
}
