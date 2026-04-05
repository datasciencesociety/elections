import { Hono } from "hono";
import getDb from "../db.js";

const parties = new Hono();

// GET /api/parties — list all parties with metadata, election_count, total_votes
parties.get("/", (c) => {
  const db = getDb();
  const typeFilter = c.req.query("type");

  let sql = `
    SELECT p.id, p.canonical_name, p.short_name, p.party_type, p.color,
           COUNT(DISTINCT ep.election_id) AS election_count,
           COALESCE(SUM(v.total), 0) AS total_votes
    FROM parties p
    LEFT JOIN election_parties ep ON ep.party_id = p.id
    LEFT JOIN votes v ON v.election_id = ep.election_id AND v.party_number = ep.ballot_number
  `;
  const params: unknown[] = [];

  if (typeFilter) {
    sql += " WHERE p.party_type = ?";
    params.push(typeFilter);
  }

  sql += " GROUP BY p.id ORDER BY total_votes DESC";

  const rows = db.prepare(sql).all(...params);
  return c.json(rows);
});

// GET /api/parties/:id — party detail with coalition info and per-election results
parties.get("/:id", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  const party = db
    .prepare(
      "SELECT id, canonical_name, short_name, party_type, color, wiki_url FROM parties WHERE id = ?"
    )
    .get(id) as
    | {
        id: number;
        canonical_name: string;
        short_name: string | null;
        party_type: string;
        color: string | null;
        wiki_url: string | null;
      }
    | undefined;

  if (!party) {
    return c.json({ error: "Party not found" }, 404);
  }

  // Coalitions this party belongs to
  const coalitions = db
    .prepare(
      `SELECT p.id, p.canonical_name, p.color
       FROM coalition_members cm
       JOIN parties p ON p.id = cm.coalition_id
       WHERE cm.member_party_id = ?`
    )
    .all(id) as { id: number; canonical_name: string; color: string | null }[];

  // Members of this party (if it is a coalition)
  const members = db
    .prepare(
      `SELECT p.id, p.canonical_name, p.color
       FROM coalition_members cm
       JOIN parties p ON p.id = cm.member_party_id
       WHERE cm.coalition_id = ?`
    )
    .all(id) as { id: number; canonical_name: string; color: string | null }[];

  // Per-election results
  const electionResults = db
    .prepare(
      `SELECT e.id AS election_id, e.name AS election_name, e.date AS election_date,
              e.type AS election_type, ep.ballot_number, ep.name_on_ballot,
              COALESCE(SUM(v.total), 0) AS votes
       FROM election_parties ep
       JOIN elections e ON e.id = ep.election_id
       LEFT JOIN votes v ON v.election_id = ep.election_id AND v.party_number = ep.ballot_number
       WHERE ep.party_id = ?
       GROUP BY e.id
       ORDER BY e.date DESC`
    )
    .all(id) as {
    election_id: number;
    election_name: string;
    election_date: string;
    election_type: string;
    ballot_number: number;
    name_on_ballot: string | null;
    votes: number;
  }[];

  // Compute percentages: total valid votes per election
  const electionIds = electionResults.map((r) => r.election_id);
  const percentageMap = new Map<number, number>();

  if (electionIds.length > 0) {
    const placeholders = electionIds.map(() => "?").join(",");
    const totals = db
      .prepare(
        `SELECT election_id, SUM(total) AS total_votes
         FROM votes
         WHERE election_id IN (${placeholders})
         GROUP BY election_id`
      )
      .all(...electionIds) as { election_id: number; total_votes: number }[];

    const totalMap = new Map(totals.map((t) => [t.election_id, t.total_votes]));
    for (const r of electionResults) {
      const total = totalMap.get(r.election_id) || 1;
      percentageMap.set(
        r.election_id,
        Math.round((r.votes / total) * 10000) / 100
      );
    }
  }

  const elections = electionResults.map((r) => ({
    election_id: r.election_id,
    election_name: r.election_name,
    election_date: r.election_date,
    election_type: r.election_type,
    ballot_number: r.ballot_number,
    name_on_ballot: r.name_on_ballot,
    votes: r.votes,
    percentage: percentageMap.get(r.election_id) || 0,
  }));

  return c.json({ ...party, coalitions, members, elections });
});

export default parties;
