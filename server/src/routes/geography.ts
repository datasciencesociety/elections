import { Hono } from "hono";
import getDb from "../db.js";
import { BALLOT_JOIN_SQL, BALLOT_NAME_SQL } from "../db/ballot.js";
import { getSettlementPeers } from "../queries/sections.js";

const geography = new Hono();

geography.get("/riks", (c) => {
  const db = getDb();
  const rows = db.prepare("SELECT id, name FROM riks ORDER BY id").all();
  return c.json(rows);
});

/**
 * List districts with a section count for each. The count is the number of
 * unique section codes that have ever had a row in any election — it's
 * stable enough to display as "N секции" on the landing tile. Sorted by
 * Bulgarian name for the browse-first grid.
 */
geography.get("/districts", (c) => {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT
        d.id,
        d.name,
        COUNT(DISTINCT s.section_code) AS section_count
      FROM districts d
      LEFT JOIN locations l ON l.district_id = d.id
      LEFT JOIN sections  s ON s.location_id = l.id
      GROUP BY d.id
      ORDER BY d.name COLLATE NOCASE
      `
    )
    .all();
  return c.json(rows);
});

/**
 * Count of abroad sections — those whose location has no district_id.
 * Used by the "Чужбина" tile on the landing grid.
 */
geography.get("/abroad-summary", (c) => {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT
        COUNT(DISTINCT s.section_code) AS section_count,
        COUNT(DISTINCT
          CASE
            WHEN INSTR(COALESCE(s.settlement_name, l.settlement_name), ',') > 0
              THEN SUBSTR(COALESCE(s.settlement_name, l.settlement_name), 1, INSTR(COALESCE(s.settlement_name, l.settlement_name), ',') - 1)
            ELSE COALESCE(s.settlement_name, l.settlement_name)
          END
        ) AS country_count
      FROM sections s
      JOIN locations l ON l.id = s.location_id
      WHERE l.district_id IS NULL
      `
    )
    .get();

  return c.json(row);
});

geography.get("/municipalities", (c) => {
  const db = getDb();
  const district = c.req.query("district");
  if (district) {
    const rows = db
      .prepare(
        "SELECT id, name FROM municipalities WHERE district_id = ? ORDER BY id"
      )
      .all(district);
    return c.json(rows);
  }
  const rows = db
    .prepare("SELECT id, name FROM municipalities ORDER BY id")
    .all();
  return c.json(rows);
});

geography.get("/kmetstva", (c) => {
  const db = getDb();
  const municipality = c.req.query("municipality");
  if (municipality) {
    const rows = db
      .prepare(
        "SELECT id, name FROM kmetstva WHERE municipality_id = ? ORDER BY id"
      )
      .all(municipality);
    return c.json(rows);
  }
  const rows = db.prepare("SELECT id, name FROM kmetstva ORDER BY id").all();
  return c.json(rows);
});

geography.get("/local-regions", (c) => {
  const db = getDb();
  const municipality = c.req.query("municipality");
  if (municipality) {
    const rows = db
      .prepare(
        "SELECT id, name FROM local_regions WHERE municipality_id = ? ORDER BY id"
      )
      .all(municipality);
    return c.json(rows);
  }
  const rows = db
    .prepare("SELECT id, name FROM local_regions ORDER BY id")
    .all();
  return c.json(rows);
});

/**
 * GET /api/geography/search-index
 *
 * Returns every unique polling section with the fields needed for client-side
 * full-text search. One row per section_code — the client groups by address
 * for display so users can pick their exact section inside a school / block.
 *
 * section_code is stable across elections for the same building, so each
 * section appears once regardless of how many elections we have data for.
 *
 * Field names are one-letter to minimize gzip size. Cached aggressively —
 * the frontend fetches this once per session, lazy-loaded on search focus.
 */
geography.get("/search-index", (c) => {
  const db = getDb();
  // For each section_code we pick the row from the MOST RECENT election the
  // section appears in, and coalesce per-election overrides on address/lat/lng
  // on top of the shared locations row. That way a section that was moved for
  // a temporary election — renovation, moved polling station — shows up in
  // search at the latest known address, not an old one.
  const rows = db
    .prepare(
      `
      WITH latest AS (
        SELECT sec.section_code, sec.election_id, sec.location_id,
               sec.settlement_name AS sec_settlement_name,
               sec.address AS sec_address,
               sec.lat     AS sec_lat,
               sec.lng     AS sec_lng,
               ROW_NUMBER() OVER (
                 PARTITION BY sec.section_code
                 ORDER BY sec.election_id DESC
               ) AS rn
          FROM sections sec
      )
      SELECT
        l.id                           AS lid,
        latest.section_code            AS c,
        COALESCE(latest.sec_settlement_name, l.settlement_name) AS s,
        COALESCE(latest.sec_address, l.address) AS a,
        d.name                         AS dn,
        m.name                         AS mn,
        r.name                         AS rn,
        COALESCE(latest.sec_lat, l.lat) AS la,
        COALESCE(latest.sec_lng, l.lng) AS lg
      FROM latest
      JOIN locations l ON l.id = latest.location_id
      LEFT JOIN districts      d ON d.id = l.district_id
      LEFT JOIN municipalities m ON m.id = l.municipality_id
      LEFT JOIN riks           r ON r.id = l.rik_id
      WHERE latest.rn = 1
      ORDER BY l.id, latest.section_code
      `
    )
    .all();


  return c.json({ sections: rows });
});

/**
 * GET /api/geography/district/:id/browse
 *
 * Every location inside a district, with the municipality name, settlement,
 * address, section count, and one representative section_code for linking.
 * Sorted by municipality → settlement → address so a contributor can scan
 * alphabetically. The client groups by municipality for display.
 */
geography.get("/district/:id/browse", (c) => {
  const db = getDb();
  const { id } = c.req.param();
  const electionId = c.req.query("election");
  if (!/^\d+$/.test(id)) {
    return c.json({ error: "District id must be numeric" }, 400);
  }

  const district = db
    .prepare("SELECT id, name FROM districts WHERE id = ?")
    .get(id) as { id: number; name: string } | undefined;
  if (!district) {
    return c.json({ error: "District not found" }, 404);
  }

  const electionFilter = electionId ? "AND s.election_id = ?" : "";
  const params: (string | number)[] = [Number(id)];
  if (electionId) params.push(Number(electionId));

  const rows = db
    .prepare(
      `
      SELECT
        l.id                       AS location_id,
        m.id                       AS municipality_id,
        m.name                     AS municipality_name,
        l.settlement_name          AS settlement_name,
        l.address                  AS address,
        l.lat                      AS lat,
        l.lng                      AS lng,
        COUNT(DISTINCT s.section_code) AS section_count,
        GROUP_CONCAT(DISTINCT s.section_code) AS section_codes
      FROM locations l
      LEFT JOIN municipalities m ON m.id = l.municipality_id
      JOIN sections s ON s.location_id = l.id
      WHERE l.district_id = ? ${electionFilter}
      GROUP BY l.id
      ORDER BY m.name COLLATE NOCASE, l.settlement_name COLLATE NOCASE, l.address COLLATE NOCASE
      `
    )
    .all(...params);


  return c.json({ district, locations: rows });
});

/**
 * GET /api/geography/abroad/browse
 *
 * Every abroad location (district_id IS NULL), grouped by country. The
 * country is extracted from the prefix of `settlement_name` ("Норвегия,
 * Осло" → "Норвегия"). Sorted by country → city → address.
 */
geography.get("/abroad/browse", (c) => {
  const db = getDb();
  const electionId = c.req.query("election");

  const electionFilter = electionId ? "AND s.election_id = ?" : "";
  const params: (string | number)[] = [];
  if (electionId) params.push(Number(electionId));

  const rows = db
    .prepare(
      `
      SELECT
        l.id              AS location_id,
        COALESCE(s.settlement_name, l.settlement_name) AS settlement_name,
        l.address         AS address,
        l.lat             AS lat,
        l.lng             AS lng,
        CASE
          WHEN INSTR(COALESCE(s.settlement_name, l.settlement_name), ',') > 0
            THEN TRIM(SUBSTR(COALESCE(s.settlement_name, l.settlement_name), 1, INSTR(COALESCE(s.settlement_name, l.settlement_name), ',') - 1))
          ELSE COALESCE(s.settlement_name, l.settlement_name)
        END               AS country,
        CASE
          WHEN INSTR(COALESCE(s.settlement_name, l.settlement_name), ',') > 0
            THEN TRIM(SUBSTR(COALESCE(s.settlement_name, l.settlement_name), INSTR(COALESCE(s.settlement_name, l.settlement_name), ',') + 1))
          ELSE ''
        END               AS city,
        COUNT(DISTINCT s.section_code) AS section_count,
        GROUP_CONCAT(DISTINCT s.section_code) AS section_codes
      FROM locations l
      JOIN sections s ON s.location_id = l.id
      WHERE l.district_id IS NULL ${electionFilter}
      GROUP BY l.id, COALESCE(s.settlement_name, l.settlement_name)
      ORDER BY country COLLATE NOCASE, city COLLATE NOCASE, l.address COLLATE NOCASE
      `
    )
    .all(...params);


  return c.json({ locations: rows });
});

/**
 * GET /api/geography/section-siblings/:code
 *
 * All polling sections that share the same physical location as the given
 * section — the "peer check". Same building, same electorate, same ballot:
 * results should look similar. Divergence is a signal.
 *
 * Returns the shared location info, the latest election, and for every
 * sibling the latest-election turnout + winner so the UI can render a
 * compact peer-comparison strip.
 *
 * The `:code` is a stable cross-election identifier, so we don't ask for an
 * election id — we always show the latest.
 */
geography.get("/section-siblings/:code", (c) => {
  const db = getDb();
  const { code } = c.req.param();

  // Resolve the latest election this section appears in, and pull its
  // per-election address/coords (falling back to the shared location
  // when the section has not been overridden).
  const latestRow = db
    .prepare(
      `SELECT
          l.id                          AS loc_id,
          COALESCE(s.settlement_name, l.settlement_name) AS settlement_name,
          COALESCE(s.address, l.address) AS address,
          COALESCE(s.lat,     l.lat)     AS lat,
          COALESCE(s.lng,     l.lng)     AS lng,
          e.id                          AS election_id,
          e.name                        AS election_name,
          e.date                        AS election_date,
          e.type                        AS election_type
        FROM sections s
        JOIN locations l ON l.id = s.location_id
        JOIN elections e ON e.id = s.election_id
        WHERE s.section_code = ?
        ORDER BY e.date DESC
        LIMIT 1`,
    )
    .get(code) as
    | {
        loc_id: number;
        settlement_name: string | null;
        address: string | null;
        lat: number | null;
        lng: number | null;
        election_id: number;
        election_name: string;
        election_date: string;
        election_type: string;
      }
    | undefined;

  if (!latestRow) {
    return c.json({ error: "Section not found" }, 404);
  }

  const locRow = {
    id: latestRow.loc_id,
    settlement_name: latestRow.settlement_name,
    address: latestRow.address,
    lat: latestRow.lat,
    lng: latestRow.lng,
  };
  const latest = {
    id: latestRow.election_id,
    name: latestRow.election_name,
    date: latestRow.election_date,
    type: latestRow.election_type,
  };

  // All sibling section codes at this location, for the latest election.
  // Attach protocol counts and the winning party from the ballot.
  const siblings = db
    .prepare(
      `
      WITH winner AS (
        SELECT
          section_code,
          party_name,
          color,
          pct,
          ROW_NUMBER() OVER (PARTITION BY section_code ORDER BY votes DESC) AS rn
        FROM (
          SELECT
            v.section_code,
            ${BALLOT_NAME_SQL} AS party_name,
            p.color            AS color,
            v.total            AS votes,
            ROUND(v.total * 100.0 / NULLIF(SUM(v.total) OVER (PARTITION BY v.section_code), 0), 1) AS pct
          FROM votes v
          ${BALLOT_JOIN_SQL}
          JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
          WHERE v.election_id = ? AND s.location_id = ?
        )
      )
      SELECT
        s.section_code,
        pr.registered_voters,
        pr.actual_voters,
        ROUND(pr.actual_voters * 1.0 / NULLIF(pr.registered_voters, 0), 4) AS turnout_rate,
        w.party_name AS winner_party,
        w.color      AS winner_color,
        w.pct        AS winner_pct
      FROM sections s
      LEFT JOIN protocols pr
        ON pr.election_id = s.election_id AND pr.section_code = s.section_code
      LEFT JOIN winner w
        ON w.section_code = s.section_code AND w.rn = 1
      WHERE s.location_id = ? AND s.election_id = ?
      ORDER BY s.section_code
      `
    )
    .all(latest.id, locRow.id, locRow.id, latest.id);

  return c.json({
    location: {
      id: locRow.id,
      settlement_name: locRow.settlement_name,
      address: locRow.address,
      lat: locRow.lat,
      lng: locRow.lng,
    },
    latest_election: latest,
    siblings,
  });
});

geography.get("/settlement-peers/:code", (c) => {
  const db = getDb();
  const { code } = c.req.param();
  const result = getSettlementPeers(db, code);
  if (!result) return c.json({ error: "Section not found" }, 404);

  return c.json(result);
});

geography.get("/missing-coordinates", (c) => {
  const db = getDb();
  const page = parseInt(c.req.query("page") ?? "1");
  const limit = 50;
  const offset = (page - 1) * limit;
  const search = c.req.query("search") ?? "";

  let where = "WHERE l.lat IS NULL AND l.address IS NOT NULL AND l.address != ''";
  const params: unknown[] = [];
  if (search) {
    where += " AND (LOWER(l.settlement_name) LIKE ? OR LOWER(l.address) LIKE ? OR s.section_code LIKE ?)";
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term, term);
  }

  const { total } = db.prepare(`
    SELECT COUNT(DISTINCT l.id) AS total
    FROM locations l
    JOIN sections s ON s.location_id = l.id
    ${where}
  `).get(...params) as { total: number };

  const rows = db.prepare(`
    SELECT
      l.id,
      l.settlement_name,
      l.address,
      l.ekatte,
      GROUP_CONCAT(DISTINCT s.section_code) AS section_codes,
      COUNT(DISTINCT s.section_code) AS section_count
    FROM locations l
    JOIN sections s ON s.location_id = l.id
    ${where}
    GROUP BY l.id
    ORDER BY section_count DESC, l.settlement_name
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return c.json({ total, page, pages: Math.ceil(total / limit), locations: rows });
});

export default geography;
