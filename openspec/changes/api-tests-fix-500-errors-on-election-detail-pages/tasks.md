## 1. Test Infrastructure Setup

- [x] 1.1 Add `vitest` as a dev dependency in `server/package.json`
- [x] 1.2 Add `"test": "vitest run"` script to `server/package.json`
- [x] 1.3 Create `server/vitest.config.ts` with TypeScript and ESM support

## 2. Write API Tests (TDD — tests before fix)

- [x] 2.1 Create `server/src/__tests__/elections.test.ts` with test for `GET /api/elections` returning 200 and valid JSON array with correct fields (`id`, `name`, `date`, `type`)
- [x] 2.2 Add test that iterates all elections from the list endpoint and verifies `GET /api/elections/:id/results` returns 200 with `election` and `results` fields
- [x] 2.3 Add test for `GET /api/elections/999999/results` returning 404 with `error` field
- [x] 2.4 Add test asserting each result entry has `party_id` (number), `party_name` (string), and `total_votes` (number >= 0)
- [x] 2.5 Run tests and confirm they fail on the current broken query (validate the tests catch the bug)

## 3. Fix the SQL Query Bug

- [x] 3.1 In `server/src/routes/elections.ts`, change the JOIN from `JOIN parties p ON p.id = v.party_id` to `JOIN parties p ON p.election_id = v.election_id AND p.number = v.party_number`
- [x] 3.2 Replace `SUM(v.votes)` with `SUM(v.total)` in the same query
- [x] 3.3 Run tests and confirm all pass

## 4. CI Integration

- [x] 4.1 Update CI workflow (Forgejo Actions or equivalent) to run `npm test` in the `server/` directory before deploy
- [x] 4.2 Validate that CI pipeline runs tests and blocks deploy on failure

## 5. Validation

- [x] 5.1 Manually verify `GET /api/elections` returns all 18 elections
- [x] 5.2 Manually verify `GET /api/elections/:id/results` for at least 3 different election types (parliament, local_mayor, european) returns correct non-empty results
- [x] 5.3 Confirm no 500 errors on any election detail page
