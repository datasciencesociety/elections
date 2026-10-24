# pe202604 — Parliamentary elections, April 2026

Reference material from election night, 19 April 2026. The scraped stream list itself is committed at
`elections-video-monitoring/apps/scraper/streams_pe202604.json` (11,653 streams).

| File | What it is |
| ---- | ---------- |
| `evideo-index-snapshot-2026-04-19.yml` | Playwright accessibility snapshot of `https://evideo.bg/pe202604/index.html` (list of 31 РИК pages) |
| `evideo-rik01-snapshot-2026-04-19.yml` | Snapshot of the РИК 01 Благоевград page, showing the per-section layout the scraper parses |
| `evideo-console-2026-04-19.log` | Browser console from that session (video.js deprecation warning only) |
| `scrape-tour1-failed-2026-04-19.log` | A `--tour=1` scrape run that returned 0 streams ("no servers map found" on every РИК page). Probable cause: the pages used the new `data-vid` layout, which has no tour data, while the same day's run without `--tour` found 11,653 streams. Not confirmed; the pages may also not have been published yet at that hour |
