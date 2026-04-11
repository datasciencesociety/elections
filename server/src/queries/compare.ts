import type { Database as DatabaseType } from "better-sqlite3";
import { getAggregatedBallot, type GeoColumn } from "../db/ballot.js";
import { largestRemainderPercents } from "../lib/percentages.js";
import type { Election } from "../lib/get-election.js";

/**
 * Cross-election compare — pulls aggregated ballot lists for each election in
 * the request and reshapes them into a single per-party rows × per-election
 * columns table.
 *
 * Percentages within each election are computed with the largest-remainder
 * method so the columns sum to exactly 100.0.
 */

export interface CompareOptions {
  electionIds: number[];
  geo: { column: GeoColumn; value: string } | null;
}

export interface CompareElectionEntry {
  votes: number;
  percentage: number;
}

export interface CompareResultRow {
  party_id: number;
  party_name: string;
  elections: Record<string, CompareElectionEntry>;
}

export interface CompareResult {
  elections: Election[];
  results: CompareResultRow[];
}

export function getElectionsByIds(
  db: DatabaseType,
  ids: number[],
): Election[] {
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT id, name, date, type FROM elections WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Election[];
}

export function getCompare(
  db: DatabaseType,
  electionIds: number[],
  geo: { column: GeoColumn; value: string } | null,
  electionMeta: Election[],
): CompareResult {
  // Pull aggregated ballot per election, stamped with election_id so the
  // downstream cross-election aggregation logic keeps working unchanged.
  const rows: {
    election_id: number;
    party_id: number;
    party_name: string;
    votes: number;
  }[] = [];
  for (const elId of electionIds) {
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

  const totalsByElection = new Map<number, number>();
  for (const row of rows) {
    totalsByElection.set(
      row.election_id,
      (totalsByElection.get(row.election_id) || 0) + row.votes,
    );
  }

  const partyMap = new Map<
    number,
    {
      party_name: string;
      elections: Map<number, number>;
      totalVotes: number;
    }
  >();
  for (const row of rows) {
    let entry = partyMap.get(row.party_id);
    if (!entry) {
      entry = {
        party_name: row.party_name,
        elections: new Map(),
        totalVotes: 0,
      };
      partyMap.set(row.party_id, entry);
    }
    entry.elections.set(row.election_id, row.votes);
    entry.totalVotes += row.votes;
  }

  const sortedEntries = Array.from(partyMap.entries()).sort(
    (a, b) => b[1].totalVotes - a[1].totalVotes,
  );

  // Per-election largest-remainder percentages keyed by partyId.
  const percentages = new Map<number, Map<number, number>>();
  for (const elId of electionIds) {
    const total = totalsByElection.get(elId) || 0;
    const partVotes = sortedEntries.map(
      ([, data]) => data.elections.get(elId) || 0,
    );
    const pcts = largestRemainderPercents(partVotes, total);
    const elMap = new Map<number, number>();
    sortedEntries.forEach(([partyId], i) => {
      elMap.set(partyId, pcts[i]);
    });
    percentages.set(elId, elMap);
  }

  const results: CompareResultRow[] = sortedEntries.map(([partyId, data]) => {
    const electionsObj: Record<string, CompareElectionEntry> = {};
    for (const elId of electionIds) {
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

  return { elections: electionMeta, results };
}
