# coordinator

Node.js HTTP server that coordinates volunteer monitoring sessions. Volunteers are assigned streams, send periodic heartbeats and detection reports, and the server aggregates flagged streams for the admin.

## Start

```sh
node server.js
# or from repo root:
pnpm start
```

Default port: `3000`. Override with `PORT` env var.

## Pages

| URL | Description |
|-----|-------------|
| `GET /` | Volunteer monitoring page — loads up to 16 streams, runs canvas detection, reports every ~10 s |
| `GET /admin` | Admin dashboard — live table of flagged streams and volunteer count |
| `GET /poc` | Single-stream proof-of-concept detector |

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/session` | Create a session; returns `{ session_id, streams[] }` |
| `POST` | `/api/heartbeat` | Keep session alive; body `{ session_id }` |
| `POST` | `/api/report` | Submit detection results; body `{ session_id, results[] }` |
| `GET`  | `/api/flagged` | Get streams flagged in the last 5 min by ≥2 volunteers |
| `POST` | `/api/streams` | Bulk-replace stream list; body `[{ url, label }]` |

### Report result fields

```jsonc
{
  "stream_id": 42,
  "status": "frozen",       // ok | loading | initializing | frozen | covered | error
  "cover_ratio": 0.95,      // fraction of pixels that are near-black (0–1)
  "frozen_sec": 12.5,       // seconds since last frame change
  "luma": 0.04              // average frame luminance (0–1)
}
```

## CORS proxy

Requests to `/proxy/<path>` are forwarded to `https://archive.evideo.bg/<path>` with CORS headers added. This lets the volunteer page read canvas pixel data from cross-origin HLS streams.

## Database

SQLite database at `data/streams.db` (created automatically). Sessions inactive for more than 2 minutes are cleaned up on the next heartbeat.

## Tests

```sh
pnpm test
# or
npx playwright test
```

Tests use Playwright to exercise the canvas cover-detection algorithm in `public/poc.html`.
