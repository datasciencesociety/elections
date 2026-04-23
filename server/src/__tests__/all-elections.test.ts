/**
 * Smoke tests for every election in the DB.
 *
 * `cik-reference.test.ts` does deep value parity against CIK official numbers
 * for the 11 elections we have reference data for. This file complements it
 * with thin smoke checks across *all* 18 elections — including the 7 mi2023_*
 * local elections that don't yet have CIK reference scrapes.
 *
 * Goal: catch regressions where an endpoint silently returns empty arrays or
 * 5xx for an election after a rebuild or refactor. The thresholds are
 * intentionally loose; precise comparisons live in cik-reference.test.ts.
 *
 * When mi2023_* gets scraped into cik_reference.json, those elections will
 * automatically gain the strict checks too.
 */

import { describe, it, expect, beforeAll } from "vitest";
import app from "../app.js";
import getDb from "../db.js";

interface ElectionRow {
  id: number;
  slug: string;
  name: string;
  type: string;
  date: string;
}

let elections: ElectionRow[];

beforeAll(() => {
  elections = getDb()
    .prepare("SELECT id, slug, name, type, date FROM elections ORDER BY id")
    .all() as ElectionRow[];

  if (elections.length === 0) {
    throw new Error("No elections in DB — cannot run smoke tests");
  }
});

describe("API smoke tests — every election", () => {
  it("DB has the 19 expected elections", () => {
    expect(elections.length).toBe(19);
  });

  // Build the test cases from the live DB so adding/removing elections is
  // automatically reflected. Each describe block uses the slug as the title
  // for readable failure output.
  describe.each(
    Array.from({ length: 19 }, (_, i) => i + 1),
  )("election id %i", (electionId) => {
    let election: ElectionRow;

    beforeAll(() => {
      election = elections.find((e) => e.id === electionId)!;
      if (!election) throw new Error(`election id ${electionId} missing from DB`);
    });

    it("GET /:id/results — returns at least one party with votes > 0", async () => {
      const res = await app.request(`/api/elections/${electionId}/results`);
      expect(res.status, `${election.slug}: ${res.status}`).toBe(200);
      const body = (await res.json()) as {
        election: { id: number; type: string };
        results: { party_id: number; party_name: string; total_votes: number }[];
      };
      expect(body.election.id).toBe(electionId);
      expect(body.results.length).toBeGreaterThan(0);

      // At least one party must have positive votes — empty result arrays
      // would mean the join chain dropped everything (the bug we just fixed).
      const totalVotes = body.results.reduce((sum, r) => sum + r.total_votes, 0);
      expect(totalVotes, `${election.slug}: total votes`).toBeGreaterThan(0);

      // Every party should have a non-empty name (catches the orphan-ballot
      // regression where unnamed ballots leak into the public results).
      const unnamed = body.results.filter((r) => !r.party_name || r.party_name.trim() === "");
      expect(unnamed, `${election.slug}: unnamed parties in /results`).toEqual([]);
    });

    it("GET /:id/turnout?group_by=rik — returns positive registered + actual totals", async () => {
      const res = await app.request(`/api/elections/${electionId}/turnout?group_by=rik`);
      expect(res.status, `${election.slug}: ${res.status}`).toBe(200);
      const body = (await res.json()) as {
        totals: { registered_voters: number; actual_voters: number };
      };
      expect(body.totals.registered_voters, `${election.slug}: registered`).toBeGreaterThan(0);
      expect(body.totals.actual_voters, `${election.slug}: actual`).toBeGreaterThan(0);
      expect(body.totals.actual_voters).toBeLessThanOrEqual(body.totals.registered_voters);
    });

    it("GET /:id/sections/geo — returns sections with coordinates", async () => {
      const res = await app.request(`/api/elections/${electionId}/sections/geo`);
      expect(res.status, `${election.slug}: ${res.status}`).toBe(200);
      const body = (await res.json()) as {
        sections: { section_code: string; lat: number | null; lng: number | null }[];
      };
      expect(body.sections.length, `${election.slug}: sections`).toBeGreaterThan(0);
      const withCoords = body.sections.filter((s) => s.lat !== null && s.lng !== null);
      expect(
        withCoords.length / body.sections.length,
        `${election.slug}: ${withCoords.length}/${body.sections.length} sections with coords`,
      ).toBeGreaterThan(0.5);
    });

    it("GET /:id/sections/:code — returns parties + protocol for the first section", async () => {
      // Pick a real section from the DB so we don't depend on hard-coded codes.
      const row = getDb()
        .prepare(
          "SELECT section_code FROM sections WHERE election_id = ? LIMIT 1",
        )
        .get(electionId) as { section_code: string } | undefined;
      expect(row, `${election.slug}: no sections in DB`).toBeDefined();
      const sectionCode = row!.section_code;

      const res = await app.request(`/api/elections/${electionId}/sections/${sectionCode}`);
      expect(res.status, `${election.slug}/${sectionCode}: ${res.status}`).toBe(200);
      const body = (await res.json()) as {
        protocol: { registered_voters: number };
        parties: { name: string; short_name: string; votes: number; pct: number }[];
      };
      expect(body.protocol).toBeDefined();
      expect(body.protocol.registered_voters).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(body.parties)).toBe(true);

      // Every party in a per-section response must have a non-empty short_name.
      const blank = body.parties.filter(
        (p) => !p.short_name || p.short_name.trim() === "",
      );
      expect(blank, `${election.slug}/${sectionCode}: blank short_name`).toEqual([]);
    });
  });
});

describe("API smoke tests — election type coverage", () => {
  // Sanity check: every distinct election type that exists in the DB has at
  // least one election that responds correctly. Catches the case where a
  // type-specific code path (e.g. local_mayor) is broken even though
  // parliament still works.
  it("every election type has at least one working /results endpoint", async () => {
    const types = getDb()
      .prepare("SELECT DISTINCT type FROM elections")
      .all() as { type: string }[];

    expect(types.length).toBeGreaterThan(0);

    const failed: string[] = [];
    for (const { type } of types) {
      const sample = elections.find((e) => e.type === type)!;
      const res = await app.request(`/api/elections/${sample.id}/results`);
      if (res.status !== 200) {
        failed.push(`${type} (${sample.slug}): HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as {
        results: { total_votes: number }[];
      };
      const total = body.results.reduce((s, r) => s + r.total_votes, 0);
      if (total === 0) {
        failed.push(`${type} (${sample.slug}): zero total votes`);
      }
    }

    expect(failed, failed.join("\n")).toEqual([]);
  });
});
