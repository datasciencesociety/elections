import { Hono } from "hono";
import { stmt, writeMetricsBatch, type MetricRow } from "./db.js";
import { getBlob } from "./cache.js";
import { requireBearer } from "./auth.js";
import { assignUnassigned } from "./assign.js";

const app = new Hono();

// ── CORS for public reads ───────────────────────────────────────────────────
app.use("*", async (c, next) => {
  await next();
  if (c.res.status === 200) {
    c.header("Access-Control-Allow-Origin", "*");
  }
});

// ── Public reads ───────────────────────────────────────────────────────────
// Pre-gzipped memory blob. Cloudflare (edge 2s) + nginx (proxy_cache 2s) sit
// in front of this, so even under a 10k req/s load, this handler runs
// <1 req/s per origin.
app.get("/metrics", (c) => {
  const blob = getBlob();
  if (!blob) return c.text("warming up", 503);
  if (c.req.header("if-none-match") === blob.etag) {
    c.header("ETag", blob.etag);
    c.header("Cache-Control", "public, max-age=5, s-maxage=5");
    return c.body(null, 304);
  }
  c.header("ETag", blob.etag);
  c.header("Cache-Control", "public, max-age=5, s-maxage=5");
  c.header("Content-Type", "application/json; charset=utf-8");
  const acceptsGz = (c.req.header("accept-encoding") || "").includes("gzip");
  if (acceptsGz) {
    c.header("Content-Encoding", "gzip");
    c.header("Vary", "Accept-Encoding");
    return c.body(blob.gz);
  }
  return c.body(blob.raw);
});

app.get("/boxes", (c) => {
  const rows = stmt.boxesAll.all();
  c.header("Cache-Control", "no-store");
  return c.json({ boxes: rows, updated_at: Date.now() });
});

// Full section list (id + evideo URL + label). Stable for minutes —
// 60s edge cache is plenty. Clients fetch this once on load, then poll
// /metrics every 5s for live statuses.
app.get("/sections", (c) => {
  const rows = stmt.sectionsAll.all();
  c.header("Cache-Control", "public, max-age=60, s-maxage=60");
  c.header("Content-Type", "application/json; charset=utf-8");
  return c.json({ sections: rows, count: rows.length, updated_at: Date.now() });
});

// For analyzer boxes to discover their work list.
app.get("/assignments/my", (c) => {
  const ip = c.req.query("ip");
  if (!ip) return c.json({ error: "ip required" }, 400);
  const rows = stmt.assignForBox.all(ip);
  c.header("Cache-Control", "no-store");
  return c.json({ sections: rows });
});

// ── Mutating routes (Bearer secret) ────────────────────────────────────────
app.post("/register", requireBearer, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ip = c.var.apiUser; // identifier from split key
  const capacity = Number(body.capacity) || 30;
  const now = Date.now();
  stmt.boxUpsert.run(ip, capacity, now, now);
  // Fill the new box's capacity immediately rather than waiting for the GC
  // tick — avoids idle time on freshly-registered boxes.
  const { assigned } = assignUnassigned();
  // Return the actual work list so the caller can start immediately —
  // saves a round trip to /assignments/my on startup.
  const sections = stmt.assignForBox.all(ip);
  console.log(`[register] ${ip} capacity=${capacity} immediate=${assigned} total=${sections.length}`);
  return c.json({ ok: true, assigned, capacity, sections });
});

app.post("/heartbeat", requireBearer, async (c) => {
  const ip = c.var.apiUser;
  const result = stmt.boxTouch.run(Date.now(), ip);
  if (result.changes === 0) {
    // Box was GC'd (probably long silence). Tell it to re-register.
    return c.json({ ok: false, reregister: true }, 200);
  }
  return c.json({ ok: true });
});

app.post("/deregister", requireBearer, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ip = c.var.apiUser;
  const drain = body.drain !== false; // default: graceful drain
  if (drain) {
    stmt.boxDrain.run(ip);
    console.log(`[deregister] ${ip} draining`);
  } else {
    stmt.boxDelete.run(ip);
    const { assigned } = assignUnassigned();
    console.log(`[deregister] ${ip} hard-removed, reassigned=${assigned}`);
    return c.json({ ok: true, reassigned: assigned });
  }
  return c.json({ ok: true, draining: true });
});

app.post("/metrics", requireBearer, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { results?: Array<Partial<MetricRow>> } | null;
  if (!body || !Array.isArray(body.results)) return c.json({ error: "results[] required" }, 400);
  const now = Date.now();
  const apiUser = c.var.apiUser;
  const rows: MetricRow[] = body.results.map((r) => ({
    section_id: String(r.section_id),
    status: String(r.status || "unknown"),
    luma: typeof r.luma === "number" ? r.luma : null,
    motion_diff: typeof r.motion_diff === "number" ? r.motion_diff : null,
    cover_ratio: typeof r.cover_ratio === "number" ? r.cover_ratio : null,
    frozen_sec: typeof r.frozen_sec === "number" ? r.frozen_sec : null,
    snapshot_url: r.snapshot_url ? String(r.snapshot_url) : null,
    // All rows in the batch come from the same caller — tag with the
    // identifier from their API key rather than trusting body.box_ip.
    box_ip: apiUser,
    reported_at: now,
  }));
  writeMetricsBatch(rows);
  return c.json({ ok: true, stored: rows.length });
});

app.post("/sections", requireBearer, async (c) => {
  // Bulk seed/update. Expects a JSON array of {id, url, label?}.
  const body = (await c.req.json().catch(() => null)) as Array<{ id: string; url: string; label?: string }> | null;
  if (!Array.isArray(body)) return c.json({ error: "array required" }, 400);
  let n = 0;
  for (const s of body) {
    if (!s?.id || !s?.url) continue;
    stmt.sectionUpsert.run(String(s.id), String(s.url), s.label ? String(s.label) : null);
    n += 1;
  }
  return c.json({ ok: true, upserted: n, total: (stmt.sectionCount.get() as { n: number }).n });
});

app.post("/assign-all", requireBearer, (c) => {
  const { assigned, stillUnassigned } = assignUnassigned();
  return c.json({ ok: true, assigned, stillUnassigned });
});

export default app;
