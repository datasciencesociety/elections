## Context

The platform currently exposes election results (party votes) via `GET /api/elections/:id/results` and comparison via `GET /api/elections/compare`. The `protocols` table stores per-section data including `registered_voters` and `actual_voters`, which is sufficient to compute turnout percentages. The frontend uses React with `chart.js`/`react-chartjs-2` (already installed) and a reusable `LocationFilter` component for geographic drill-down.

## Goals / Non-Goals

**Goals:**
- Expose voter turnout data through a new API endpoint with geographic aggregation
- Render turnout as a horizontal bar chart on a new frontend page
- Reuse existing geographic filtering patterns (LocationFilter, same query params)
- Keep the API shape consistent with existing endpoints

**Non-Goals:**
- Historical trend analysis over time (stretch goal: comparison across elections, but not time-series)
- Map-based turnout visualization (can be added later using existing MapLibre setup)
- Modifying the `protocols` table or any database schema

## Decisions

### 1. API endpoint: `GET /api/elections/:id/turnout`

Add to `server/src/routes/elections.ts` alongside existing routes rather than a separate file, following the existing pattern.

**Query parameters:**
- `group_by` (required): one of `rik`, `district`, `municipality`, `kmetstvo`, `local_region` — determines aggregation level for the bar chart
- Geographic filters: `rik`, `district`, `municipality`, `kmetstvo`, `local_region` — same as existing endpoints, most specific wins

**Response shape:**
```json
{
  "election": { "id": 1, "name": "...", "date": "...", "type": "..." },
  "turnout": [
    {
      "group_id": 1,
      "group_name": "Sofia-grad",
      "registered_voters": 50000,
      "actual_voters": 30000,
      "turnout_pct": 60.0
    }
  ],
  "totals": {
    "registered_voters": 500000,
    "actual_voters": 300000,
    "turnout_pct": 60.0
  }
}
```

**Rationale:** Returning both raw counts and pre-computed percentage keeps the API simple for the frontend while allowing consumers to recompute if needed. The `group_by` parameter avoids needing separate endpoints per geographic level. The `totals` field provides the headline number without extra computation on the client.

**Alternative considered:** Separate `/turnout/by-district`, `/turnout/by-municipality` endpoints — rejected as unnecessarily verbose and inconsistent with the filter-based pattern used elsewhere.

### 2. SQL approach

Join `protocols` → `sections` → `locations` → geography tables, then `GROUP BY` the target geographic entity. This mirrors the join pattern in the existing results endpoint.

```sql
SELECT g.id AS group_id, g.name AS group_name,
       SUM(p.registered_voters) AS registered_voters,
       SUM(p.actual_voters) AS actual_voters
FROM protocols p
JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
JOIN locations l ON l.id = s.location_id
JOIN <geo_table> g ON g.id = l.<geo_column>
WHERE p.election_id = ?
GROUP BY g.id, g.name
ORDER BY group_name
```

The `group_by` param maps to a specific geography table and column. Geographic filters add a `WHERE` clause on the location join.

### 3. Frontend: `/turnout/:id` page

New file `web/src/pages/turnout.tsx` with:
- Dropdown to select `group_by` level (default: `district`)
- `LocationFilter` component for drill-down
- Horizontal `Bar` chart from `react-chartjs-2` showing turnout % per geographic unit
- Summary card showing total registered, actual, and turnout %
- Link from election list page to the turnout page

### 4. Stretch: Turnout comparison

Follow the same pattern as `/api/elections/compare` — accept multiple election IDs and return turnout grouped by geography, so users can compare participation across elections. This would use a similar grouped bar chart with one bar per election.

## Risks / Trade-offs

- **Performance on large aggregations** → The query joins protocols (hundreds of thousands of rows) with sections and locations. Mitigated by SQLite's efficiency on read-only data and the fact that the DB is pre-built. If needed, add an index on `protocols(election_id, section_code)`.
- **Sections without protocols** → Some sections may lack protocol data. The query naturally excludes these since it starts from `protocols`. The `totals` response field reflects only sections with data.
- **Null registered_voters** → Some protocol rows may have NULL for registered_voters. Use `COALESCE(p.registered_voters, 0)` to handle gracefully. Turnout > 100% is possible (added_voters) — display as-is, it's real data.

## Open Questions

- Should the bar chart sort by turnout % descending or alphabetically by region name? (Suggest: default to turnout % desc for easier scanning, with a toggle)
