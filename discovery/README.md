# discovery

Service discovery + live metrics aggregator for the video-monitoring system. Hetzner analyzer boxes register themselves here, pull their section assignments, and POST pixel-analysis metrics. Volunteer clients read a single pre-gzipped JSON blob.

Mounted at `https://map.izborenmonitor.com/video/*` via the existing nginx server block.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/video/metrics` | — | Full metrics blob, all sections keyed by id. Heavily cached (CF 2s → nginx 2s → hono in-memory blob rebuilt every 1s). |
| GET | `/video/boxes` | — | Current box roster. |
| GET | `/video/assignments/my?ip=<ip>` | — | Sections assigned to the caller. Analyzer pulls this on startup + periodically. |
| POST | `/video/register` | Bearer | `{ ip, capacity }` — analyzer self-register on boot. Pulls its capacity worth of unassigned sections. |
| POST | `/video/heartbeat` | Bearer | `{ ip }` — every ~30s from each box. Missing >2min = GC'd. |
| POST | `/video/deregister` | Bearer | `{ ip, drain?: true }` — graceful drain (default) or hard remove. |
| POST | `/video/metrics` | Bearer | `{ results: [MetricRow...] }` — batch upsert. |
| POST | `/video/sections` | Bearer | `[{ id, url, label? }...]` — bulk seed the section list. |
| POST | `/video/assign-all` | Bearer | Force a reassignment sweep (usually unnecessary — runs on every register and every GC tick). |

## Caching stack

```
Cloudflare edge (2s)
    ↓  cache miss
nginx proxy_cache (2s)
    ↓  cache miss
hono in-memory blob (rebuilt every 1s from SQLite)
    ↓  only the rebuild timer
better-sqlite3 / WAL
```

Origin handler for `/video/metrics` runs <1 req/s per nginx worker, regardless of client volume. The blob is also pre-gzipped — responses stream raw bytes when `Accept-Encoding: gzip` is sent.

## Sticky assignment

- First register fills empty capacity from unassigned sections.
- A section, once assigned, stays on its box until the box is drained/dead/removed.
- Adding a new box does NOT reshuffle live streams — only new/orphaned sections flow to it.
- On box death (heartbeat > 2min silent): `DELETE FROM boxes` cascades to its assignments; GC reassigns them on the next tick (every 30s).

## One-time install

```sh
cd /opt/elections && git pull origin main && pnpm install --frozen-lockfile
cd /opt/elections/discovery && sudo scripts/bootstrap.sh
```

Bootstrap generates `PROXY_SECRET`, writes `/etc/elections-video.env`, installs the systemd unit, splices the nginx `/video/` location blocks, and starts the service. Prints the secret once — bake it into analyzer per-instance cloud-init.

After bootstrap has run, every `git push main` deploys via `.github/workflows/deploy.yml` without further intervention.

## Env vars (`/etc/elections-video.env`)

| Var | Default | Purpose |
|---|---|---|
| `PROXY_SECRET` | *(required)* | Shared Bearer token. Analyzer boxes must carry the same value. |
| `DB_PATH` | `./data/video.db` | Local SQLite file. |
| `PORT` | `3001` | Loopback port nginx proxies to. |
| `METRICS_REBUILD_MS` | `1000` | Pre-gzipped blob rebuild cadence. |
| `GC_INTERVAL_MS` | `30000` | GC sweep cadence. |
| `BOX_TIMEOUT_MS` | `120000` | Heartbeat silence before a box is declared dead. |

## Fallback posture

If this service is down, the volunteer UI degrades cleanly: cards render with "no data — check manually" and the iframe button to evideo.bg still works. Discovery is plan B; the iframe fallback is plan A.
