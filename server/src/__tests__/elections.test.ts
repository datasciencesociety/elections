import { describe, it, expect } from "vitest";
import app from "../app.js";

describe("GET /api/elections", () => {
  it("returns 200 with a JSON array of elections", async () => {
    const res = await app.request("/api/elections");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    for (const election of body) {
      expect(election).toHaveProperty("id");
      expect(election).toHaveProperty("name");
      expect(election).toHaveProperty("date");
      expect(election).toHaveProperty("type");
    }
  });
});

describe("GET /api/elections/:id/results", () => {
  it("returns 200 with valid results for every election", async () => {
    const listRes = await app.request("/api/elections");
    const elections = await listRes.json();

    for (const election of elections) {
      const res = await app.request(`/api/elections/${election.id}/results`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty("election");
      expect(body).toHaveProperty("results");
      expect(body.election.id).toBe(election.id);
      expect(Array.isArray(body.results)).toBe(true);

      // Validate result entry structure
      for (const result of body.results) {
        expect(typeof result.party_id).toBe("number");
        expect(typeof result.party_name).toBe("string");
        expect(typeof result.total_votes).toBe("number");
        expect(result.total_votes).toBeGreaterThanOrEqual(0);
      }
    }
  }, 120_000);

  it("returns 404 for non-existent election", async () => {
    const res = await app.request("/api/elections/999999/results");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});
