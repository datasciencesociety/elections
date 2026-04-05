## 1. API Endpoint

- [ ] 1.1 Add `GET /api/elections/:id/anomalies` route in `server/src/routes/elections.ts` with query parameter parsing and whitelist validation for `sort` column
- [ ] 1.2 Implement SQL query joining `section_scores`, `sections`, and `locations` with `min_risk` threshold filter, geographic filters, sorting, and pagination (LIMIT/OFFSET)
- [ ] 1.3 Add COUNT query for `total` field and assemble response with `election` metadata, `sections` array, `total`, `limit`, `offset`
- [ ] 1.4 Handle edge cases: 404 for unknown election, 400 for invalid sort column, cap limit at 500, default values for all optional params
- [ ] 1.5 Validate API endpoint manually against elections.db — confirm response shape matches design spec and scored sections return correct joined location data

## 2. Frontend Dependencies and Routing

- [ ] 2.1 Add `leaflet` and `react-leaflet` packages to the `web` workspace
- [ ] 2.2 Add `/elections/:id/anomalies` route to `web/src/main.tsx` pointing to the new page component

## 3. Anomaly Viewer Page — Core

- [ ] 3.1 Create `web/src/pages/section-anomalies.tsx` with page layout: election title, risk threshold slider (0-1, step 0.05, default 0.3), and LocationFilter component
- [ ] 3.2 Implement data fetching hook that calls `/api/elections/:id/anomalies` with current filter/sort/pagination state, including loading and error states
- [ ] 3.3 Build sortable table view with columns: section code, settlement, risk score, turnout rate, turnout z-score, Benford score, peer vote deviation, arithmetic error, vote sum mismatch — with click-to-sort headers
- [ ] 3.4 Add pagination controls (prev/next/page indicator) driven by `total`, `limit`, `offset` from the API response

## 4. Anomaly Viewer Page — Map View

- [ ] 4.1 Add table/map toggle control to the page
- [ ] 4.2 Implement Leaflet map view centered on Bulgaria (42.7, 25.5, zoom 7) with markers for sections that have lat/lng coordinates
- [ ] 4.3 Color-code markers by risk score: green (< 0.3), yellow (0.3-0.6), red (> 0.6)
- [ ] 4.4 Add click popup on markers showing section code, settlement name, risk score, and key metrics
- [ ] 4.5 Fetch up to 500 sections for map view (separate fetch ignoring table pagination)

## 5. Navigation Integration

- [ ] 5.1 Add "Anomalies" link to the election list page for each election
- [ ] 5.2 Add "Anomalies" link to the election results/detail page

## 6. Testing and Validation

- [ ] 6.1 Write API integration tests for the anomalies endpoint: default params, min_risk filter, sorting, pagination, 404 for missing election, 400 for invalid sort
- [ ] 6.2 Run existing test suite to confirm no regressions
