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
| `GET /admin` | Admin dashboard — coverage stats, section management (enable/disable, add/update), flagged streams |
| `GET /inspect` | Single-stream freeze/cover detector |

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/session` | Create a session; returns `{ session_id, streams[] }` |
| `POST` | `/api/heartbeat` | Keep session alive; body `{ session_id }` |
| `POST` | `/api/report` | Submit detection results; body `{ session_id, results[] }` |
| `GET`  | `/api/flagged` | Get streams flagged in the last 5 min by ≥2 volunteers |
| `POST` | `/api/streams` | Bulk-replace stream list; body `[{ section?, url, label }]` — **destructive**, wipes all sessions/reports |
| `POST` | `/api/streams/upsert` | Add/update sections; body `[{ section?, url, label }]` — additive, resets `last_checked` on URL change |
| `GET`  | `/api/streams` | List all sections with enabled state |
| `GET`  | `/api/streams/stats` | Coverage stats: `{ total, enabled, covered, volunteers }` |
| `POST` | `/api/streams/toggle` | Enable/disable a section; body `{ id, enabled: 0|1 }` |

### Stream/section fields

```jsonc
{
  "section": "102700005",        // 9-digit section ID (optional — parsed from URL if omitted)
  "url": "https://archive.evideo.bg/.../102700005/recording.mp4",
  "label": "ОИК 1027 Кочериново / 102700005 С. БАРАКОВО (tour 1)",
  "assigned_users": "4905dd,8d4a1a"  // optional — see below
}
```

| Field | Required | Description |
| ----- | -------- | ----------- |
| `section` | no | 9-digit section ID. Unique upsert key. Parsed from URL if omitted; falls back to `label`. |
| `url` | yes | Recording URL on `archive.evideo.bg`. |
| `label` | yes | Human-readable name shown in the admin and volunteer UIs. |
| `assigned_users` | no | Comma-separated volunteer user IDs (provided by auth at login) that are pre-assigned to this section. Volunteers with a matching ID will have the section prioritised in their session. Sections with no or few assignments are also available for volunteers to self-select. |

The `section` field is the unique key for upserts. If omitted, the server extracts it from the URL path (`/real/<9-digit>/`). If the URL doesn't contain one, the label is used as fallback.

When a device restarts and gets a new recording URL, re-uploading the same section updates the URL and resets `last_checked` so volunteers pick it up immediately.

The scraper (`apps/scraper`) produces `section`, `url`, and `label` only. Add `assigned_users` manually for sections that need dedicated volunteer coverage.

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
