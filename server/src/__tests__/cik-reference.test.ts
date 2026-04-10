/**
 * CIK reference validation — API edition.
 *
 * For every election in `data/cik_reference.json` (the official results
 * scraped from results.cik.bg), assert that the public API endpoints return
 * numbers matching CIK. This is the API parity twin of `validate_cik.py`:
 * the Python script reads votes/protocols directly, this suite reads them
 * via the same surface that web clients hit.
 *
 * What's checked, per election:
 *   1. GET /api/elections/:id/results
 *      - every CIK-listed party (by ballot number) matches within tolerance
 *      - sum of API total_votes matches sum of CIK named-party votes
 *   2. GET /api/elections/:id/turnout?group_by=rik
 *      - totals.registered_voters == cik protocol.registered (when present)
 *      - totals.actual_voters == cik protocol.actual (when present)
 *   3. GET /api/elections/:id/sections/geo
 *      - returns sections for the right election (smoke check)
 *
 * Tolerance policy: 0.00% drift, every election. Any mismatch is a real
 * data bug — fix the parser/normalizer, not the test threshold. Empty-name
 * "ghost" CIK entries (CIK lists ballots with no party label) are filtered
 * out before comparison; orphan named ballots that the parties pipeline
 * dropped fail loudly.
 *
 * Coverage: 18/18 elections (all elections in the DB have a reference entry
 * after the mi2023 scrape).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import app from "../app.js";
import getDb from "../db.js";

interface CikParty {
  name: string;
  votes: number;
}

interface CikProtocol {
  sections: number;
  registered: number;
  actual: number;
  invalid: number;
  null_votes: number;
}

interface CikReference {
  name: string;
  protocol?: CikProtocol;
  party_votes_total: number;
  parties: Record<string, CikParty>;
}

const REF_PATH = resolve(import.meta.dirname, "../../../data/cik_reference.json");
const refRaw = JSON.parse(readFileSync(REF_PATH, "utf-8")) as Record<string, CikReference>;

// Drop comment keys (e.g. "_meta", "_notes") and pick the slug list once.
const REF_SLUGS: string[] = Object.keys(refRaw).filter((slug) => !slug.startsWith("_"));

if (REF_SLUGS.length === 0) {
  throw new Error("cik_reference.json contains no election entries");
}

// We strive for 0.00% drift against CIK on every election. Any mismatch is
// a data bug to fix, not a tolerance to widen.
function exactMatch(actual: number, expected: number): boolean {
  return actual === expected;
}

/** Drop CIK ghost entries with empty names (see top-of-file comment). */
function namedParties(ref: CikReference): { ballot: number; name: string; votes: number }[] {
  return Object.entries(ref.parties)
    .map(([ballotStr, party]) => ({
      ballot: Number(ballotStr),
      name: party.name.trim(),
      votes: party.votes,
    }))
    .filter((p) => p.name.length > 0);
}

interface ElectionRow {
  id: number;
  slug: string;
  name: string;
  type: string;
}

let electionBySlug: Map<string, ElectionRow>;
const ballotMaps = new Map<number, Map<number, number>>();

function getBallotMap(electionId: number): Map<number, number> {
  let cached = ballotMaps.get(electionId);
  if (cached) return cached;
  const rows = getDb()
    .prepare(
      "SELECT ballot_number, party_id FROM election_parties WHERE election_id = ?",
    )
    .all(electionId) as { ballot_number: number; party_id: number }[];
  cached = new Map(rows.map((r) => [r.ballot_number, r.party_id] as const));
  ballotMaps.set(electionId, cached);
  return cached;
}

beforeAll(() => {
  const rows = getDb()
    .prepare("SELECT id, slug, name, type FROM elections")
    .all() as ElectionRow[];
  electionBySlug = new Map(rows.map((r) => [r.slug, r] as const));

  // Sanity: every reference entry must exist in the DB. If a slug is in the
  // reference but missing from the DB, the rebuild dropped an election —
  // catch that loudly rather than silently skipping.
  const missing = REF_SLUGS.filter((slug) => !electionBySlug.has(slug));
  if (missing.length > 0) {
    throw new Error(
      `cik_reference contains elections that are not in the DB: ${missing.join(", ")}`,
    );
  }
});

describe("CIK reference validation — API parity with cik_reference.json", () => {
  describe.each(REF_SLUGS)("%s", (slug) => {
    const ref = refRaw[slug];
    let electionId: number;
    let electionType: string;

    beforeAll(() => {
      const election = electionBySlug.get(slug)!;
      electionId = election.id;
      electionType = election.type;
    });

    it("GET /:id/results — every CIK party (grouped by canonical party_id) matches exactly", async () => {
      const res = await app.request(`/api/elections/${electionId}/results`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: { party_id: number; party_name: string; total_votes: number }[];
      };

      const apiByPartyId = new Map(body.results.map((r) => [r.party_id, r.total_votes]));
      const ballotMap = getBallotMap(electionId);

      // Group CIK ballots by canonical party_id. In local elections (especially
      // kmetstvo) the same canonical party can show up under multiple ballot
      // numbers — `normalize_parties.py` deduplicates them, so a fair
      // comparison sums the CIK votes for all ballots that map to the same
      // party_id and compares against the API's grouped total.
      type Group = { partyId: number; cikVotes: number; ballots: { ballot: number; name: string; votes: number }[] };
      const cikGroups = new Map<number, Group>();
      const orphanBallots: { ballot: number; name: string }[] = [];
      for (const party of namedParties(ref)) {
        const partyId = ballotMap.get(party.ballot);
        if (partyId === undefined) {
          orphanBallots.push({ ballot: party.ballot, name: party.name });
          continue;
        }
        const g = cikGroups.get(partyId);
        if (g) {
          g.cikVotes += party.votes;
          g.ballots.push(party);
        } else {
          cikGroups.set(partyId, { partyId, cikVotes: party.votes, ballots: [party] });
        }
      }

      const mismatches: string[] = [];

      // Orphan ballots — CIK lists them but `normalize_parties.py` never
      // produced an `election_parties` row. Real data bug; fail loudly.
      for (const o of orphanBallots) {
        mismatches.push(`${slug} ballot #${o.ballot} "${o.name}" missing from election_parties`);
      }

      for (const g of cikGroups.values()) {
        const apiVotes = apiByPartyId.get(g.partyId) ?? 0;
        if (!exactMatch(apiVotes, g.cikVotes)) {
          const diff = apiVotes - g.cikVotes;
          const pct = g.cikVotes > 0 ? ((Math.abs(diff) / g.cikVotes) * 100).toFixed(2) : "n/a";
          const ballotList = g.ballots.map((b) => `#${b.ballot}`).join("+");
          const sample = g.ballots[0]?.name ?? "";
          mismatches.push(
            `${slug} party_id=${g.partyId} ballots ${ballotList} "${sample}": api=${apiVotes} cik=${g.cikVotes} diff=${diff} (${pct}%)`,
          );
        }
      }

      expect(mismatches, `\n${mismatches.join("\n")}`).toEqual([]);
    });

    it("GET /:id/results — sum of named-party totals matches CIK exactly", async () => {
      const res = await app.request(`/api/elections/${electionId}/results`);
      const body = (await res.json()) as {
        results: { party_id: number; total_votes: number }[];
      };

      const ballotMap = getBallotMap(electionId);
      const namedPartyIds = new Set<number>();
      for (const party of namedParties(ref)) {
        const pid = ballotMap.get(party.ballot);
        if (pid !== undefined) namedPartyIds.add(pid);
      }

      const apiNamedTotal = body.results
        .filter((r) => namedPartyIds.has(r.party_id))
        .reduce((sum, r) => sum + r.total_votes, 0);
      const cikNamedTotal = namedParties(ref).reduce((sum, p) => sum + p.votes, 0);

      const diff = apiNamedTotal - cikNamedTotal;
      const pct = cikNamedTotal > 0 ? ((Math.abs(diff) / cikNamedTotal) * 100).toFixed(2) : "n/a";
      expect(
        apiNamedTotal,
        `${slug} (${electionType}): api named-total=${apiNamedTotal} cik named-total=${cikNamedTotal} diff=${diff} (${pct}%)`,
      ).toBe(cikNamedTotal);
    });

    it("GET /:id/turnout?group_by=rik — registered + actual match CIK exactly", async () => {
      const protocol = ref.protocol;
      // Skip if the reference doesn't have protocol totals (mi2023_*).
      if (!protocol) return;

      const res = await app.request(`/api/elections/${electionId}/turnout?group_by=rik`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totals: { registered_voters: number; actual_voters: number };
      };

      expect(body.totals.registered_voters).toBe(protocol.registered);
      expect(body.totals.actual_voters).toBe(protocol.actual);
    });

    it("GET /:id/sections/geo — returns sections (geo endpoint wired and matching election)", async () => {
      const res = await app.request(`/api/elections/${electionId}/sections/geo`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        election: { id: number };
        sections: { section_code: string }[];
      };

      expect(body.election.id).toBe(electionId);
      expect(body.sections.length).toBeGreaterThan(0);
    });
  });
});
