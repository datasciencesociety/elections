## Why

The platform currently focuses on per-election views but offers no way to explore a single party's performance over time. Users clicking a party name in election results hit a dead end. A party profile page would let citizens, journalists, and researchers track how any party or coalition has performed across all 18+ elections — revealing trends, coalition histories, and regional strengths at a glance.

## What Changes

- Add a **party profile page** at `/parties/:id` showing:
  - Party metadata: canonical name, short name, type (party/coalition/initiative committee), color, Wikipedia link
  - Coalition membership: which coalitions the party belongs to, or which parties form it (from `coalition_members`)
  - Historical results table: votes and percentage per election (derived from `votes` + `election_parties` + `protocols`)
  - Trend line chart: vote share over time using the party's color from `parties.color`
  - Names on ballot per election (from `election_parties.name_on_ballot`)
- Add a **party list page** at `/parties` for browsing/searching all parties
- Add **API endpoints** under `/api/parties`:
  - `GET /api/parties` — list all parties with metadata
  - `GET /api/parties/:id` — party detail with coalition info and per-election results
- Add **links from election results** to party profile pages (party names become clickable)

## Capabilities

### New Capabilities
- `party-profile`: Party detail page with metadata, coalition membership, historical election results, and trend chart
- `party-list`: Browsable/searchable index of all parties

### Modified Capabilities

_(none — no existing spec requirements change)_

## Impact

- **Database**: No schema changes. Uses existing `parties`, `election_parties`, `coalition_members`, `votes`, and `protocols` tables. The `parties.color` column (currently unused in the app) will be surfaced.
- **API**: New route file `server/src/routes/parties.ts` registered in `app.ts`
- **Frontend**: Two new page components, updates to election results page to add party links, new route entries in `main.tsx`
- **Dependencies**: No new dependencies. Trend chart uses existing Chart.js setup from compare page.
