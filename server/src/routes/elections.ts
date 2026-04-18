import { Hono } from "hono";
import getDb from "../db.js";
import { resolveGeoFilter } from "../db/ballot.js";
import { getElection, listElections } from "../lib/get-election.js";
import {
  getAnomalies,
  resolveAnomalyGeoFilter,
  ANOMALY_SORT_SQL,
  VALID_ANOMALY_SORT_KEYS,
  type AnomalySortKey,
} from "../queries/anomalies.js";
import {
  getPersistence,
  getPersistenceSectionHistory,
  PERSISTENCE_SORT_SQL,
  type PersistenceSortKey,
} from "../queries/persistence.js";
import {
  getCompare,
  getElectionsByIds,
} from "../queries/compare.js";
import {
  getTurnout,
  resolveTurnoutFilter,
  TURNOUT_LEVELS,
  type TurnoutLevel,
} from "../queries/turnout.js";
import {
  getSectionViolations,
  getViolationsSummary,
} from "../queries/violations.js";
import {
  getSectionDetail,
  getSectionsGeo,
} from "../queries/sections.js";
import {
  getAbroadByCountry,
  getGeoResults,
  getGeoResultsLean,
} from "../queries/geo-results.js";
import { getAggregatedBallot } from "../db/ballot.js";

const elections = new Hono();

const KNOWN_SECTION_TYPES = new Set([
  "normal",
  "hospital",
  "prison",
  "mobile",
  "abroad",
]);

/** Parse `section_types=a,b,c` into a validated allowlist. Returns `undefined`
 *  when the param is absent so callers fall back to `exclude_special` (the
 *  older coarse toggle). An empty string or a list of only unknown types
 *  collapses to `[]`, which matches zero rows — same behaviour as the picker
 *  with everything unchecked. */
function parseSectionTypesParam(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => KNOWN_SECTION_TYPES.has(t));
}

// ---------- list ----------

elections.get("/", (c) => {
  return c.json(listElections(getDb()));
});

// ---------- compare (must be before /:id) ----------

elections.get("/compare", (c) => {
  const db = getDb();
  const electionsParam = c.req.query("elections");

  if (!electionsParam) {
    return c.json(
      { error: "Missing required 'elections' query parameter" },
      400,
    );
  }

  const ids = electionsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

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

  const existing = getElectionsByIds(db, numericIds);
  if (existing.length !== numericIds.length) {
    const found = new Set(existing.map((e) => e.id));
    const missing = numericIds.find((id) => !found.has(id));
    return c.json({ error: `Election with id ${missing} not found` }, 404);
  }

  const geo = resolveGeoFilter({
    kmetstvo: c.req.query("kmetstvo"),
    local_region: c.req.query("local_region"),
    municipality: c.req.query("municipality"),
    district: c.req.query("district"),
    rik: c.req.query("rik"),
  });

  return c.json(getCompare(db, numericIds, geo, existing));
});

// ---------- persistence (must be before /:id) ----------

elections.get("/persistence", (c) => {
  const db = getDb();

  const minElections = Math.max(
    parseInt(c.req.query("min_elections") ?? "5", 10),
    1,
  );
  const minScore = parseFloat(c.req.query("min_score") ?? "0");
  const sortRaw = c.req.query("sort") ?? "persistence_score";
  const sort: PersistenceSortKey =
    sortRaw in PERSISTENCE_SORT_SQL
      ? (sortRaw as PersistenceSortKey)
      : "persistence_score";
  const order = c.req.query("order") === "asc" ? "asc" : "desc";
  const limit = Math.max(parseInt(c.req.query("limit") ?? "100", 10), 1);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10), 0);
  const excludeSpecial = c.req.query("exclude_special") === "true";
  const sectionTypes = parseSectionTypesParam(c.req.query("section_types"));
  const sectionFilter = c.req.query("section") || undefined;
  const district = c.req.query("district") || undefined;
  const municipality = c.req.query("municipality") || undefined;

  const result = getPersistence(db, {
    minElections,
    minScore,
    sort,
    order,
    limit,
    offset,
    excludeSpecial,
    sectionTypes,
    sectionFilter,
    district,
    municipality,
  });

  return c.json({
    sections: result.sections,
    total: result.total,
    limit,
    offset,
    elections_count: result.elections.length,
    weights: Object.fromEntries(
      result.elections.map((e) => [
        e.id,
        {
          name: e.name,
          weight: Math.round((result.weights.get(e.id) ?? 0) * 1000) / 1000,
        },
      ]),
    ),
  });
});

elections.get("/persistence/:sectionCode", (c) => {
  const db = getDb();
  const { sectionCode } = c.req.param();
  const rows = getPersistenceSectionHistory(db, sectionCode);
  return c.json({ section_code: sectionCode, elections: rows });
});

// ---------- per-election ----------

elections.get("/:id/turnout", (c) => {
  const db = getDb();
  const { id } = c.req.param();
  const election = getElection(db, id);
  if (!election) return c.json({ error: "Election not found" }, 404);

  const groupBy = c.req.query("group_by");
  if (!groupBy) {
    return c.json(
      { error: "Missing required 'group_by' query parameter" },
      400,
    );
  }
  if (!TURNOUT_LEVELS.includes(groupBy as TurnoutLevel)) {
    return c.json(
      { error: `Invalid group_by value. Must be one of: ${TURNOUT_LEVELS.join(", ")}` },
      400,
    );
  }

  const filter = resolveTurnoutFilter({
    kmetstvo: c.req.query("kmetstvo"),
    local_region: c.req.query("local_region"),
    municipality: c.req.query("municipality"),
    district: c.req.query("district"),
    rik: c.req.query("rik"),
  });

  const result = getTurnout(db, id, groupBy as TurnoutLevel, filter);
  return c.json({ election, turnout: result.rows, totals: result.totals });
});

elections.get("/:id/anomalies", (c) => {
  const db = getDb();
  const { id } = c.req.param();
  const election = getElection(db, id);
  if (!election) return c.json({ error: "Election not found" }, 404);

  const minRisk = parseFloat(c.req.query("min_risk") ?? "0.3");
  const sortRaw = c.req.query("sort") ?? "risk_score";
  if (!(sortRaw in ANOMALY_SORT_SQL)) {
    return c.json(
      {
        error: `Invalid sort column. Must be one of: ${VALID_ANOMALY_SORT_KEYS.join(", ")}`,
      },
      400,
    );
  }
  const sort = sortRaw as AnomalySortKey;
  const order = c.req.query("order") === "asc" ? "asc" : "desc";
  const limitParam = c.req.query("limit");
  const limit =
    limitParam === "0"
      ? null
      : Math.max(parseInt(limitParam ?? "50", 10) || 50, 1);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  const minViolations = parseInt(c.req.query("min_violations") ?? "0", 10);
  const sectionCode = c.req.query("section") || undefined;
  const excludeSpecial = c.req.query("exclude_special") === "true";
  const sectionTypes = parseSectionTypesParam(c.req.query("section_types"));
  const methodology = c.req.query("methodology") || undefined;

  const geoFilter = resolveAnomalyGeoFilter({
    kmetstvo: c.req.query("kmetstvo"),
    local_region: c.req.query("local_region"),
    municipality: c.req.query("municipality"),
    district: c.req.query("district"),
    rik: c.req.query("rik"),
  });

  const { sections, total } = getAnomalies(db, {
    electionId: id,
    minRisk,
    sort,
    order,
    limit,
    offset,
    methodology,
    minViolations,
    geoFilter,
    sectionCode,
    excludeSpecial,
    sectionTypes,
  });

  const parsed = sections.map((s) => ({
    ...s,
    turnout_history: s.turnout_history
      ? JSON.parse(s.turnout_history)
      : null,
  }));

  return c.json({ election, sections: parsed, total, limit, offset });
});

elections.get("/:id/violations/:sectionCode", (c) => {
  const db = getDb();
  const { id, sectionCode } = c.req.param();
  const violations = getSectionViolations(db, id, sectionCode);
  return c.json({ section_code: sectionCode, violations });
});

elections.get("/:id/violations", (c) => {
  const db = getDb();
  const { id } = c.req.param();
  return c.json(getViolationsSummary(db, id));
});

elections.get("/:id/sections/geo", (c) => {
  const db = getDb();
  const { id } = c.req.param();
  const election = getElection(db, id);
  if (!election) return c.json({ error: "Election not found" }, 404);

  // Note: this endpoint historically only accepts municipality/district/rik
  // (not kmetstvo / local_region). Preserve that.
  const muni = c.req.query("municipality");
  const district = c.req.query("district");
  const rik = c.req.query("rik");
  let geoFilter: { column: string; value: string } | null = null;
  if (muni) geoFilter = { column: "l.municipality_id", value: muni };
  else if (district) geoFilter = { column: "l.district_id", value: district };
  else if (rik) geoFilter = { column: "l.rik_id", value: rik };

  const sections = getSectionsGeo(db, id, geoFilter);
  c.header("Cache-Control", "public, max-age=86400");
  return c.json({ election, sections });
});

elections.get("/:id/sections/:code", (c) => {
  const db = getDb();
  const { id, code } = c.req.param();
  const election = getElection(db, id);
  if (!election) return c.json({ error: "Election not found" }, 404);

  const detail = getSectionDetail(db, id, election.type, election.date, code);
  if (!detail) return c.json({ error: "Section not found" }, 404);
  return c.json(detail);
});

elections.get("/:id/results", (c) => {
  const db = getDb();
  const { id } = c.req.param();
  const election = getElection(db, id);
  if (!election) return c.json({ error: "Election not found" }, 404);

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
  const election = getElection(db, id);
  if (!election) return c.json({ error: "Election not found" }, 404);
  return c.json({ election, districts: getGeoResults(db, id, "district") });
});

elections.get("/:id/results/geo/municipalities", (c) => {
  const db = getDb();
  const { id } = c.req.param();
  if (!/^\d+$/.test(id)) {
    return c.json({ error: "Election ID must be numeric" }, 400);
  }
  const election = getElection(db, id);
  if (!election) return c.json({ error: "Election not found" }, 404);
  return c.json({
    election,
    municipalities: getGeoResults(db, id, "municipality"),
  });
});

elections.get("/:id/results/geo/riks", (c) => {
  const db = getDb();
  const { id } = c.req.param();
  if (!/^\d+$/.test(id)) {
    return c.json({ error: "Election ID must be numeric" }, 400);
  }
  const election = getElection(db, id);
  if (!election) return c.json({ error: "Election not found" }, 404);
  return c.json({ election, riks: getGeoResults(db, id, "rik") });
});

elections.get("/:id/results/abroad-by-country", (c) => {
  const db = getDb();
  const { id } = c.req.param();
  if (!/^\d+$/.test(id)) {
    return c.json({ error: "Election ID must be numeric" }, 400);
  }
  const election = getElection(db, id);
  if (!election) return c.json({ error: "Election not found" }, 404);
  return c.json({ election, countries: getAbroadByCountry(db, id) });
});

elections.get("/:id/results/geo", (c) => {
  const db = getDb();
  const { id } = c.req.param();
  if (!/^\d+$/.test(id)) {
    return c.json({ error: "Election ID must be numeric" }, 400);
  }
  const election = getElection(db, id);
  if (!election) return c.json({ error: "Election not found" }, 404);
  return c.json({ election, municipalities: getGeoResultsLean(db, id) });
});

export default elections;
