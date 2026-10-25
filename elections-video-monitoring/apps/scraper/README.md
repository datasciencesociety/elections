# scraper

Playwright-based CLI that scrapes an evideo.bg election index page and outputs a JSON array of stream URLs ready to upload to the coordinator.

Uses a real Chromium browser to handle Cloudflare JS challenges that block plain HTTP clients.

## Requirements

Playwright and Chromium must be installed:

```sh
pnpm install
npx playwright install chromium
```

## Usage

```sh
node scrape-streams.js <index-url> [options]
```

Output (stream JSON) goes to **stdout**; progress logs go to **stderr**.

### Examples

```sh
# Scrape all device recordings, all tours
node scrape-streams.js https://evideo.bg/le20260222/index.html

# Save to file
node scrape-streams.js https://evideo.bg/le20260222/index.html > out/streams.json

# Upload the saved file to the coordinator (additive upsert; needs an admin login)
SEED_USER=admin SEED_PASS=… node ../../scripts/seed.js out/streams.json

# Or replace all streams (destructive: wipes sessions and reports)
SEED_USER=admin SEED_PASS=… node ../../scripts/seed.js out/streams.json --replace --force

# Only tour 1, live recordings, 5 parallel workers — name file after election code + filters
node scrape-streams.js https://evideo.bg/le20260222/index.html \
  --tour=1 --type=r --concurrency=5 > out/streams_le20260222_tour1_live.json
```

File naming convention: `streams_<election-code>[_tour<N>][_<type>].json`

`<election-code>` is the path segment from the index URL (e.g. `le20260222`, `pe202410`). Prefixing prevents collisions when multiple elections are archived side-by-side.

| Filter active | Segment    | Example                                 |
| ------------- | ---------- | --------------------------------------- |
| `--tour=1`    | `_tour1`   | `streams_le20260222_tour1.json`         |
| `--type=d`    | `_device`  | `streams_le20260222_device.json`        |
| `--type=r`    | `_live`    | `streams_le20260222_live.json`          |
| both          | both       | `streams_le20260222_tour1_live.json`    |

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--concurrency=N` | `3` | Number of OIK sub-pages to scrape in parallel |
| `--tour=N` | all | Only include streams for the given ballot tour number |
| `--type=d\|r\|both` | `d` | Stream type: `d` = device recording, `r` = live recording |
| `--discover[=URL]` | `https://evideo.bg/` | Poll the home page until an election code appears that was not linked at start, then scrape it |
| `--code=X` | — | With `--discover`: wait for this code (use it if the election is already linked) |
| `--poll=S` | `300` | `--discover` poll interval in seconds |
| `--upsert` | off | Send found streams to the coordinator while scraping (`COORDINATOR_URL`, `SEED_USER`/`SEED_PASS`) |
| `--batch-size=N` | `30` | With `--upsert`: send every N new or changed sections at once; the rest goes at the end of the pass. A failed batch is retried (2, 4, 8 s) and then kept for the next pass |
| `--watch=S` | off | Rescrape every S seconds; with `--upsert` only new or changed sections are sent |
| `--fast` | off | Block video requests and stop waiting once sections are in the DOM |
| `--profile=DIR` | `~/.cache/evideo-scraper` | Browser profile kept between runs (Cloudflare cookie, upsert progress) |
| `--headed` | off | Show the browser if Cloudflare keeps challenging headless mode |

### Election day

Read today's evideo code from the "Гледай" link on the evideo.bg home page once, in a normal browser (it differs from the CIK code). Then start the scraper; it seeds the coordinator page by page and keeps it current:

```sh
COORDINATOR_URL=https://<live-domain> SEED_USER=admin SEED_PASS=… \
  node scrape-streams.js --discover --code=<evideo-code> --upsert --batch-size=30 --watch=120 --fast
```

- Volunteers get URLs 30 at a time while the scrape runs, not after the last OIK page. Partial batches never touch other sections: the upsert fills stubs in place and keeps assignments and the admin's enable/disable.
- Progress is saved in the profile (`sent-<code>.json`), so a restart sends only new or changed sections. A rerun with a fresh profile resends everything, which is harmless.
- Without `--watch`, the exit code is 2 when some rows could not be sent; run it again.

- `--code` is required once the election is linked on the home page: without it `--discover` waits for a code that was not linked when it started.
- `--fast` stops waiting for network idle, which live players on the page never reach.
- Run it from an operator laptop, never from the coordinator server: that server's IP fetches all volunteer video through `/hls`, and a Cloudflare block on it would stop every card.

It acts as one polite visitor: one Chrome profile for all pages, page loads at least 1.5 s apart, and when a Cloudflare challenge does not clear by itself, all requests pause with backoff (1, 2, 4 … 15 min). Do not lower `--poll` or raise `--concurrency` to go faster: Cloudflare blocks the IP for a while. Upserts send each section's stored `assigned_users` back, so assignments survive on older coordinators too.

## Tests

`node --test scrape-upsert.e2e.test.js` runs the scraper in Chromium against a local fake evideo origin and a local coordinator (temp DB): batches of 30, a retried 502, stubs filled in place, idempotent reruns. It never contacts evideo.bg. About 70 s.

## Output format

```json
[
  {
    "section": "123456789",
    "url": "https://archive.evideo.bg/real/123456789/...",
    "label": "OIK 12 / 123456789 Sofia (tour 1)"
  },
  ...
]
```

| Field | Description |
| ----- | ----------- |
| `section` | 9-digit section ID from evideo.bg (`data-sik`). Used as unique key for upserts. |
| `url` | Full recording URL on `archive.evideo.bg` |
| `label` | Human-readable label: OIK name / section ID + location name + tour |

The scraper only emits `section`, `url`, and `label`. The optional `assigned_users` field (comma-separated volunteer IDs) must be added manually after scraping when you want to pre-assign specific volunteers to a section:

```json
[
  {
    "section": "123456789",
    "url": "https://archive.evideo.bg/real/123456789/...",
    "label": "OIK 12 / 123456789 Sofia (tour 1)",
    "assigned_users": "4905dd,8d4a1a"
  }
]
```

Volunteers whose auth-provided user ID appears in `assigned_users` will have those sections prioritised in their session. Sections with no `assigned_users` or with fewer assignments are also available for volunteers to self-select.

