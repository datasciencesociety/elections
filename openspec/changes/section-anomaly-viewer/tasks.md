## 1. API Endpoint

- [ ] 1.1 Add `GET /api/elections/:id/anomalies` route in `server/src/routes/elections.ts` with query parameter parsing for: `min_risk` (float, default 0.3), `sort` (string, default "risk_score"), `order` ("asc"|"desc", default "desc"), `limit` (int, default 50, max 500), `offset` (int, default 0), and geographic filters (`rik`, `district`, `municipality`, `kmetstvo`, `local_region`)
- [ ] 1.2 Add sort column whitelist validation: `risk_score`, `turnout_rate`, `turnout_zscore`, `benford_score`, `peer_vote_deviation`, `arithmetic_error`, `vote_sum_mismatch`, `section_code`, `settlement_name` — return 400 for invalid values
- [ ] 1.3 Implement SQL query joining `section_scores ss`, `sections s`, and `locations l` — select `ss.section_code`, `l.settlement_name`, `l.lat`, `l.lng`, and all score columns; apply `WHERE ss.election_id = ? AND ss.risk_score >= ?` with optional geographic filter clause; sort by whitelisted column with `LIMIT ? OFFSET ?`
- [ ] 1.4 Add separate `SELECT COUNT(*) as total` query with the same WHERE clause for pagination metadata
- [ ] 1.5 Return JSON response: `{ election: { id, name, date, type }, sections: [...], total, limit, offset }` — return 404 if election not found
- [ ] 1.6 Validate endpoint manually against elections.db: confirm response shape, verify scored sections return correct joined location data, test geographic filters, test sort/order/pagination combinations

## 2. Frontend Dependencies and Routing

- [ ] 2.1 Install Tailwind CSS v4 in the `web` workspace: add `tailwindcss` and `@tailwindcss/vite` to dependencies, add the Tailwind Vite plugin to `web/vite.config.ts`, add `@import "tailwindcss"` directive to the top of `web/src/index.css`
- [ ] 2.2 Initialize shadcn/ui in the `web` workspace: run `npx shadcn@latest init` to create `components.json` and configure path aliases (set `@` alias in `tsconfig.json` and `vite.config.ts` resolve.alias)
- [ ] 2.3 Install mapcn map component: run `npx shadcn@latest add @mapcn/map` — this creates `web/src/components/ui/map.tsx` and installs `maplibre-gl` as a dependency automatically
- [ ] 2.4 Add route in `web/src/main.tsx`: import `SectionAnomalies` from `./pages/section-anomalies.js` and add `<Route path="/elections/:id/anomalies" element={<SectionAnomalies />} />`

## 3. Anomaly Viewer Page — Layout and State

- [ ] 3.1 Create `web/src/pages/section-anomalies.tsx` — use `useParams()` to get election `id`, fetch election metadata, display election name as page title with a back link to `/elections/:id`
- [ ] 3.2 Add risk threshold slider: HTML `<input type="range">` with min=0, max=1, step=0.05, default 0.3, displaying current value — updates `minRisk` state on change
- [ ] 3.3 Integrate existing `LocationFilter` component: wire `onFilterChange` callback to update geographic filter state (`filterParam`, `filterValue`)
- [ ] 3.4 Add table/map view toggle: two buttons ("Table" / "Map") that switch a `viewMode` state between `"table"` and `"map"` — highlight active view

## 4. Anomaly Viewer Page — Data Fetching

- [ ] 4.1 Create `useAnomalies` hook (or inline in component) that calls `GET /api/elections/:id/anomalies` with current state: `min_risk`, `sort`, `order`, `limit`, `offset`, and geographic filter param/value — re-fetch when any parameter changes
- [ ] 4.2 Handle loading state (show "Loading..." text), error state (show error message), and empty state (show "No sections above threshold" message)
- [ ] 4.3 For map view, make a separate fetch with `limit=500` and `offset=0` to load all markers regardless of table pagination state — store in separate state variable

## 5. Anomaly Viewer Page — Table View

- [ ] 5.1 Build HTML `<table>` with columns: Section Code, Settlement, Risk Score, Turnout Rate, Turnout Z-Score, Benford Score, Peer Vote Dev., Arith. Error, Vote Mismatch — use inline styles consistent with existing pages
- [ ] 5.2 Make column headers clickable: clicking a header sets `sort` to that column; clicking the active sort column toggles `order` between "asc" and "desc"; show sort direction indicator (arrow or symbol) on the active column
- [ ] 5.3 Format cell values: risk score to 2 decimal places, turnout rate as percentage, z-score to 1 decimal, boolean flags (arithmetic_error, vote_sum_mismatch) as "Yes"/"No" or checkmark
- [ ] 5.4 Color-code risk score cells: green background for < 0.3, yellow for 0.3–0.6, red for > 0.6
- [ ] 5.5 Add pagination controls below table: "Previous" / "Next" buttons (disabled at bounds), page indicator showing "Showing {offset+1}–{offset+rows} of {total}", page size of 50

## 6. Anomaly Viewer Page — Map View

- [ ] 6.1 Import `Map`, `MapMarker`, `MarkerContent`, `MarkerPopup` from `@/components/ui/map`; render `<Map>` centered on Bulgaria `center={[25.5, 42.7]}` with `zoom={7}` inside a container div with fixed height (e.g. 600px)
- [ ] 6.2 Iterate over map sections data; for each section with non-null `lat`/`lng`, render a `<MapMarker longitude={lng} latitude={lat}>` with a `<MarkerContent>` containing a colored circle `<div>` (size-3, rounded-full, border-2 border-white)
- [ ] 6.3 Color-code marker circles by risk score: `bg-green-500` for risk < 0.3, `bg-yellow-500` for 0.3–0.6, `bg-red-500` for > 0.6
- [ ] 6.4 Add `<MarkerPopup>` inside each `<MapMarker>` displaying: section code (bold), settlement name, risk score, turnout rate, and top anomaly flags — styled with padding and readable text
- [ ] 6.5 Add a map legend showing the three risk tiers with colored circles and labels (Low Risk < 0.3, Medium 0.3–0.6, High > 0.6)
- [ ] 6.6 Handle loading state for map data separately from table data; show "Loading map data..." while the 500-section fetch is in progress

## 7. Navigation Integration

- [ ] 7.1 In `web/src/pages/election-list.tsx`: add an "Anomalies" link (`<Link to={/elections/${id}/anomalies}>`) next to each election entry, alongside existing links
- [ ] 7.2 In `web/src/pages/election-results.tsx`: add an "Anomalies" link in the page header/navigation area linking to `/elections/${id}/anomalies`

## 8. Testing and Validation

- [ ] 8.1 Write API integration tests in the existing test file for the anomalies endpoint covering: default parameters return sections sorted by risk_score desc, `min_risk` filter excludes low-risk sections, each valid sort column works, pagination with limit/offset returns correct slices, 404 for non-existent election ID, 400 for invalid sort column
- [ ] 8.2 Test geographic filters: verify passing `rik`, `district`, `municipality` params returns only matching sections
- [ ] 8.3 Run full existing test suite (`npm test`) to confirm no regressions from Tailwind/dependency additions
- [ ] 8.4 Manual browser validation: verify table sorting, pagination, risk slider filtering, map markers render with correct colors, popups display correct data, geographic filters work end-to-end
