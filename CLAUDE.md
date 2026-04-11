# AI for Transparent Elections — Open Source Project

Civic tech for analyzing Bulgarian election data. Surface anomalies, make official results accessible to observers, journalists, and researchers. Data is public, code is open source.

Started at a one-day hackathon (March 2026); now an ongoing open data project.

## Three doors

The repo has three independent areas. A contributor should be able to work on one without learning the other two.

1. **`data/`** — Python pipeline that builds `elections.db` from raw CIK exports. Touch this if you care about parsers, normalization, validation, or geocoding. See `data/README.md`.
2. **`server/`** — Hono + better-sqlite3 read-only API that serves `elections.db`. Touch this if you care about SQL queries or HTTP endpoints. SQL lives in `server/src/queries/`, route handlers in `server/src/routes/`.
3. **`web/`** — Vite + React + MapLibre frontend. Touch this if you care about UI/UX. All API calls live in `web/src/lib/api/`, all data fetching in `web/src/lib/hooks/`. Components in `web/src/components/` and pages in `web/src/pages/` should not contain `fetch()` calls.

## What we have

- Election results from 2021–2024: parliament, president, european, and local elections (18 elections total).
- All national elections validated against CIK (Central Election Commission) official results — exact match per party + protocol aggregates.
- Geographic normalization: every section mapped to municipality, district, RIK, settlement (EKATTE), and GPS coordinates where available.
- SQLite database (`elections.db`) at the repo root, ~1.4 GB. The pre-built copy ships via GitHub Releases.
- Anomaly scoring: Benford, peer-vote deviation, ACF, protocol arithmetic violations, cross-election persistence.
- Pre-2021 data (back to 1991) exists in maintainer-only context but is not yet validated for public release.

## Project structure

```
elections.db                # SQLite store (pre-built; download from Releases)
data/                       # Python pipeline — see data/README.md
  build.py                  # parallel parser orchestrator
  import.sh                 # one-shot full pipeline
  parsers/                  # one parser file per election group
  validators/               # protocol arithmetic validators
  normalize_*.py            # parties, sections, candidates schema
  validate*.py              # validate_cik.py, validate.py, validate_geocode.py
  link_geography.py         # link locations → municipalities, districts, RIKs
  build_geography.py        # build the geography reference tables
  geocode_google.py         # one-time geocoding (writes location_cache.json)
  score_sections.py         # anomaly scoring + protocol violations
  migrate_schema.py         # WITHOUT ROWID + VACUUM + indexes
  cik-exports/              # raw CIK source data (gitignored)

server/                     # Hono API — read-only, mounts elections.db
  src/
    app.ts                  # Hono app + route mounting
    db.ts                   # better-sqlite3 connection (readonly)
    db/ballot.ts            # shared ballot SQL fragments + helpers
    lib/                    # pure helpers (no SQL)
      get-election.ts       # getElection(db, id) — single source for the 404 guard
      percentages.ts        # largest-remainder rounding
      election-weights.ts   # type × recency weighting for persistence index
    queries/                # SQL functions, one file per topic
      anomalies.ts          # per-election anomaly list
      compare.ts            # cross-election compare
      geo-results.ts        # results by district/municipality/RIK
      persistence.ts        # cross-election persistence index
      sections.ts           # section detail + peer context
      turnout.ts            # turnout by group
      violations.ts         # protocol violations summary + drill-down
    routes/                 # thin Hono handlers — parse → query → shape
      elections.ts
      geography.ts
      parties.ts            # not mounted yet
    __tests__/              # vitest API tests against the live DB

web/                        # Vite + React + MapLibre frontend
  src/
    main.tsx                # router + QueryClientProvider
    lib/
      api/                  # all HTTP — every fetch lives here
        client.ts           # fetch wrapper, base URL, error shape
        types.ts            # all API types
        elections.ts        # listElections, getElection
        anomalies.ts        # getAnomalies
        geo-results.ts      # getDistricts, getMunicipalities, getRiks, getSectionsGeo
        sections.ts         # getSectionDetail, getViolations
        persistence.ts      # getPersistence, getPersistenceDetail
        compare.ts          # getCompare
        turnout.ts
        geography.ts        # geo lookups (riks, districts, municipalities, ...)
      hooks/                # React Query wrappers, one per endpoint group
      cik-links.ts          # CIK protocol/scan URL builders
      analytics.ts          # plausible/page-view tracking
      utils.ts              # cn() and tiny formatters
    components/
      layout.tsx            # nav bar + election selector
      sidebar.tsx
      ballot-list.tsx
      section-preview.tsx
      location-correction.tsx
      ui/                   # base shadcn-style primitives + Map
    pages/
      anomaly-map.tsx       # per-election section map (anomaly-coloured + party-coloured)
      district-pie-map.tsx  # per-election proportional district map
      sections-table.tsx    # sortable filterable section table
      persistence.tsx       # cross-election persistence index
      section-detail.tsx    # single-section drill-down
      missing-coordinates.tsx
```

## Conventions

### Wording
- We surface **anomalies**, not "risks". A statistical signal is not a verdict. Reserve "risk" for editorial summaries written by humans, never for code, UI labels, or filenames.

### Frontend
- **Kebab-case** file names: `anomaly-map.tsx`, `party-bar-chart.tsx`.
- **PascalCase** component exports: `AnomalyMap`, `PartyBarChart`.
- All HTTP lives in `lib/api/`. All fetching state lives in `lib/hooks/`. **No `fetch()` calls in `components/` or `pages/`** — that rule is the load-bearing one for letting a UI/UX contributor work without touching data flow.
- React Query owns loading, error, and cache state.

### Backend
- SQL lives in `server/src/queries/*.ts`. A query function takes `db` plus a typed options object and returns typed rows. No HTTP, no shaping.
- Routes in `server/src/routes/*.ts` parse query params, validate, call a query function, shape the JSON response, and return. No inline SQL.
- Pure helpers (rounding, weighting, the `getElection` 404 guard) live in `server/src/lib/`.

### Python
- Each parser file in `parsers/` writes to its own temp SQLite DB; `build.py` runs them in parallel and merges.
- Normalization steps run sequentially after parse — see `data/import.sh` for the canonical order.
- The pipeline is the source of truth; we don't keep "fix-after-the-fact" scripts. If something is wrong in the output, fix it in the parser or normalizer that produced it.

## Repositories & sync

- **Primary development:** `origin` → `georgialexandrov/bg-elections-data` (deploys from here).
- **Organization repo:** `datasciencesociety` → `datasciencesociety/elections` (branch: `feature/web-visualize`).
- Work happens on `georgialexandrov`. Periodically sync to `datasciencesociety`:
  `git push datasciencesociety main:feature/web-visualize`

## Stack

- **Data:** Python 3.10+, SQLite, no ORM.
- **Server:** TypeScript, Hono, better-sqlite3, vitest, tsx.
- **Web:** TypeScript, React 19, Vite 6, MapLibre GL, React Query, Tailwind v4.
- **Infra:** Docker container, deployed via the workflows in `.github/`.

## `.internal/` directory

Gitignored. Contains the internal-only build pipeline (`.internal/import.sh`), maintainer planning notes, additional CIK exports for the pre-2021 era, and LLM context files. Nothing in `.internal/` is required to run the public pipeline (`data/import.sh`) or to build/run the server and web frontend against the released `elections.db`.

## Georgi's focus

Statistical anomaly detection + UI that lets a non-statistician understand what's flagged and why. The audio/video pipeline from the hackathon (`transcribe.py`, phrase-based scoring) works but is not the current priority.
