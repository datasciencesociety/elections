## 1. Backend — Turnout API Endpoint

- [ ] 1.1 Add `GET /api/elections/:id/turnout` route in `server/src/routes/elections.ts` with `group_by` and geographic filter query parameters
- [ ] 1.2 Implement SQL query joining `protocols` → `sections` → `locations` → geography table, with `COALESCE` for null handling and division-by-zero protection
- [ ] 1.3 Add `group_by` parameter validation — return 400 for missing or invalid values (valid: `rik`, `district`, `municipality`, `kmetstvo`, `local_region`)
- [ ] 1.4 Add 404 response when election ID does not exist
- [ ] 1.5 Return response shape: `{ election, turnout: [{ group_id, group_name, registered_voters, actual_voters, turnout_pct }], totals }`
- [ ] 1.6 Validate endpoint with manual test against known election data — verify turnout percentages match expected values from `protocols` table

## 2. Frontend — Turnout Dashboard Page

- [ ] 2.1 Create `web/src/pages/turnout.tsx` page component with route parameter for election ID
- [ ] 2.2 Add `/turnout/:id` route to `web/src/main.tsx`
- [ ] 2.3 Add data fetching hook to call `GET /api/elections/:id/turnout` with `group_by` and filter params
- [ ] 2.4 Implement group-by dropdown selector (default: `district`) that re-fetches data on change
- [ ] 2.5 Integrate `LocationFilter` component for geographic drill-down, passing selected filters to API
- [ ] 2.6 Render horizontal `Bar` chart using `react-chartjs-2` with turnout % per geographic unit, sorted descending
- [ ] 2.7 Add summary card showing total registered voters, actual voters, and overall turnout percentage
- [ ] 2.8 Implement loading indicator and error/404 states

## 3. Navigation & Integration

- [ ] 3.1 Add turnout link/button to election list page for each election
- [ ] 3.2 Verify end-to-end flow: election list → turnout page → filter → chart updates

## 4. Testing

- [ ] 4.1 Add API tests for turnout endpoint: valid request, missing group_by (400), invalid group_by (400), unknown election (404), geographic filtering
- [ ] 4.2 Validate turnout percentages against manual SQL query on at least one election to confirm data accuracy
