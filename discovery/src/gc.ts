import { stmt } from "./db.js";
import { assignUnassigned } from "./assign.js";

// Two-tier GC:
//
// BOX_TIMEOUT_MS — a whole box that hasn't heartbeat'd is declared dead.
//   ON DELETE CASCADE on assignments frees all its sections at once.
//
// STALE_SECTION_MS — per-section liveness. If a section's last metric is
//   older than this (AND it has ever reported — warming-up sections are
//   exempt), drop the assignment so the next free box can pick it up.
//   This catches the case where a box is alive (heartbeats work) but
//   one of its ffmpeg workers is dead / not yielding frames.
//
// Both thresholds feed the unassigned pool; assignUnassigned() runs at
// the end of every tick to refill live boxes.

const BOX_TIMEOUT_MS = Number(process.env.BOX_TIMEOUT_MS) || 120_000; // 2 min
const STALE_SECTION_MS = Number(process.env.STALE_SECTION_MS) || 10_000; // 10 s
const GC_INTERVAL_MS = Number(process.env.GC_INTERVAL_MS) || 5_000; // 5 s

export function gcOnce() {
  const now = Date.now();

  // 1. Dead boxes.
  const dead = stmt.boxesDeadBefore.all(now - BOX_TIMEOUT_MS) as Array<{ ip: string }>;
  for (const d of dead) {
    stmt.boxDelete.run(d.ip);
    console.log(`[gc] removed dead box ${d.ip} (no heartbeat in >${BOX_TIMEOUT_MS}ms)`);
  }

  // 2. Stale sections (per-assignment liveness).
  const stale = stmt.assignStaleSections.all(now - STALE_SECTION_MS) as Array<{ section_id: string }>;
  for (const s of stale) stmt.assignDelete.run(s.section_id);
  if (stale.length) {
    console.log(`[gc] dropped ${stale.length} stale assignment(s) (no metric in >${STALE_SECTION_MS}ms)`);
  }

  // 3. Refill.
  const { assigned, stillUnassigned } = assignUnassigned();
  if (assigned || stillUnassigned) {
    console.log(`[gc] reassigned ${assigned}; ${stillUnassigned} still unassigned`);
  }
}

export function startGcLoop() {
  gcOnce();
  setInterval(() => {
    try {
      gcOnce();
    } catch (e) {
      console.error("[gc] tick failed", e);
    }
  }, GC_INTERVAL_MS).unref();
}
