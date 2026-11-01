# Follow-ups for V3

Collected after the 25 Oct 2026 count. Highest value first.

## Push to refresh

Built on 1 Nov 2026. Volunteers keep the page open for hours, so a page-only deploy (`volunteer.html`, `i18n.js`) used to reach them only when they reloaded.

- The server reads its release once at startup: `RELEASE` if set, else the git commit of the checkout, else the `releases/<name>` directory that `deploy.sh` installs, else the start time. It is injected into the page (`window.RELEASE`) and returned in every heartbeat.
- When a heartbeat reports another release, the page shows a banner ("Има нова версия – презареди") with a reload button, and reloads by itself once no card is open in the inspect panel, the section picker is closed and no field has focus. It reloads at most once per release, so a cached old page cannot loop.
- The reload resumes the same session (session id in `localStorage`) and the same cards. Test: last case of `volunteer-waiting.e2e.test.js`.
- A page-only change reaches open pages only after a server restart, because the release is read at startup. Pages opened before this feature was deployed have no release check and still need one manual reload.
- With the start-time fallback every restart, a crash too, reloads every open page.

## Test card and distribution time (1 Nov 2026)

- `assigned_users = '*'` gives a section to every volunteer (the test card, section 999000001). It takes no slot of `LOGIN_CARDS`, is never a backup-cover section and is not listed in the section picker.
- `TOPUP_AFTER`: before it a volunteer gets only own and `*` sections, or an empty session with "Още нямате секции" (no random cards). From it on, the next heartbeat (60–90 s) adds 3 sections by risk to open pages.
- Disabling the test card (`enabled = 0`): the next heartbeat leaves it out and the page removes the card and its assignment; the slot was never counted, so no 4th section comes in its place. Its URL in the heartbeat reads `''`, so a page loaded before this release, which cannot remove it, turns the card into "not yet started" and stops playing it. A resume (reload) drops it too. Enabling it again hands it back on the next heartbeat.

## Distribution

- Load every priority section as a stub before volunteers log in: the login fill can only give sections the coordinator already knows.
- Order by risk and by watchers still missing, so a section that needs 3 watchers but has a low risk score is not left empty.
- Cap the cards per volunteer.
- Reshuffle by risk: volunteers who logged in before the high-risk sections were loaded keep lower-risk cards, because cards are never taken away. Offer them a swap ("по-рискова секция без наблюдател") instead of removing anything.
- Backup cover (`AUTOFILL_AFTER`) is built and tested but switched off. For the 1 Nov runoff it stayed off: sections went out only by automatic distribution by risk. Decide after the runoff whether to keep it.
- Done: `seed.js --replace --batch-size=500` sends a replace with the first 500 rows, then upserts the rest (RUNBOOK §7). Before, it sent every row in one request, and the site's nginx (1 MB default body limit) answered 11,732 stubs (2.25 MB) with a 413. Raising `client_max_body_size` for `/api/streams` is no longer needed.

## Playback and detection

Ideas from a peer site that monitored the same count, evideo.iaz.bg (wall view `#wall`):

- Play through hls.js instead of the browser's own player. hls.js stays near the live edge and retries a failed or empty playlist, where the native player stops.
- Detect on the server: grab a frame per section, show the last frame on the card, and keep the frames of each problem as evidence. Compare with the cost study on `feature/server-side-detection`.
- Show a dead feed (empty playlist from evideo) as "the broadcast is not active" with the last frame, not as frozen.
- Check the motion threshold against a quiet counting room, where a live stream can look frozen.

## Detect a stream that has ended

Late in the count most cards wait on streams that will not come back. Track a state per section on the coordinator, reading the playlist through the proxy cache so evideo gets no extra requests:

```text
never started → live → stalled (no new segment for 2 min) → ended
```

- evideo does not send `#EXT-X-ENDLIST`. Checked on 25 Oct: an ended stream answers 200 with an empty body for both `index.m3u8` and `main_stream.m3u8`, while a live one lists segments with current `PROGRAM-DATE-TIME`.
- Only a stream that has streamed at least once (a playlist that listed segments) can end. One that never streamed stays "never started".
- Keep the state per section, not per link. When evideo moves a section to another stream server (the scraper uploads a new link), that is not an end: the empty-playlist timer restarts on the new link. A precaution: on 25 Oct no section changed link or server (13 scraper passes; 2,049 sections in the proxy log, each from one host), and restarted streams kept their link.
- Never mark a stream ended before 21:00 local time (a setting, since the count's start moves); earlier gaps are restarts.
- Ended on any of: an empty 200 for both playlists for at least 15 min after the stream had played; evideo's page shows an `archive.evideo.bg` link instead of the live one (scraper); CIK publishes the section's protocol; `#EXT-X-ENDLIST` if evideo ever sends it; or, as a fallback, no new segment for 15 min.
- Any new segment returns the section to live. Feeds drop and resume mid-count, so the timeout alone must never be final.
- An ended card shows "Излъчването приключи – БЛАГОДАРИМ ВИ!" instead of frozen or waiting, stops probing the stream, and offers the volunteer the next high-risk section that is still live.

## Proxy (nginx)

- Rate limit per volunteer, not per server. The public server block sends `X-Real-IP`; the proxy uses `set_real_ip_from 127.0.0.1; real_ip_header X-Real-IP;` and about `rate=30r/s burst=100`. Polling stations and offices share addresses behind NAT, so keep the rate generous or key on the session cookie.
- Bring the repo config in line with the server.
- Load-test at election-night volume before the day: about 1,000 requests a second, 620 live streams and 380 Mbit/s out. The access log holds each video request twice (public server block and proxy), so count only lines whose client is not 127.0.0.1.
- Playlists: do not serve a stale copy while updating (no `updating` in `proxy_cache_use_stale`, `proxy_cache_background_update off`), so an empty playlist from a restarting stream cannot stick.
- Do not cache empty playlists: `map $upstream_http_content_length $no_cache_empty { default 0; "0" 1; }` with `proxy_no_cache $no_cache_empty`. It works only when evideo sends `Content-Length: 0`; a chunked empty body still needs the short TTL.
- Reuse connections to evideo. `proxy_pass` with variables opens a new TCP and TLS connection per request, because keepalive and `proxy_ssl_session_reuse` need an `upstream {}` block. Option: an upstream of evideo's shared IPs with `keepalive`, `proxy_ssl_name $ups_host`, and a check that one certificate covers every host.
- Make the cache times ours: `proxy_ignore_headers Cache-Control Expires X-Accel-Expires` and `proxy_hide_header Cache-Control`. Otherwise evideo's `max-age=30` on `index.m3u8` beats our 2 s.
- Size the cache for about 900 streams: `max_size=8g`, `keys_zone=HLS:100m`, `inactive=120s`. 1 GB holds only 2–3 segments per stream.
- Lock timeouts: `proxy_cache_lock_timeout 3s; proxy_cache_lock_age 3s;` for segments, 1 s for playlists.
- Limits: `worker_rlimit_nofile 65535;` and `worker_connections 16384;`. Keepalive from the public server block to the proxy (`upstream { server 127.0.0.1:8666; keepalive 256; }`).
- `resolver ... valid=300s` instead of 10 s, so a DNS blip does not turn into 502s.
- Remove evideo's CORS headers before adding ours (`proxy_hide_header Access-Control-Allow-Origin` and the other three). Responses carry two `Access-Control-Allow-Origin` headers; harmless while page and video share one origin, broken for any other origin.
- Later: `open_file_cache`, `aio threads`, the cache on tmpfs.

## Operations

- Scraper: a region page sometimes fails with "Target page, context or browser has been closed" in headed Chrome. The next pass recovers it; find the cause.
- Plan the server reboot for the pending kernel and libc updates outside election days. Still pending on 1 Nov.
- The server's root disk was 96% full on 1 Nov (3.8 GB free). Find what fills it (backups, nginx cache, logs) and free space before the next election.
- Remove the test accounts and test streams.
- Admin page: the flagged list keeps polling after the login expires and fills the console with 401 errors.
