## Why

The platform has rich election data but no geographic visualization — users cannot see at a glance which party won in which municipality. A choropleth map is the most intuitive way to explore election results spatially and is the flagship feature for the April 17 deadline. The database already stores municipality-level GeoJSON geometry in the `municipalities.geo` column, making this feasible without external tile services.

## What Changes

- Add **API endpoint** `GET /api/elections/:id/results/geo` returning municipality-level aggregated vote results with GeoJSON geometry, winning party, and party breakdown per municipality
- Add **map page** at `/map/:electionId` with a full-screen MapLibre GL choropleth of Bulgaria, municipalities colored by winning party's color
- Add **click interaction** — clicking a municipality shows a popup/sidebar with party-level vote breakdown (votes, percentages, bar chart)
- Add **election selector** dropdown in the top corner to switch between elections without leaving the map
- Add **route and navigation** — new route in the app router, link in the nav/election list page

## Capabilities

### New Capabilities
- `geo-results-api`: API endpoint that joins votes, election_parties, parties, and municipalities to return municipality-level aggregated results with GeoJSON geometry
- `election-map`: Full-screen MapLibre choropleth map page with municipality coloring by winning party, click-to-drill-down popup, and election selector

### Modified Capabilities

_(none — no existing spec requirements change)_

## Impact

- **Database**: No schema changes. Reads from existing `votes`, `sections`, `locations`, `municipalities`, `election_parties`, `parties` tables. Uses `municipalities.geo` column for geometry and `parties.color` for choropleth fill.
- **API**: New route file or addition to `server/src/routes/elections.ts`, registered in `app.ts`
- **Frontend**: New page component `web/src/pages/election-map.tsx`, new route `/map/:electionId` in `main.tsx`, navigation link from election list
- **Dependencies**: Uses existing MapLibre GL (already in `web/` dependencies). No new dependencies needed.
