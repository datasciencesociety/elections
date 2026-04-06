import { describe, it, expect } from "vitest";
import app from "../app.js";

// Use election 10 (Кмет кметство 05.11.2023) for performance tests —
// it has only 1626 vote rows and runs fast (<1s).
// Election 1 (Народно събрание 27.10.2024) has 362K rows and is slow.
const FAST_ELECTION_ID = 10;

describe("GET /api/elections/:id/results/geo", () => {
  it("returns 400 for non-numeric election ID", async () => {
    const res = await app.request("/api/elections/abc/results/geo");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 404 for non-existent election", async () => {
    const res = await app.request("/api/elections/999999/results/geo");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 200 with election and municipalities for valid election", async () => {
    const res = await app.request(`/api/elections/${FAST_ELECTION_ID}/results/geo`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("municipalities");
    expect(body.election.id).toBe(FAST_ELECTION_ID);
    expect(Array.isArray(body.municipalities)).toBe(true);
    expect(body.municipalities.length).toBeGreaterThan(0);
  });

  it("each municipality has required fields", async () => {
    const res = await app.request(`/api/elections/${FAST_ELECTION_ID}/results/geo`);
    const body = await res.json();
    const muni = body.municipalities[0];
    expect(muni).toHaveProperty("id");
    expect(muni).toHaveProperty("name");
    expect(muni).toHaveProperty("geo");
    expect(muni).toHaveProperty("total_votes");
    expect(muni).toHaveProperty("winner");
    expect(muni).toHaveProperty("parties");
    expect(typeof muni.id).toBe("number");
    expect(typeof muni.name).toBe("string");
    expect(typeof muni.total_votes).toBe("number");
  });

  it("geo field is a valid GeoJSON geometry object", async () => {
    const res = await app.request(`/api/elections/${FAST_ELECTION_ID}/results/geo`);
    const body = await res.json();
    const muni = body.municipalities.find((m: any) => m.total_votes > 0);
    expect(muni).toBeDefined();
    expect(muni.geo).toHaveProperty("type");
    expect(muni.geo).toHaveProperty("coordinates");
    expect(Array.isArray(muni.geo.coordinates)).toBe(true);
  });

  it("municipalities with votes have winner with correct shape", async () => {
    const res = await app.request(`/api/elections/${FAST_ELECTION_ID}/results/geo`);
    const body = await res.json();
    const muniWithVotes = body.municipalities.filter((m: any) => m.total_votes > 0);
    expect(muniWithVotes.length).toBeGreaterThan(0);
    for (const muni of muniWithVotes.slice(0, 5)) {
      expect(muni.winner).not.toBeNull();
      expect(muni.winner).toHaveProperty("party_id");
      expect(muni.winner).toHaveProperty("name");
      expect(muni.winner).toHaveProperty("color");
      expect(muni.winner).toHaveProperty("votes");
      expect(muni.winner).toHaveProperty("pct");
      expect(typeof muni.winner.party_id).toBe("number");
      expect(typeof muni.winner.votes).toBe("number");
      expect(typeof muni.winner.pct).toBe("number");
    }
  });

  it("municipalities with no votes have null winner and empty parties", async () => {
    const res = await app.request(`/api/elections/${FAST_ELECTION_ID}/results/geo`);
    const body = await res.json();
    const muniNoVotes = body.municipalities.filter((m: any) => m.total_votes === 0);
    // Some municipalities have no votes for this election type (kmetstvo)
    expect(muniNoVotes.length).toBeGreaterThan(0);
    for (const muni of muniNoVotes) {
      expect(muni.winner).toBeNull();
      expect(Array.isArray(muni.parties)).toBe(true);
      expect(muni.parties.length).toBe(0);
    }
  });

  it("parties array is sorted by votes descending", async () => {
    const res = await app.request(`/api/elections/${FAST_ELECTION_ID}/results/geo`);
    const body = await res.json();
    const muniWithMultipleParties = body.municipalities.filter((m: any) => m.parties.length > 1);
    expect(muniWithMultipleParties.length).toBeGreaterThan(0);
    const muni = muniWithMultipleParties[0];
    for (let i = 1; i < muni.parties.length; i++) {
      expect(muni.parties[i - 1].votes).toBeGreaterThanOrEqual(muni.parties[i].votes);
    }
  });

  it("winner matches the first party in parties array", async () => {
    const res = await app.request(`/api/elections/${FAST_ELECTION_ID}/results/geo`);
    const body = await res.json();
    const muniWithVotes = body.municipalities.filter((m: any) => m.total_votes > 0);
    for (const muni of muniWithVotes.slice(0, 5)) {
      expect(muni.winner.party_id).toBe(muni.parties[0].party_id);
      expect(muni.winner.votes).toBe(muni.parties[0].votes);
    }
  });

  it("party percentages are computed correctly", async () => {
    const res = await app.request(`/api/elections/${FAST_ELECTION_ID}/results/geo`);
    const body = await res.json();
    const muniWithVotes = body.municipalities.filter((m: any) => m.parties.length > 0);
    for (const muni of muniWithVotes.slice(0, 3)) {
      for (const party of muni.parties) {
        const expected = Math.round((party.votes / muni.total_votes) * 10000) / 100;
        expect(party.pct).toBeCloseTo(expected, 1);
      }
    }
  });

  it("returns all municipalities with non-null geo", async () => {
    const res = await app.request(`/api/elections/${FAST_ELECTION_ID}/results/geo`);
    const body = await res.json();
    // Should have all municipalities with geo (265 in DB)
    expect(body.municipalities.length).toBeGreaterThanOrEqual(200);
  });

  it("election metadata has correct shape", async () => {
    const res = await app.request(`/api/elections/${FAST_ELECTION_ID}/results/geo`);
    const body = await res.json();
    expect(body.election).toHaveProperty("id");
    expect(body.election).toHaveProperty("name");
    expect(body.election).toHaveProperty("date");
    expect(body.election).toHaveProperty("type");
    expect(body.election.id).toBe(FAST_ELECTION_ID);
  });
});
