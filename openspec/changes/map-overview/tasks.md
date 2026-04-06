## 1. API Endpoint

- [x] 1.1 Add `GET /api/elections/:id/results/geo` route in `server/src/routes/elections.ts` — validate `:id` is numeric (return 400 if not), verify election exists (return 404 if not), return election metadata in `election` field
- [x] 1.2 Implement SQL query joining `votes → sections → locations → municipalities` and `election_parties → parties` to aggregate votes by municipality and party — group by `municipality_id, party_number`, sum `votes.total`, select `parties.canonical_name` and `parties.color`
- [x] 1.3 In application code, build the response: for each municipality with a non-null `geo`, compute `total_votes`, sort parties by votes descending, determine `winner` (party with max votes or `null` if no votes), compute `pct` as `ROUND(votes / total_votes * 100, 2)`
- [x] 1.4 Include all 265 municipalities with non-null `geo` in the response — municipalities with no vote data for the election get `total_votes: 0`, `winner: null`, and empty `parties` array
- [x] 1.5 Validate endpoint: confirm response shape matches spec, verify aggregation is correct for a known municipality, test 404 for non-existent election, test 400 for non-numeric ID

## 2. Frontend Routing and Page Scaffold

- [x] 2.1 Create `web/src/pages/election-map.tsx` with `ElectionMap` component — use `useParams()` to get `electionId`, set up state for election data, loading, and error
- [x] 2.2 Add route `/map/:electionId` in `web/src/main.tsx` importing `ElectionMap` component
- [x] 2.3 Fetch election list from `GET /api/elections` for the election selector dropdown — display elections ordered by date descending, preselect current election

## 3. Map Rendering

- [x] 3.1 Fetch `GET /api/elections/:id/results/geo` on mount and when election changes — store municipalities data in state, handle loading and error states
- [x] 3.2 Initialize MapLibre GL map centered on Bulgaria (lat ~42.7, lng ~25.5, zoom ~7) in a full-screen container
- [x] 3.3 Build a GeoJSON FeatureCollection from the API response: wrap each municipality's `geo` (geometry-only) in a Feature with `properties` containing `id`, `name`, `total_votes`, `winner_color`, and party data
- [x] 3.4 Add the FeatureCollection as a GeoJSON source and render a `fill` layer with `fill-color` driven by each feature's `winner_color` property — use neutral gray (#CCCCCC) for municipalities with no winner
- [x] 3.5 Add a `line` layer for municipality borders (thin, semi-transparent) for visual clarity

## 4. Click Interaction and Popup

- [x] 4.1 Add click handler on the municipality fill layer — on click, read the clicked feature's properties (municipality name, total votes, parties array)
- [x] 4.2 Display a MapLibre Popup at the click coordinates showing: municipality name, total votes, and per-party breakdown with color indicator, party name, votes, and percentage
- [x] 4.3 For municipalities with no votes (winner is null), show "No vote data for this election" in the popup
- [x] 4.4 Dismiss popup when clicking outside any municipality polygon

## 5. Election Selector

- [x] 5.1 Render a `<select>` dropdown overlaid on the top-right corner of the map listing all elections by name and date
- [x] 5.2 On selection change, navigate to `/map/:newElectionId` (using React Router `useNavigate`) — this triggers data re-fetch via the existing effect
- [x] 5.3 Dismiss any open popup when election changes

## 6. Navigation Integration

- [x] 6.1 Add "Map" link to each election entry in `web/src/pages/election-list.tsx` linking to `/map/:electionId`
- [x] 6.2 Add "Map" link in the header/navigation area of `web/src/pages/election-results.tsx` linking to `/map/:id`

## 7. Loading and Error States

- [x] 7.1 Show a loading indicator while the geo results API is being fetched (both initial load and election switch)
- [x] 7.2 Show "Election not found" error message when the API returns 404 — keep the election selector functional so the user can navigate to a valid election
- [x] 7.3 Display election name as a title overlay on the map once data is loaded

## 8. Testing and Validation

- [x] 8.1 Write API integration tests for `GET /api/elections/:id/results/geo` covering: valid election returns municipalities with geometry, 404 for non-existent election, 400 for non-numeric ID, municipalities with no votes have null winner, party data is correctly aggregated and sorted
- [x] 8.2 Run full existing test suite (`npm test`) to confirm no regressions
- [ ] 8.3 Manual browser validation: verify map renders with colored polygons, click popup shows correct party data, election selector switches elections, navigation links work from list and detail pages
