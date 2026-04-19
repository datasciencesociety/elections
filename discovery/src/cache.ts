import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { stmt } from "./db.js";

// Pre-serialized, pre-gzipped snapshot of the full /video/metrics response.
// All reads serve straight from here — no DB, no JSON.stringify, no gzip per
// request. Rebuilt on a fixed interval (default 1 s). Under Cloudflare +
// nginx edge caching, this is still called <1×/s per origin, but the
// pre-compute keeps worst-case latency flat even under a cache stampede.

export interface Blob {
  raw: Uint8Array;
  gz: Uint8Array;
  etag: string;
  builtAt: number;
  sectionCount: number;
}

let current: Blob | null = null;

export function getBlob(): Blob | null {
  return current;
}

export function rebuild(): Blob {
  const rows = stmt.metricsAll.all() as Array<{
    section_id: string;
    status: string;
    luma: number | null;
    motion_diff: number | null;
    cover_ratio: number | null;
    frozen_sec: number | null;
    snapshot_url: string | null;
    box_ip: string | null;
    reported_at: number;
  }>;

  const obj: Record<string, Omit<(typeof rows)[number], "section_id">> = {};
  for (const r of rows) {
    const { section_id, ...rest } = r;
    obj[section_id] = rest;
  }
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  // Cast: gzipSync's return type mis-aligns with our Uint8Array field
  // (Buffer-vs-Uint8Array, shared-array-buffer-typed-vs-not). At runtime
  // Buffer extends Uint8Array, so the cast is sound.
  const gz = gzipSync(raw, { level: 6 }) as unknown as Uint8Array;
  // Hash the raw body — it changes iff the gzipped body changes.
  const etag = `W/"m${createHash("sha1").update(raw).digest("hex").slice(0, 16)}"`;
  const blob: Blob = { raw, gz, etag, builtAt: Date.now(), sectionCount: rows.length };
  current = blob;
  return blob;
}

const REBUILD_MS = Number(process.env.METRICS_REBUILD_MS) || 1000;

export function startRebuildLoop() {
  rebuild();
  setInterval(() => {
    try {
      rebuild();
    } catch (e) {
      console.error("[cache] rebuild failed", e);
    }
  }, REBUILD_MS).unref();
}
