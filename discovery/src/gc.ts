import { stmt } from "./db.js";
import { assignUnassigned } from "./assign.js";

// Heartbeat timeout: a box that hasn't checked in for this long is declared
// dead. ON DELETE CASCADE on assignments frees its sections back into the
// unassigned pool; the next GC tick reassigns them to live boxes.
const BOX_TIMEOUT_MS = Number(process.env.BOX_TIMEOUT_MS) || 120_000; // 2 min
const GC_INTERVAL_MS = Number(process.env.GC_INTERVAL_MS) || 30_000; // 30 s

export function gcOnce() {
  const threshold = Date.now() - BOX_TIMEOUT_MS;
  const dead = stmt.boxesDeadBefore.all(threshold) as Array<{ ip: string }>;
  for (const d of dead) {
    stmt.boxDelete.run(d.ip);
    console.log(`[gc] removed dead box ${d.ip} (no heartbeat in >${BOX_TIMEOUT_MS}ms)`);
  }
  const { assigned, stillUnassigned } = assignUnassigned();
  if (assigned || stillUnassigned) {
    console.log(`[gc] reassigned ${assigned} section(s); ${stillUnassigned} still unassigned`);
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
