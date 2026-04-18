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

# Upload the saved file to the coordinator
curl -X POST http://localhost:3000/api/streams \
  -H 'Content-Type: application/json' \
  -d @out/streams.json

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

## Output format

```json
[
  {
    "url": "https://archive.evideo.bg/real/123456/...",
    "label": "OIK 12 / 123456 Sofia (tour 1)",
    "type": "live"
  },
  ...
]
```

| `type` value | Description           |
| ------------ | --------------------- |
| `device`     | Device recording      |
| `live`       | Live stream recording |

