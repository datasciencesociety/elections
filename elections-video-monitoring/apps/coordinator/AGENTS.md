# Coordinator

- Node >= 22.13 (`node:sqlite` without a flag).
- Fast tests: `node --test integration.test.js auth.unit.test.js auth.property.test.js middleware.property.test.js audit.unit.test.js autofill.test.js`. `pnpm test` runs only the Playwright e2e tests.
- Before committing changes to the volunteer page, `/hls` or the nginx files, also run `node --test volunteer-waiting.e2e.test.js` (Playwright Chromium) and `../../scripts/test-nginx-hls.sh` (Docker, offline). `deploy/deploy.sh` runs all of these and says when it skips one.
- Auth denies by default (`middleware.js`). A new route needs a login unless you add it to `PUBLIC_ROUTES`, or admin if you add it to `ADMIN_ROUTES`. Only `/api/streams/count` and `/stats` are public; the stream lists contain usernames and phone numbers. Add every new route to the integration test.
- The volunteer identity comes only from the login cookie, never from the request body.
- A section can have backup volunteers (`AUTOFILL_AFTER`), and a single report flags it.
- Deploy only with `deploy/deploy.sh`: it checks the release and rolls back. Never set `ALLOW_NEW_DB=1` on the live server, because it would start with an empty database.
