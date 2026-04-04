import { Hono } from "hono";
import db from "../db.js";

const elections = new Hono();

elections.get("/", (c) => {
  const rows = db
    .prepare("SELECT id, name, date, type FROM elections ORDER BY date DESC")
    .all();
  return c.json(rows);
});

elections.get("/:id/results", (c) => {
  const { id } = c.req.param();

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id);

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  const results = db
    .prepare(
      `SELECT p.id AS party_id, p.name AS party_name, SUM(v.votes) AS total_votes
       FROM votes v
       JOIN parties p ON p.id = v.party_id
       WHERE v.election_id = ?
       GROUP BY p.id, p.name
       ORDER BY total_votes DESC`
    )
    .all(id);

  return c.json({ election, results });
});

export default elections;
