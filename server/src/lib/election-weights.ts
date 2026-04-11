import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Election weights for the cross-election persistence index.
 *
 * A section flagged across many elections is a stronger signal than one
 * flagged once. We weight each election by:
 *
 *   weight = type_weight × recency_weight
 *
 * - type_weight reflects how much we trust the methodology for that election
 *   type. National elections (parliament, president, european) get full
 *   weight; local mayor/council elections are noisier and get 0.7; tiny
 *   kmetstvo / neighbourhood mayor races are extremely noisy and get 0.4.
 * - recency_weight is a linear ramp from 0.6 (oldest in the dataset) to 1.0
 *   (newest), so older flags decay slightly without being ignored.
 *
 * Returns a per-election weight map plus a SQL fragment that callers can
 * inline into their persistence query.
 */

export interface ElectionRow {
  id: number;
  name: string;
  date: string;
  type: string;
}

const TYPE_WEIGHTS: Record<string, number> = {
  parliament: 1.0,
  president: 1.0,
  european: 1.0,
  local_council: 0.7,
  local_mayor: 0.7,
  local_mayor_kmetstvo: 0.4,
  local_mayor_neighbourhood: 0.4,
};

const DEFAULT_TYPE_WEIGHT = 0.7;

export interface ElectionWeights {
  rows: ElectionRow[];
  weights: Map<number, number>;
  /** Inlinable `CASE ss.election_id WHEN ... THEN ... END` SQL fragment. */
  sqlExpr: string;
}

export function computeElectionWeights(db: DatabaseType): ElectionWeights {
  const rows = db
    .prepare("SELECT id, name, date, type FROM elections ORDER BY date")
    .all() as ElectionRow[];

  const dates = rows.map((e) => new Date(e.date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const dateRange = maxDate - minDate || 1;

  const weights = new Map<number, number>();
  for (const e of rows) {
    const typeW = TYPE_WEIGHTS[e.type] ?? DEFAULT_TYPE_WEIGHT;
    const recencyW =
      0.6 + 0.4 * ((new Date(e.date).getTime() - minDate) / dateRange);
    weights.set(e.id, typeW * recencyW);
  }

  const cases = rows
    .map((e) => `WHEN ${e.id} THEN ${weights.get(e.id)!.toFixed(4)}`)
    .join(" ");
  const sqlExpr = `CASE ss.election_id ${cases} ELSE ${DEFAULT_TYPE_WEIGHT} END`;

  return { rows, weights, sqlExpr };
}
