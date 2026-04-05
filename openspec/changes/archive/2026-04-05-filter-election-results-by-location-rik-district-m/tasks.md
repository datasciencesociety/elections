## 1. Geography API Endpoints

- [x] 1.1 Create `server/src/routes/geography.ts` with Hono router exporting endpoints: `GET /riks`, `GET /districts`, `GET /municipalities`, `GET /kmetstva`, `GET /local-regions`
- [x] 1.2 Implement optional parent-level query parameter filtering on child endpoints (`municipalities?district=`, `kmetstva?municipality=`, `local-regions?municipality=`)
- [x] 1.3 Register the geography router in `server/src/app.ts` under `/api/geography`
- [x] 1.4 Write tests for geography endpoints: verify each returns correct fields (`id`, `name`), verify parent filtering narrows results, verify empty filter returns all

## 2. Results Endpoint Filtering

- [x] 2.1 Modify `GET /api/elections/:id/results` in `server/src/routes/elections.ts` to parse optional query parameters: `rik`, `district`, `municipality`, `kmetstvo`, `local_region`
- [x] 2.2 Implement geographic filter SQL: JOIN `votes` → `sections` (on `election_id`, `section_code`) → `locations` (on `location_id`), then WHERE on the relevant `locations` FK column
- [x] 2.3 Implement precedence logic: when multiple geo params provided, use most specific (kmetstvo > local_region > municipality > district > rik)
- [x] 2.4 Verify no-parameter requests still return identical national totals (backward compatibility)
- [x] 2.5 Write tests: filtered results for a known municipality return subset of national total; invalid ID returns empty results array; no-filter matches existing behavior

## 3. Frontend Filter UI

- [x] 3.1 Create `web/src/components/location-filter.tsx` component with `<select>` dropdowns for RIK, district, municipality, kmetstvo, and local region
- [x] 3.2 Implement cascading logic: selecting a district fetches `GET /api/geography/municipalities?district=<id>` and populates the municipality dropdown; selecting a municipality populates kmetstva and local region dropdowns
- [x] 3.3 Integrate `LocationFilter` into `web/src/pages/election-results.tsx` above the results table
- [x] 3.4 On filter change, re-fetch `GET /api/elections/:id/results?<param>=<id>` and update displayed results

## 4. URL State and Shareability

- [x] 4.1 Sync the active geographic filter to URL search params using React Router's `useSearchParams`
- [x] 4.2 On page load, read filter from URL search params and pre-select the corresponding dropdown, triggering filtered data fetch
- [x] 4.3 Verify that navigating to a URL with `?municipality=42` loads the page with the correct filter active and correct results displayed

## 5. Validation and Polish

- [x] 5.1 Validate filtered results against known CIK reference data for at least one election and one geographic level to confirm correctness
- [x] 5.2 Verify that sections with NULL location or NULL geographic FK are excluded from filtered results but included in unfiltered national totals
- [x] 5.3 Run full test suite (`npm test`) and confirm all existing and new tests pass
