## 1. Party API Endpoints

- [x] 1.1 Create `server/src/routes/parties.ts` with `GET /` endpoint: query parties with `election_count` and `total_votes` from `votes` + `election_parties`, support optional `?type=` filter, return sorted by total_votes desc
- [x] 1.2 Add `GET /:id` endpoint: return party metadata, coalition relationships (query `coalition_members` both directions), and per-election results with votes/percentage/ballot_number/name_on_ballot sorted by date desc
- [x] 1.3 Register party routes in `server/src/app.ts` as `/api/parties`
- [x] 1.4 Validate party API endpoints return correct data against known parties in the database (e.g., verify a major party like ГЕРБ returns expected election count and coalition data)

## 2. Party List Page

- [x] 2.1 Create `web/src/pages/party-list.tsx` with table displaying all parties (name linked to `/parties/:id`, short name, type, color swatch, election count, total votes)
- [x] 2.2 Add client-side name filter (substring on canonical_name/short_name, case-insensitive) and party type dropdown filter
- [x] 2.3 Add route `/parties` in `web/src/main.tsx` pointing to PartyList component

## 3. Party Profile Page

- [x] 3.1 Create `web/src/pages/party-profile.tsx` with metadata section: heading (canonical_name), short name, party type badge, color swatch, Wikipedia link (if present)
- [x] 3.2 Add coalition relationships section: list of coalitions the party belongs to and/or member parties (if coalition), each linked to `/parties/:id`
- [x] 3.3 Add historical results table: election name (linked to `/elections/:id`), date, ballot number, name on ballot, votes, percentage — sorted by date desc
- [x] 3.4 Add Chart.js line chart for vote percentage trend using party color; only render if party has 2+ elections
- [x] 3.5 Add route `/parties/:id` in `web/src/main.tsx` pointing to PartyProfile component

## 4. Cross-linking

- [x] 4.1 Update `web/src/pages/election-results.tsx` to wrap party names in `<Link to={/parties/${party_id}}>` elements
- [x] 4.2 Add navigation link to `/parties` from the election list page (`web/src/pages/election-list.tsx`)

## 5. Validation

- [x] 5.1 Run existing tests to confirm no regressions
- [x] 5.2 Manually verify party list loads, filters work, and party profile displays correct data for at least one coalition and one regular party
