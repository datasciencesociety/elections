## Context

The platform stores election results at polling-section granularity with full geographic linkage already in place. The `sections` table connects each section to a `location_id`, and the `locations` table carries foreign keys to `rik_id`, `district_id`, `municipality_id`, `kmetstvo_id`, and `local_region_id`. The current API aggregates votes nationally — it sums all votes for an election without any geographic WHERE clause. The frontend has no filter controls.

## Goals / Non-Goals

**Goals:**
- Allow filtering election results by any single geographic level via query parameters on the existing results endpoint.
- Provide geography listing endpoints so the frontend can populate filter dropdowns.
- Support cascading filters in the UI (selecting a district narrows available municipalities).
- Maintain backward compatibility — no query params returns national totals as before.

**Non-Goals:**
- Multi-level intersection filters (e.g. filtering by both RIK and municipality simultaneously) — single filter at a time is sufficient for v1.
- Map-based geographic selection (MapLibre integration is a separate effort).
- Protocol-level data (turnout, invalid votes) per geography — only party vote totals.
- Modifying the data pipeline or `elections.db` schema.

## Decisions

### 1. Filter via query parameters on existing endpoint

**Decision**: Add optional query parameters (`rik`, `district`, `municipality`, `kmetstvo`, `local_region`) to `GET /api/elections/:id/results` rather than creating separate endpoints per geography level.

**Rationale**: One endpoint keeps the API surface small. The parameters are mutually exclusive — only one filter applies at a time. If multiple are provided, use the most specific one (kmetstvo > local_region > municipality > district > rik).

**Alternative considered**: Separate endpoints like `/api/elections/:id/results/by-rik/:rikId`. Rejected because it multiplies routes without adding clarity — query params are idiomatic for filtering.

### 2. JOIN path: votes → sections → locations → geography

**Decision**: Filter by joining `votes` to `sections` (on `election_id` + `section_code`), then `sections` to `locations` (on `location_id`), then filtering on the relevant `locations` foreign key.

**Rationale**: This follows the existing relational structure. The `locations` table already has all five geographic foreign keys. No denormalization needed.

**Alternative considered**: Denormalize geographic IDs onto the `votes` table. Rejected — requires schema change and data migration for a query that is already straightforward with joins.

### 3. Geography listing as a new route file

**Decision**: Create `server/src/routes/geography.ts` with endpoints:
- `GET /api/geography/riks` — list all RIKs
- `GET /api/geography/districts` — list all districts
- `GET /api/geography/municipalities?district=<id>` — list municipalities, optionally filtered by district
- `GET /api/geography/kmetstva?municipality=<id>` — list kmetstva, optionally filtered by municipality
- `GET /api/geography/local-regions?municipality=<id>` — list local regions, optionally filtered by municipality

**Rationale**: Separating geography routes keeps `elections.ts` focused. Optional parent-level filters enable cascading dropdowns without multiple round-trips.

### 4. Frontend: filter bar component above results table

**Decision**: Add a `LocationFilter` component to the election results page with a row of `<select>` dropdowns. Selecting a higher-level geography fetches and populates child dropdowns. Changing any filter re-fetches results.

**Rationale**: Dropdowns are the simplest appropriate UI for a small number of geographic entities (32 RIKs, 28 districts, 265 municipalities). No search or autocomplete needed at this scale.

### 5. URL state for filters

**Decision**: Store the active filter in URL search params (e.g. `?municipality=42`) so filtered views are shareable and bookmarkable.

**Rationale**: Users sharing links to specific regional results is a core use case for civic data.

## Risks / Trade-offs

- **[Query performance]** Joining votes → sections → locations adds overhead vs. the current direct aggregation. → Mitigation: The join keys are integer foreign keys. Add index on `sections(election_id, location_id)` if query time exceeds 200ms. SQLite handles this scale (~500K section rows) well.
- **[Missing location linkage]** Some sections (e.g. mobile, ship, abroad) may have NULL geographic foreign keys. → Mitigation: Document that filtering excludes sections without the relevant geographic link. National totals (no filter) remain unchanged.
- **[Local-only geography]** Kmetstva and local regions only exist for local elections. Filtering parliament results by kmetstvo returns empty results. → Mitigation: The frontend can hide irrelevant filter levels based on election type, or simply show empty results with an explanatory note.
