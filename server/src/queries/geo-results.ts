import type { Database as DatabaseType } from "better-sqlite3";
import {
  BALLOT_JOIN_SQL,
  BALLOT_NAME_SQL,
  MAYOR_BALLOT_NAME_SQL,
  MAYOR_CANDIDATE_JOIN_SQL,
  isMayorCandidateType,
} from "../db/ballot.js";
import { BG_COUNTRY_TO_ISO2, ISO2_TO_BG_NAME } from "../lib/country-iso.js";

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

  // Mayor-type elections at the municipality level have one candidate per
  // (municipality, ballot). Joining candidates lets the panel show real names
  // instead of party labels. At higher levels (district / rik) the same ballot
  // number maps to different candidates per municipality, so the join would
  // produce nonsense and we keep the party label.
  const electionType = (
    db
      .prepare("SELECT type FROM elections WHERE id = ?")
      .get(electionId) as { type: string } | undefined
  )?.type;
  const useCandidate =
    level === "municipality" && isMayorCandidateType(electionType);
  const nameSql = useCandidate ? MAYOR_BALLOT_NAME_SQL : BALLOT_NAME_SQL;
  const candidateJoin = useCandidate ? MAYOR_CANDIDATE_JOIN_SQL : "";

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
         ${nameSql} AS party_name,
         p.color AS party_color,
         SUM(v.total) AS votes
       FROM votes v
       JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
       JOIN locations l ON l.id = s.location_id
       ${BALLOT_JOIN_SQL}
       ${candidateJoin}
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

  return areas.map((area) =>
    buildGeoArea(area, voterMap, centroidMap, areaPartyMap),
  );
}

// ---------- abroad, split by country ----------

/**
 * Per-country roll-up of abroad sections. The main /results map shows
 * Bulgaria. This feeds a small world-map inset that colours each country
 * with the same tile-density renderer, so the diaspora vote is visible
 * as a second surface rather than as a synthetic circle glued to the
 * Bulgaria map.
 *
 * Country names come from the prefix of `locations.settlement_name`
 * ("Норвегия, Осло" → "Норвегия") and are mapped to ISO-3166-1 alpha-2
 * via BG_COUNTRY_TO_ISO2. Historical aliases ("Германия ФР" / "ФР
 * Германия", "Великобритания" / "Обединено кралство ...") collapse
 * into one entry per ISO-2. The frontend joins by iso2 against a
 * shipped world-countries GeoJSON.
 */
export interface AbroadCountryResult {
  iso2: string;
  name: string;
  registered_voters: number;
  actual_voters: number;
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

const COUNTRY_PREFIX_SQL = `
  CASE
    WHEN INSTR(COALESCE(s.settlement_name, l.settlement_name), ',') > 0
      THEN TRIM(SUBSTR(COALESCE(s.settlement_name, l.settlement_name), 1, INSTR(COALESCE(s.settlement_name, l.settlement_name), ',') - 1))
    ELSE COALESCE(s.settlement_name, l.settlement_name)
  END`;

export function getAbroadByCountry(
  db: DatabaseType,
  electionId: number | string,
): AbroadCountryResult[] {
  const voterRows = db
    .prepare(
      `SELECT
         ${COUNTRY_PREFIX_SQL} AS country,
         SUM(p.registered_voters) AS registered_voters,
         SUM(p.actual_voters)     AS actual_voters,
         SUM(p.null_votes)        AS null_votes
       FROM protocols p
       JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
       JOIN locations l ON l.id = s.location_id
       WHERE p.election_id = ? AND l.district_id IS NULL
       GROUP BY country`,
    )
    .all(electionId) as {
    country: string;
    registered_voters: number | null;
    actual_voters: number | null;
    null_votes: number | null;
  }[];

  const voteRows = db
    .prepare(
      `SELECT
         ${COUNTRY_PREFIX_SQL} AS country,
         ep.party_id,
         ${BALLOT_NAME_SQL} AS party_name,
         p.color            AS party_color,
         SUM(v.total)       AS votes
       FROM votes v
       JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
       JOIN locations l ON l.id = s.location_id
       ${BALLOT_JOIN_SQL}
       WHERE v.election_id = ? AND l.district_id IS NULL
       GROUP BY country, ep.party_id`,
    )
    .all(electionId) as {
    country: string;
    party_id: number;
    party_name: string;
    party_color: string | null;
    votes: number;
  }[];

  // Merge aliases into one bucket per ISO-2.
  interface Bucket {
    registered: number;
    actual: number;
    null_votes: number;
    parties: Map<
      number,
      { name: string; color: string; votes: number }
    >;
  }
  const byIso = new Map<string, Bucket>();
  const getBucket = (iso: string): Bucket => {
    let b = byIso.get(iso);
    if (!b) {
      b = { registered: 0, actual: 0, null_votes: 0, parties: new Map() };
      byIso.set(iso, b);
    }
    return b;
  };

  for (const row of voterRows) {
    const iso = BG_COUNTRY_TO_ISO2[row.country];
    if (!iso) continue;
    const b = getBucket(iso);
    b.registered += row.registered_voters ?? 0;
    b.actual += row.actual_voters ?? 0;
    b.null_votes += row.null_votes ?? 0;
  }

  for (const row of voteRows) {
    const iso = BG_COUNTRY_TO_ISO2[row.country];
    if (!iso) continue;
    const b = getBucket(iso);
    const existing = b.parties.get(row.party_id);
    if (existing) {
      existing.votes += row.votes;
    } else {
      b.parties.set(row.party_id, {
        name: row.party_name,
        color: row.party_color ?? "#CCCCCC",
        votes: row.votes,
      });
    }
  }

  const result: AbroadCountryResult[] = [];
  for (const [iso2, b] of byIso) {
    if (b.actual === 0) continue;
    // Same quirk as the old whole-abroad aggregate: pre-registration
    // undercounts walk-in voters abroad, so use actual as the
    // effective denominator. There's no meaningful "non-voter" pool.
    const actual_voters = b.actual;
    const registered_voters = actual_voters;
    const party_votes = Array.from(b.parties.values()).reduce(
      (s, p) => s + p.votes,
      0,
    );
    const total_votes = party_votes + b.null_votes;

    const parties = Array.from(b.parties.entries())
      .map(([party_id, data]) => ({
        party_id,
        name: data.name,
        color: data.color,
        votes: data.votes,
        pct:
          total_votes > 0
            ? Math.round((data.votes / total_votes) * 10000) / 100
            : 0,
      }))
      .sort((a, b) => b.votes - a.votes);

    if (b.null_votes > 0) {
      parties.push({
        party_id: -1,
        name: NULL_VOTES_LABEL,
        color: NULL_VOTES_COLOR,
        votes: b.null_votes,
        pct:
          total_votes > 0
            ? Math.round((b.null_votes / total_votes) * 10000) / 100
            : 0,
      });
      parties.sort((a, b) => b.votes - a.votes);
    }

    const winner = parties.find((p) => p.party_id !== -1) ?? null;

    result.push({
      iso2,
      name: ISO2_TO_BG_NAME[iso2] ?? iso2,
      registered_voters,
      actual_voters,
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
    });
  }

  result.sort((a, b) => b.actual_voters - a.actual_voters);
  return result;
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
  // Mayor-type local elections have one candidate per (municipality, ballot),
  // so the per-municipality aggregate can show real names.
  const electionType = (
    db
      .prepare("SELECT type FROM elections WHERE id = ?")
      .get(electionId) as { type: string } | undefined
  )?.type;
  const useCandidate = isMayorCandidateType(electionType);
  const nameSql = useCandidate ? MAYOR_BALLOT_NAME_SQL : BALLOT_NAME_SQL;
  const candidateJoin = useCandidate ? MAYOR_CANDIDATE_JOIN_SQL : "";

  const voteRows = db
    .prepare(
      `SELECT
         l.municipality_id,
         ep.party_id,
         ${nameSql} AS party_name,
         p.color AS party_color,
         SUM(v.total) AS votes
       FROM votes v
       JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
       JOIN locations l ON l.id = s.location_id
       ${BALLOT_JOIN_SQL}
       ${candidateJoin}
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
