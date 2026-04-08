# AI for Transparent Elections — Open Source Project

Started at a one-day hackathon on March 28, 2026. Now an ongoing open source / open data project.

## What This Is

A civic tech system for analyzing Bulgarian election data. The goal: detect anomalies, flag suspicious patterns, and make election data accessible to observers, journalists, and researchers — through data analysis tools, a geographic map interface, and automated statistical risk scoring.

The data is public. The code will be open source.

## What We Have

### Data
- Election results from 2021-2024: parliament, president, european, and local elections (18 elections total)
- All data validated against CIK (Central Election Commission) official results
- Geographic normalization: election sections mapped to municipalities, settlements (EKATTE codes), and GPS coordinates
- SQLite database (`elections.db`) at repo root as the normalized store
- GeoJSON files for Bulgaria — oblasts, municipalities, settlements
- Pre-2021 data (back to 1991) exists in `.internal/` but is not yet validated for public release

### Audio / Video (hackathon PoC)
- Two audio samples from vote counting streams, transcribed with Whisper (small and large-v3), WhisperX, and Voxtral
- `transcribe.py` for audio extraction pipeline
- `score_sections.py` for basic phrase-based fraud scoring
- Architecture for volunteer-distributed stream monitoring (see `ARCHITECTURE.md`)

### Map Dashboard (`map-dashboard/`)
- Vite + TypeScript frontend
- Election results rendered on a map of Bulgaria (Leaflet or MapLibre)
- Section-level data with coordinates, filterable by election and party

## Repositories & Sync

- **Primary development:** `origin` → `georgialexandrov/bg-elections-data` (deployment is here)
- **Organization repo:** `datasciencesociety` → `datasciencesociety/elections` (branch: `feature/web-visualize`)
- Work happens on `georgialexandrov`. Periodically sync to `datasciencesociety` with:
  `git push datasciencesociety main:feature/web-visualize`

## Active Work

See `SPEC.md` for full product spec, delivery plan, and API design.

**Current phase:** V1 — proportional split-polygon map for the latest election.
**Deadline:** Ship by ~April 6, 2026. Next elections April 17.
**Approach:** Daily incremental delivery. Start with one election, add more over time.

Two parallel workstreams:
1. **Data correctness** (separate chat) — parsing, normalization, validation of election results
2. **Visualization + API** (this project) — proportional map, results table, anomaly explorer

## Stack

- Data: Python, SQLite, pandas
- Frontend: TypeScript, Vite, Leaflet/MapLibre
- Infra target: static files on GitHub Pages, Cloudflare Workers for any API

## Project Structure

```
elections.db                # validated SQLite database (2021-2024, shipped in repo)
data/                       # validation scripts, reference data, geography, normalization
  validate.py               # protocol arithmetic checks
  validate_cik.py           # per-party vote totals vs CIK official results
  cik_reference.json        # CIK reference data for validation
  geography.sql             # geographic reference tables
  normalize_*.py            # post-import normalization scripts
  cik-exports/              # raw CIK zip archives (gitignored, extracted dirs also gitignored)
server/                     # Express API (better-sqlite3, tsx)
  index.ts                  # all endpoints
map-dashboard/              # frontend — Vite + React + TypeScript + MapLibre
  src/
    lib/
      api/                  # client.ts (static JSON support), endpoints.ts (all API types + calls)
      hooks/                # use-elections, use-geo, use-municipality-results, use-risk-sections, etc.
      utils/                # format.ts, geo-math.ts, party-colors.ts
    components/
      ui/                   # stat, tab-bar, badge, empty-state, section-label
      charts/               # party-bar-chart, sparkline
      map/                  # election-map (MapLibre), map-tooltip, party-legend
    pages/
      map-page/             # map + sidebar + controls; hooks in map-page.hooks.ts
        sidebar/            # municipality-panel, section-panel, results/history/trends tabs
      anomaly-page/         # sortable table of high-risk sections with drill-down
    layout/                 # nav-bar, election-selector
geo/                        # geographic data (EKATTE, municipality, oblast lookups)
openspec/                   # change management (proposals, designs, specs, tasks)
.internal/                  # gitignored — internal docs, build tooling, planning (see below)
  build.py                  # build orchestrator (default: 2021+, --all: 1991-2024)
  import.sh                 # full import pipeline
  parsers/                  # per-election parser modules
  cik-exports/              # extracted CIK data (with encoding fixes)
  elections-calendar.md     # election dates, types, rounds
  release-plan.md           # roadmap and deadlines
  data-sources.md           # CIK URLs and data provenance
  ANOMALY-DATA.md           # anomaly detection data model reference (for LLM context)
```

## Frontend conventions
- **Kebab-case** file names: `election-map.tsx`, `party-bar-chart.tsx`
- **PascalCase** component exports: `ElectionMap`, `PartyBarChart`
- Logic in hooks (`lib/hooks/`) or page-level hooks files, not in components
- API layer in `lib/api/` — `client.ts` handles static JSON mode via `VITE_STATIC=true` + `VITE_API_BASE`

## Production / static JSON
Set `VITE_STATIC=true` and `VITE_API_BASE=https://your-r2-bucket.com` — the client builds URLs as
`${VITE_API_BASE}/elections.json`, `${VITE_API_BASE}/elections/1/results.json` etc.
Pre-export all JSON files from the server using a script (TODO).

## `.internal/` directory

Gitignored. Contains internal documentation, build tooling, and planning docs that are NOT part of the public repo. Use this for:
- LLM context files (data model references, methodology docs, API specs for agent consumption)
- Build scripts and import pipelines
- Planning docs, release plans, data source tracking
- Anything that helps development but shouldn't be in the public repo

When writing documentation intended for LLM/agent context (not for end users), put it in `.internal/`. Key files:
- `.internal/ANOMALY-DATA.md` — full anomaly detection data model: all three methodologies, API response shape, field descriptions, sources

## Georgi's Focus

Statistical anomaly detection algorithms + UI to surface the results. The audio/video pipeline was PoC'd at the hackathon — it works but is not the current priority.
