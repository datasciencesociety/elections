## Why

The platform shows election results (party votes) but not voter turnout — a key civic metric. The `protocols` table already contains `registered_voters` and `actual_voters` per section, making turnout data readily available. Exposing turnout by geography helps users understand participation patterns across regions and elections.

## What Changes

- Add `GET /api/elections/:id/turnout` endpoint that aggregates `registered_voters` and `actual_voters` from the `protocols` table, returning turnout percentage grouped by a configurable geographic level (district, municipality, etc.)
- Support the same geographic filter query parameters as existing endpoints (rik, district, municipality, kmetstvo, local_region) for drilling down
- Add a `groupBy` query parameter to control the aggregation level for the bar chart (e.g., group by district, municipality)
- Add `/turnout/:id` frontend route with a bar chart showing turnout % by geographic unit
- Reuse the existing `LocationFilter` component for geographic drill-down
- Stretch: Add turnout comparison across multiple elections (similar to existing `/compare` pattern)

## Capabilities

### New Capabilities
- `turnout-api`: Backend endpoint for voter turnout aggregation from protocols table with geographic filtering and grouping
- `turnout-dashboard`: Frontend page with bar chart visualization of turnout data, reusing LocationFilter

### Modified Capabilities

## Impact

- **Database**: No schema changes — reads existing `protocols` table (registered_voters, actual_voters columns) joined with `sections` and `locations` for geography
- **API**: New route added to `server/src/routes/elections.ts` (or new `turnout.ts` route file)
- **Frontend**: New page `web/src/pages/turnout.tsx`, new route in `web/src/main.tsx`
- **Dependencies**: May need a charting library (e.g., recharts) for bar chart — check if one is already in `package.json`
