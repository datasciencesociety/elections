## Why

The API currently returns only nationwide aggregated results per election. Users cannot filter or drill down into results by geographic level — RIK, district, municipality, kmetstvo, or local region — even though the database already contains full geographic linkage through the `locations`, `sections`, `riks`, `districts`, `municipalities`, `kmetstva`, and `local_regions` tables. Adding location-based filtering unlocks the core analytical value of the platform: comparing how different regions voted.

## What Changes

- Add query-parameter-based geographic filtering to the existing `GET /api/elections/:id/results` endpoint, supporting: `rik`, `district`, `municipality`, `kmetstvo`, and `local_region` filters by ID.
- Add new `GET /api/geography/:type` endpoints to list available geographic entities (riks, districts, municipalities, kmetstva, local regions) so the frontend can populate filter controls.
- Add a location filter UI to the election results page — dropdowns for each geographic level with cascading narrowing (selecting a district narrows municipality options, etc.).
- No changes to `elections.db` schema — all required geographic linkage already exists in the `locations` and `sections` tables.

## Capabilities

### New Capabilities
- `location-filter`: API and UI support for filtering election results by geographic level (RIK, district, municipality, kmetstvo, local region), including geography listing endpoints and cascading filter controls.

### Modified Capabilities

## Impact

- **API** (`server/src/routes/elections.ts`): The results query gains WHERE clauses joining through `sections` → `locations` to filter by geographic foreign keys. New geography listing route file added.
- **Frontend** (`web/src/pages/election-results.tsx`): Filter UI added with dropdowns; fetches geography lists and re-fetches results on filter change.
- **Database schema**: No changes. Existing `locations` table already has `rik_id`, `district_id`, `municipality_id`, `kmetstvo_id`, and `local_region_id` foreign keys. Sections link to locations via `location_id`.
- **Performance**: Filtered queries touch indexed foreign keys and should remain fast. Consider adding a composite index on `sections(election_id, location_id)` if needed.
