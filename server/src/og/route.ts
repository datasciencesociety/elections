import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import getDb from "../db.js";
import { renderOgImage, svgToPngDataUri } from "./render.js";
import { renderMapSvg } from "./map-svg.js";
import {
  getOgElection,
  getOgTopParties,
  getOgMunicipality,
  getOgMunicipalityParties,
  getOgSectionDetail,
  getOgSectionHistory,
  getOgSectionElection,
  getOgDistrict,
  getOgPersistenceSummary,
} from "./queries.js";
import {
  LandingTemplate,
  ResultsContextTemplate,
  AnomalyTemplate,
  SectionDetailTemplate,
  SectionElectionTemplate,
  PersistenceTemplate,
  DistrictTemplate,
} from "./templates.js";

const CACHE_DIR = resolve(import.meta.dirname, "../../../og-cache");
mkdirSync(CACHE_DIR, { recursive: true });

const og = new Hono();

function cachePath(key: string): string {
  return resolve(CACHE_DIR, `${key}.png`);
}

function fromCache(key: string): Buffer | null {
  const path = cachePath(key);
  if (existsSync(path)) return readFileSync(path);
  return null;
}

function toCache(key: string, data: Buffer): void {
  writeFileSync(cachePath(key), data);
}

async function servePng(
  key: string,
  generate: () => Promise<Buffer>,
): Promise<Response> {
  let png = fromCache(key);
  if (!png) {
    png = await generate();
    toCache(key, png);
  }
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

// GET /og/landing.png
og.get("/landing.png", async () => {
  return servePng("landing", () => renderOgImage(LandingTemplate()));
});

// GET /og/election/:id/results.png?region=123&party=ГЕРБ-СДС
og.get("/election/:id/results.png", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const election = getOgElection(db, id);
  if (!election) return c.text("Not found", 404);

  const regionParam = c.req.query("region");
  const partyParam = c.req.query("party");
  const nonVotersParam = c.req.query("nonVoters");
  const regionId = regionParam ? Number(regionParam) : null;
  const showNonVoters = nonVotersParam !== "0";
  const nvKey = showNonVoters ? "" : "-nv0";

  // Resolve highlighted party → color for map tile dimming
  // SQLite LOWER() doesn't handle Cyrillic, so we match in JS
  let highlightColor: string | null = null;
  if (partyParam) {
    const rows = db
      .prepare(
        `SELECT ep.name_on_ballot AS name, COALESCE(p.color, '#888888') AS color
           FROM election_parties ep
           JOIN parties p ON p.id = ep.party_id
          WHERE ep.election_id = ?`,
      )
      .all(id) as { name: string; color: string }[];
    const needle = partyParam.toLowerCase();
    const match = rows.find((r) => r.name.toLowerCase() === needle);
    highlightColor = match?.color ?? null;
  }

  // Contextual image: municipality selected — zoomed map of just that municipality
  if (regionId) {
    const municipality = getOgMunicipality(db, regionId, id);
    const parties = getOgMunicipalityParties(db, id, regionId, showNonVoters);
    const mapSvg = renderMapSvg(db, id, regionId, highlightColor);
    const mapDataUri = svgToPngDataUri(mapSvg, 920);
    const cacheKey = `election-${id}-results-r${regionId}${nvKey}${partyParam ? `-p${partyParam}` : ""}`;
    return servePng(cacheKey, () =>
      renderOgImage(
        ResultsContextTemplate({
          election,
          municipality,
          parties,
          highlightParty: partyParam || null,
          mapDataUri,
        }),
      ),
    );
  }

  // Default: national results — full Bulgaria map
  const mapSvg = renderMapSvg(db, id, null, highlightColor);
  const mapDataUri = svgToPngDataUri(mapSvg, 920);
  const parties = getOgTopParties(db, id, showNonVoters);
  const cacheKey = `election-${id}-results${nvKey}${partyParam ? `-p${partyParam}` : ""}`;
  return servePng(cacheKey, () =>
    renderOgImage(
      ResultsContextTemplate({
        election,
        municipality: null,
        parties,
        highlightParty: partyParam || null,
        mapDataUri,
      }),
    ),
  );
});

// GET /og/election/:id/sections.png
og.get("/election/:id/sections.png", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const election = getOgElection(db, id);
  if (!election) return c.text("Not found", 404);
  return servePng(`election-${id}-sections`, () =>
    renderOgImage(AnomalyTemplate({ election, variant: "map" })),
  );
});

// GET /og/election/:id/table.png
og.get("/election/:id/table.png", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const election = getOgElection(db, id);
  if (!election) return c.text("Not found", 404);
  return servePng(`election-${id}-table`, () =>
    renderOgImage(AnomalyTemplate({ election, variant: "table" })),
  );
});

// GET /og/election/:id/section/:code — per-election section detail
og.get("/election/:id/section/:code", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const code = c.req.param("code").replace(/\.png$/, "");
  const election = getOgElection(db, id);
  if (!election) return c.text("Not found", 404);
  const section = getOgSectionElection(db, id, code);
  if (!section) return c.text("Not found", 404);
  return servePng(`election-${id}-section-${code}`, () =>
    renderOgImage(SectionElectionTemplate({ election, section })),
  );
});

// GET /og/section/:code — cross-election section detail
og.get("/section/:code", async (c) => {
  const db = getDb();
  const sectionCode = c.req.param("code").replace(/\.png$/, "");
  const section = getOgSectionDetail(db, sectionCode);
  if (!section) return c.text("Not found", 404);
  const history = getOgSectionHistory(db, sectionCode);
  return servePng(`section-${sectionCode}`, () =>
    renderOgImage(SectionDetailTemplate({ section, history })),
  );
});

// GET /og/persistence.png
og.get("/persistence.png", async () => {
  const db = getDb();
  const summary = getOgPersistenceSummary(db);
  return servePng("persistence", () =>
    renderOgImage(PersistenceTemplate({ summary })),
  );
});

// GET /og/district/:id
og.get("/district/:id", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id").replace(/\.png$/, ""));
  const district = getOgDistrict(db, id);
  if (!district) return c.text("Not found", 404);
  return servePng(`district-${id}`, () =>
    renderOgImage(DistrictTemplate({ district })),
  );
});

export default og;
