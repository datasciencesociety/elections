## Why

The election data currently lives in SQLite with no way for end users to browse it in a browser. Adding a minimal API + SPA scaffold proves the data-to-browser pipeline works and provides a foundation for richer visualizations later (maps, charts). Starting with a thin vertical slice (list elections, view one election's results) keeps scope small while validating the full stack.

## What Changes

- Add a **Hono** web server (`server/`) that reads `elections.db` via `better-sqlite3` and exposes two JSON endpoints:
  - `GET /api/elections` — list all elections (id, name, date, type)
  - `GET /api/elections/:id/results` — votes per party for one election
- Add a **Vite + React + React Router** SPA (`web/`) that:
  - Fetches the election list from the API
  - Navigates to an election detail page showing votes per party in an HTML table
- Wire Hono to serve the Vite build output for non-API routes (SPA fallback)
- Add a dev workflow: Vite dev server proxies `/api` to Hono

## Capabilities

### New Capabilities
- `election-api`: HTTP JSON API for reading election results from SQLite
- `election-spa`: Browser UI that lists elections and renders a results table

### Modified Capabilities

_(none — no changes to existing specs)_

## Impact

- **No schema changes** to `elections.db`. Read-only queries against existing `elections`, `votes`, and `parties` tables.
- **New dependencies**: `hono`, `better-sqlite3`, `react`, `react-dom`, `react-router`, `vite`, plus TypeScript tooling.
- **New directories**: `server/` (API), `web/` (SPA).
- **Build / run**: New `package.json` at root (or workspace) with `dev` and `build` scripts. No effect on existing Python data pipeline.
