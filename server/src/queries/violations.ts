import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Protocol violation queries.
 *
 * Two views:
 *  - per-election summary (counts by rule + total sections affected)
 *  - per-section drill-down (every violation with expected vs actual values)
 */

export interface ViolationRow {
  rule_id: string;
  description: string;
  expected_value: string | null;
  actual_value: string | null;
  severity: string;
}

export interface ViolationSummaryRow {
  rule_id: string;
  severity: string;
  count: number;
  sections_affected: number;
}

export interface ViolationSummary {
  sections_with_violations: number;
  total_violations: number;
  rules: ViolationSummaryRow[];
}

export function getSectionViolations(
  db: DatabaseType,
  electionId: number | string,
  sectionCode: string,
): ViolationRow[] {
  return db
    .prepare(
      `SELECT rule_id, description, expected_value, actual_value, severity
         FROM protocol_violations
         WHERE election_id = ? AND section_code = ?
         ORDER BY rule_id`,
    )
    .all(electionId, sectionCode) as ViolationRow[];
}

export function getViolationsSummary(
  db: DatabaseType,
  electionId: number | string,
): ViolationSummary {
  const rules = db
    .prepare(
      `SELECT rule_id, severity, COUNT(*) as count,
              COUNT(DISTINCT section_code) as sections_affected
         FROM protocol_violations
         WHERE election_id = ?
         GROUP BY rule_id, severity
         ORDER BY rule_id`,
    )
    .all(electionId) as ViolationSummaryRow[];

  const totals = db
    .prepare(
      `SELECT COUNT(DISTINCT section_code) as sections_with_violations,
              COUNT(*) as total_violations
         FROM protocol_violations
         WHERE election_id = ?`,
    )
    .get(electionId) as {
    sections_with_violations: number;
    total_violations: number;
  };

  return { ...totals, rules };
}
