import { db, stmt } from "./db.js";

// Sticky least-loaded assignment. A section, once assigned, never moves off
// its box except when the box goes away (heartbeat timeout, drain, or
// explicit deregister — all handled via ON DELETE CASCADE on boxes). Adding
// a new box does NOT reshuffle live streams; the new capacity fills with
// whatever's currently unassigned.

interface BoxLoad {
  ip: string;
  capacity: number;
  draining: number;
  load: number;
}

export function assignUnassigned(): { assigned: number; stillUnassigned: number } {
  const unassigned = stmt.sectionsUnassigned.all() as Array<{ id: string; url: string; label: string | null }>;
  if (unassigned.length === 0) return { assigned: 0, stillUnassigned: 0 };

  const boxes = stmt.assignCountByBox.all() as BoxLoad[];
  if (boxes.length === 0) return { assigned: 0, stillUnassigned: unassigned.length };

  let assigned = 0;
  const now = Date.now();

  // Pick least-loaded box on each iteration (via in-memory array — cheaper
  // than re-querying). Update local `load` so subsequent picks reflect the
  // running assignment count.
  db.exec("BEGIN");
  try {
    for (const section of unassigned) {
      // Find the current least-loaded non-saturated box.
      let best: BoxLoad | null = null;
      for (const b of boxes) {
        if (b.load >= b.capacity) continue;
        if (!best || b.load < best.load) best = b;
      }
      if (!best) break; // all boxes at capacity
      stmt.assignPut.run(section.id, best.ip, now);
      best.load += 1;
      assigned += 1;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { assigned, stillUnassigned: unassigned.length - assigned };
}
