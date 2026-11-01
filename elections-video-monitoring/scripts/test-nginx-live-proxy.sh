#!/usr/bin/env bash
# Offline test of the live video proxy config (apps/coordinator/deploy/live-proxy/) in nginx 1.18.
# The container has no network: every proxy_pass is pointed at a fake origin inside the same
# nginx, so nothing reaches evideo. Needs Docker. Usage: scripts/test-nginx-live-proxy.sh
set -euo pipefail

LIVE=$(cd "$(dirname "$0")/../apps/coordinator/deploy/live-proxy" && pwd)
# Under $HOME: colima and Docker Desktop share it with the VM, unlike $TMPDIR
# A fresh directory per run: colima can serve a stale copy of a bind-mounted path that was recreated
mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/coordinator-nginx"
WORK=$(mktemp -d "${XDG_CACHE_HOME:-$HOME/.cache}/coordinator-nginx/live.XXXXXX")

# Same file, one change: the upstream is the fake origin below instead of https://<evideo host>.
# The host stays in the path so the origin can tell archive.evideo.bg from other hosts.
ups='proxy_pass https://$ups_host$ups_path$is_args$args;'
want=$(grep -cF "$ups" "$LIVE/hls-proxy.conf" || true)
[ "$want" = 4 ] || { echo "FAIL: expected 4 '$ups' lines in hls-proxy.conf, found $want" >&2; exit 1; }
sed 's#proxy_pass https://$ups_host$ups_path$is_args$args;#proxy_pass http://127.0.0.1:9000/$ups_host$ups_path$is_args$args;#' \
  "$LIVE/hls-proxy.conf" > "$WORK/hls-proxy.conf"
got=$(grep -cF 'proxy_pass http://127.0.0.1:9000/$ups_host$ups_path$is_args$args;' "$WORK/hls-proxy.conf" || true)
[ "$got" = 4 ] || { echo "FAIL: proxy_pass rewrite matched $got of 4 lines" >&2; exit 1; }
grep -q 'proxy_pass https' "$WORK/hls-proxy.conf" && { echo "FAIL: an https proxy_pass is left after the rewrite" >&2; exit 1; }

# Fake origin content. The MP4 is 3,500,000 random bytes: four 1 MB slices, the last one partial.
SIZE=3500000
O="$WORK/origin"
mkdir -p "$O/archive.evideo.bg/v" "$O/live-1.evideo.bg/v" "$O/live-1.evideo.bg/e" \
  "$O/live-1.evideo.bg/n" "$O/live-1.evideo.bg/m" "$O/live-1.evideo.bg/s"
head -c "$SIZE" /dev/urandom > "$O/archive.evideo.bg/v/test.mp4"
cp "$O/archive.evideo.bg/v/test.mp4" "$O/live-1.evideo.bg/v/test.mp4"
: > "$O/live-1.evideo.bg/e/index.m3u8"   # empty 200, Content-Length: 0
for d in n m; do printf '#EXTM3U\n#EXTINF:4.0,\nseg1.ts\n' > "$O/live-1.evideo.bg/$d/index.m3u8"; done
head -c 1000 /dev/urandom > "$O/live-1.evideo.bg/s/seg1.ts"

cat > "$WORK/default.conf" <<'EOF'
log_format origin '$request_uri range=$http_range';
# Fake origin: logs every request, serves files with Range support, and sends the headers
# evideo sends that we must override: max-age=30, its own CORS header, and on the archive
# no-store plus a cookie (which would stop caching unless ignored)
server {
    listen 127.0.0.1:9000;
    access_log /tmp/origin.log origin;
    root /srv/origin;
    types { application/vnd.apple.mpegurl m3u8; video/mp2t ts; video/mp4 mp4; }
    add_header Cache-Control "public, max-age=30" always;
    add_header Access-Control-Allow-Origin "https://evideo.bg" always;
    location /archive.evideo.bg/ {
        add_header Cache-Control "private, no-store" always;
        add_header Expires "Thu, 01 Jan 1970 00:00:00 GMT" always;
        add_header Set-Cookie "cf_bm=secret; Path=/" always;
        add_header Access-Control-Allow-Origin "https://evideo.bg" always;
    }
}
EOF

name=live-proxy-nginx-test
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --network none \
  -v "$WORK/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$WORK/hls-proxy.conf:/etc/nginx/conf.d/hls-proxy.conf:ro" \
  -v "$LIVE/hls-http-settings-no-cf.conf:/etc/nginx/conf.d/hls-http-settings-no-cf.conf:ro" \
  -v "$LIVE/_cors_headers.inc:/etc/nginx/conf.d/_cors_headers.inc:ro" \
  -v "$LIVE/_cors_preflight.inc:/etc/nginx/conf.d/_cors_preflight.inc:ro" \
  -v "$LIVE/_proxy_headers.inc:/etc/nginx/conf.d/_proxy_headers.inc:ro" \
  -v "$O:/srv/origin:ro" \
  nginx:1.18.0-alpine >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1; rm -r "$WORK"' EXIT
P=http://127.0.0.1:8666
for _ in $(seq 1 20); do docker exec "$name" curl -sf -o /dev/null $P/healthz 2>/dev/null && break; sleep 0.5; done
docker exec "$name" curl -sf -o /dev/null $P/healthz 2>/dev/null \
  || { echo "FAIL: nginx did not start; its log:" >&2; docker logs "$name" >&2; exit 1; }

fails=0
# Requests run inside the container (no network, so no published ports)
req() { docker exec "$name" sh -c "$1" 2>&1; }
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$2', want '$3'"; fails=$((fails + 1)); fi; }
origin_hits() { req "grep -cF -- '$1' /tmp/origin.log || true"; }
code() { req "curl -s -o /dev/null -w '%{http_code}' $*"; }
# expected <offset> <length>: sha256 of that byte range of the origin file
expected() { req "tail -c +$(($1 + 1)) /srv/origin/archive.evideo.bg/v/test.mp4 | head -c $2 | sha256sum | cut -d' ' -f1"; }
MP4=/archive.evideo.bg/v/test.mp4
S0='range=bytes=0-1048575'; S1='range=bytes=1048576-2097151'
S2='range=bytes=2097152-3145727'; S3='range=bytes=3145728-4194303'

check "nginx -t"                        "$(req 'nginx -t >/dev/null 2>&1 && echo pass || echo fail')" pass
check "healthz"                         "$(code $P/healthz)" 200
check "non-evideo path → 403"           "$(code $P/example.com/a/index.m3u8)" 403
check "lookalike host → 403"            "$(code $P/archive.evideo.bg.evil.com/v/test.mp4)" 403
check "POST → 405"                      "$(code -X POST $P/live-1.evideo.bg/n/index.m3u8)" 405

# Archive MP4: a Range across the slice boundary at 1 MiB, twice
for i in 1 2; do
  hdr=$(req "curl -s -D - -o /tmp/r$i -H 'Range: bytes=1048000-1049999' $P$MP4")
  check "archive range #$i → 206"       "$(echo "$hdr" | head -1 | tr -d '\r' | cut -d' ' -f2)" 206
  check "archive range #$i Content-Range" "$(echo "$hdr" | grep -i '^content-range:' | tr -d '\r' | cut -d' ' -f2-)" "bytes 1048000-1049999/$SIZE"
  check "archive range #$i bytes"       "$(req "sha256sum /tmp/r$i | cut -d' ' -f1")" "$(expected 1048000 2000)"
done
check "archive range #2 is a cache HIT" "$(echo "$hdr" | grep -i '^x-cache-status:' | tr -d '\r' | cut -d' ' -f2)" HIT
check "two-slice range: slice 0 fetched once" "$(origin_hits "$MP4 $S0")" 1
check "two-slice range: slice 1 fetched once" "$(origin_hits "$MP4 $S1")" 1
check "two-slice range: 2 origin requests in all" "$(origin_hits "$MP4 ")" 2
check "origin got slice ranges, never the client's" "$(origin_hits 'range=bytes=1048000')" 0
check "archive: no Set-Cookie passed on" "$(echo "$hdr" | grep -ci '^set-cookie:' || true)" 0
check "archive: one Access-Control-Allow-Origin" "$(echo "$hdr" | grep -ci '^access-control-allow-origin:' || true)" 1
check "archive: CORS value is ours"     "$(echo "$hdr" | grep -i '^access-control-allow-origin:' | tr -d '\r' | cut -d' ' -f2)" '*'

# A seek near the end (last, partial slice)
hdr=$(req "curl -s -D - -o /tmp/r3 -H 'Range: bytes=3400000-' $P$MP4")
check "archive seek to tail → 206"      "$(echo "$hdr" | head -1 | tr -d '\r' | cut -d' ' -f2)" 206
check "archive seek to tail bytes"      "$(req "sha256sum /tmp/r3 | cut -d' ' -f1")" "$(expected 3400000 100000)"
check "tail seek fetched only slice 3"  "$(origin_hits "$MP4 $S3")" 1

# Full GET: 200, whole file, then served from the cache
for i in 1 2; do
  out=$(req "curl -s -o /tmp/f$i -w '%{http_code} %{size_download}' $P$MP4")
  check "archive full GET #$i → 200, $SIZE bytes" "$out" "200 $SIZE"
done
check "archive full GET bytes"          "$(req "sha256sum /tmp/f2 | cut -d' ' -f1")" "$(expected 0 $SIZE)"
check "full GETs fetched only slice 2 (new)" "$(origin_hits "$MP4 $S2")" 1
check "archive: 4 origin requests for 4 slices, in all" "$(origin_hits "$MP4 ")" 4
check "archive OPTIONS preflight → 204" "$(code -X OPTIONS $P$MP4)" 204

# Another *.evideo.bg host's MP4 stays passthrough: the client's Range goes to the origin each time
for _ in 1 2; do req "curl -s -o /dev/null -H 'Range: bytes=100-199' $P/live-1.evideo.bg/v/test.mp4" >/dev/null; done
check "non-archive mp4 not cached (2 → 2)" "$(origin_hits '/live-1.evideo.bg/v/test.mp4 range=bytes=100-199')" 2
check "non-archive mp4 range → 206"     "$(code -H "'Range: bytes=100-199'" $P/live-1.evideo.bg/v/test.mp4)" 206

# Playlists
for _ in 1 2; do code $P/live-1.evideo.bg/e/index.m3u8 >/dev/null; done
check "empty playlist not cached (2 → 2)" "$(origin_hits /live-1.evideo.bg/e/index.m3u8)" 2
for _ in 1 2 3; do code $P/live-1.evideo.bg/n/index.m3u8 >/dev/null; done
check "playlist cached (3 → 1)"         "$(origin_hits /live-1.evideo.bg/n/index.m3u8)" 1
code $P/live-1.evideo.bg/m/index.m3u8 >/dev/null
# nginx keeps "2s" until the clock passes the stored second + 2, so 2-3 s in practice;
# 3.5 s is past that and far below the origin's 30 s
sleep 3.5
hdr=$(req "curl -s -D - -o /dev/null $P/live-1.evideo.bg/m/index.m3u8")
check "origin max-age=30 does not stretch 2 s (→ 2 origin requests)" "$(origin_hits /live-1.evideo.bg/m/index.m3u8)" 2
check "playlist: one Cache-Control"     "$(echo "$hdr" | grep -ci '^cache-control:' || true)" 1
check "playlist: Cache-Control no-store" "$(echo "$hdr" | grep -i '^cache-control:' | tr -d '\r' | cut -d' ' -f2-)" no-store
check "playlist: one Access-Control-Allow-Origin" "$(echo "$hdr" | grep -ci '^access-control-allow-origin:' || true)" 1
check "playlist: CORS value is ours"    "$(echo "$hdr" | grep -i '^access-control-allow-origin:' | tr -d '\r' | cut -d' ' -f2)" '*'

# Segments
hdr=$(req "curl -s -D - -o /dev/null $P/live-1.evideo.bg/s/seg1.ts")
check "segment → 200"                   "$(echo "$hdr" | head -1 | tr -d '\r' | cut -d' ' -f2)" 200
check "segment: Cache-Control is ours only" "$(echo "$hdr" | grep -i '^cache-control:' | tr -d '\r' | cut -d' ' -f2- | tr '\n' '|')" 'public, max-age=20|'
check "segment: one Access-Control-Allow-Origin" "$(echo "$hdr" | grep -ci '^access-control-allow-origin:' || true)" 1
hdr=$(req "curl -s -D - -o /dev/null -H 'Range: bytes=0-9' $P/live-1.evideo.bg/v/test.mp4")
check "passthrough: one Access-Control-Allow-Origin" "$(echo "$hdr" | grep -ci '^access-control-allow-origin:' || true)" 1

errors=$(docker logs "$name" 2>&1 | grep -E '\[(error|crit|alert|emerg)\]' || true)
check "no errors in the nginx log"      "$(echo -n "$errors" | grep -c . || true)" 0
[ -n "$errors" ] && echo "$errors" | head -5

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
