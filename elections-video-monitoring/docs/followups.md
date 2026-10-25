# Follow-ups for V3

Collected on election night, 25 Oct 2026. Highest value first.

## Push to refresh

Volunteers keep the page open for hours, so a page-only deploy (`volunteer.html`, `i18n.js`) reaches them only when they reload. On 25 Oct the team had to ask everyone in chat.

- The server reports the release it serves, for example the git commit read at startup, in every heartbeat response.
- The page remembers the release it loaded with. When a heartbeat reports a different one, it shows a banner ("Има нова версия – презареди") or reloads by itself when no inspect panel is open.
- A reload must keep the cards: the session id is in `localStorage`, so the page resumes the same session.
- Test: e2e that changes the reported release and checks the banner and the resumed cards.

## Distribution

- Reshuffle by risk: volunteers who logged in before the high-risk sections were loaded keep lower-risk cards, because cards are never taken away. Offer them a swap ("по-рискова секция без наблюдател") instead of removing anything.
- Load every priority section as a stub before volunteers log in, not after: the login fill can only give sections the coordinator already knows.
- Backup cover (`AUTOFILL_AFTER`) is built and tested but was not switched on. Decide whether to use it next time.
- Order by risk and by watchers still missing. On 25 Oct, 9 sections that needed 3 watchers had low risk scores and got nobody until their risk was raised by hand.
- Cap the cards per volunteer. One volunteer took 28 cards.

## Playback and detection

Ideas from a peer site that monitored the same count, evideo.iaz.bg (wall view `#wall`):

- Play through hls.js instead of the browser's own player. hls.js stays near the live edge and retries a failed or empty playlist, where the native player stops.
- Detect on the server: grab a frame per section, show the last frame on the card, and keep the frames of each problem as evidence. Compare with the cost study on `feature/server-side-detection`.
- Show a dead feed as "the broadcast is not active" with the last frame, not as frozen. On 25 Oct most cards reported frozen were feeds evideo had stopped serving (empty playlist on evideo's own page link).
- Check the motion threshold against a quiet counting room: one live stream, current to the second, was reported frozen.

## Operations

- nginx: the video proxy should limit per volunteer, not per server. Pass the real client address to it. On 25 Oct the shared limit (5 r/s for everyone, all seen as 127.0.0.1) returned 503 to most video requests for about 30 minutes, until it was raised on the server. Bring the repo config in line with the server, then replace the shared limit with a per-volunteer one.
- nginx: do not serve a stale playlist while updating. An empty playlist from a restarting stream stayed in the cache; `updating` and `proxy_cache_background_update` were turned off for `.m3u8` on 25 Oct.
- Load-test the proxy at election-night volume before the day: the peak on 25 Oct was about 1,000 requests a second (60,500 a minute), 620 live streams and 380 Mbit/s out. The access log holds each video request twice (public server block and proxy), so count only lines whose client is not 127.0.0.1.
- nginx tuning from a review after 25 Oct (test each before election day):
  - Reuse connections to evideo. `proxy_pass` with variables opens a new TCP and TLS connection per request, because keepalive and `proxy_ssl_session_reuse` need an `upstream {}` block. Option: an upstream of evideo's shared IPs with `keepalive`, `proxy_ssl_name $ups_host`, and a check that one certificate covers every host.
  - Make the cache times ours: `proxy_ignore_headers Cache-Control Expires X-Accel-Expires` and `proxy_hide_header Cache-Control`. Today evideo's `max-age=30` on `index.m3u8` beats our 2 s.
  - Do not cache empty playlists: `map $upstream_http_content_length $no_cache_empty { default 0; "0" 1; }` with `proxy_no_cache $no_cache_empty`. It works only when evideo sends `Content-Length: 0`; a chunked empty body still needs the short TTL.
  - Size the cache for about 900 streams: `max_size=8g`, `keys_zone=HLS:100m`, `inactive=120s`. 1 GB holds only 2–3 segments per stream.
  - Lock timeouts: `proxy_cache_lock_timeout 3s; proxy_cache_lock_age 3s;` for segments, 1 s for playlists.
  - Limits: `worker_rlimit_nofile 65535;` and `worker_connections 16384;`. Keepalive from the public server block to the proxy (`upstream { server 127.0.0.1:8666; keepalive 256; }`).
  - `resolver ... valid=300s` instead of 10 s, so a DNS blip does not turn into 502s.
  - Remove evideo's CORS headers before adding ours (`proxy_hide_header Access-Control-Allow-Origin` and the other three). Responses carry two `Access-Control-Allow-Origin` headers; harmless while page and video share one origin, broken for any other origin.
  - Later: `open_file_cache`, `aio threads`, the cache on tmpfs.
- Per-volunteer rate limit: the public server block sends `X-Real-IP`; the proxy uses `set_real_ip_from 127.0.0.1; real_ip_header X-Real-IP;` and about `rate=30r/s burst=100`. Polling stations and offices share addresses behind NAT, so keep the rate generous or key on the session cookie.
- Scraper: a region page sometimes fails with "Target page, context or browser has been closed" in headed Chrome. The next pass recovered it each time; find the cause.
- Plan the server reboot for the pending kernel and libc updates outside election days.
- Remove the test accounts and test streams created on 25 Oct.
- Admin page: the flagged list keeps polling after the login expires and fills the console with 401 errors.
