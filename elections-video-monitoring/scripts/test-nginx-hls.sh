#!/usr/bin/env bash
# Offline test of the /hls proxy config (apps/coordinator/deploy/nginx-hls*.conf) in nginx 1.18.
# The container has no network: proxy_pass is pointed at a fake origin inside the same nginx,
# so nothing reaches evideo. Needs Docker. Usage: scripts/test-nginx-hls.sh
set -euo pipefail

DEPLOY=$(cd "$(dirname "$0")/../apps/coordinator/deploy" && pwd)
# Under $HOME: colima and Docker Desktop share it with the VM, unlike $TMPDIR
WORK=${XDG_CACHE_HOME:-$HOME/.cache}/coordinator-nginx/test
rm -rf "$WORK"; mkdir -p "$WORK"

# Same file, one change: the upstream is the fake origin below instead of https://<evideo host>
sed 's#proxy_pass https://$hls_host$hls_path$is_args$args;#proxy_pass http://127.0.0.1:9000$hls_path$is_args$args;#' \
  "$DEPLOY/nginx-hls.conf" > "$WORK/hls.conf"
grep -q 'proxy_pass http://127.0.0.1:9000' "$WORK/hls.conf" || { echo "FAIL: proxy_pass line not found in nginx-hls.conf" >&2; exit 1; }

cat > "$WORK/default.conf" <<'EOF'
include /etc/nginx/hls-http.conf;
proxy_cache_path /var/cache/nginx/coordinator-hls levels=1:2 keys_zone=coord_hls_cache:10m max_size=100m inactive=1m use_temp_path=off;
log_format origin '$request_uri';
server {
    listen 8080;
    resolver 127.0.0.11 ipv6=off;
    include /etc/nginx/hls.conf;
}
# Fake origin: logs every request it gets, asks not to be cached, serves HTML for page.html
server {
    listen 127.0.0.1:9000;
    access_log /tmp/origin.log origin;
    add_header Cache-Control "no-cache" always;
    location ~ \.html$ { default_type text/html; return 200 "<script>alert(1)</script>"; }
    location / { default_type application/vnd.apple.mpegurl; return 200 "#EXTM3U\n#EXTINF:4.0,\nseg1.ts\n"; }
}
EOF

name=coordinator-nginx-test
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --network none \
  -v "$WORK/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$WORK/hls.conf:/etc/nginx/hls.conf:ro" \
  -v "$DEPLOY/nginx-hls-http.conf:/etc/nginx/hls-http.conf:ro" \
  nginx:1.18.0-alpine >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1' EXIT
for _ in $(seq 1 20); do docker exec "$name" curl -sf -o /dev/null http://127.0.0.1:8080/hls/healthz && break; sleep 0.5; done

COOKIE="session=eyJ1IjoidiJ9.$(printf 'a%.0s' $(seq 1 64))"
fails=0
# Requests run inside the container (no network, so no published ports)
req() { docker exec "$name" sh -c "$1" 2>&1; }
status() {  # status <cookie or -> <method> <path>
  local c=""; [ "$1" != - ] && c="-H 'Cookie: $1'"
  req "curl -s -o /dev/null -w '%{http_code}' $c -X $2 http://127.0.0.1:8080$3"
}
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$2', want '$3'"; fails=$((fails + 1)); fi; }
origin_hits() { req "grep -c '$1' /tmp/origin.log || true"; }

check "healthz"                         "$(status - GET /hls/healthz)" 200
check "no cookie → 401"                 "$(status - GET /hls/live-1.evideo.bg/a/index.m3u8)" 401
check "malformed cookie → 401"          "$(status session=x GET /hls/live-1.evideo.bg/a/index.m3u8)" 401
check "playlist with cookie → 200"      "$(status "$COOKIE" GET /hls/live-1.evideo.bg/a/index.m3u8)" 200
check "other host → 403"                "$(status "$COOKIE" GET /hls/example.com/a/index.m3u8)" 403
check "lookalike host → 403"            "$(status "$COOKIE" GET /hls/evideo.bg.evil.com/a/index.m3u8)" 403
check "non-media path → 403"            "$(status "$COOKIE" GET /hls/live-1.evideo.bg/page.html)" 403
check "POST → 403"                      "$(status "$COOKIE" POST /hls/live-1.evideo.bg/a/index.m3u8)" 403
check "html never reached the origin"   "$(origin_hits page.html)" 0

hdrs=$(req "curl -s -D - -o /dev/null -H 'Cookie: $COOKIE' http://127.0.0.1:8080/hls/live-1.evideo.bg/b/index.m3u8")
check "CSP sandbox on responses"        "$(echo "$hdrs" | grep -c "Content-Security-Policy: default-src 'none'; sandbox")" 1
check "nosniff kept"                    "$(echo "$hdrs" | grep -c 'X-Content-Type-Options: nosniff')" 1

for _ in 1 2 3; do status "$COOKIE" GET /hls/live-1.evideo.bg/c/index.m3u8 >/dev/null; done
check "playlist cached (3 requests → 1 upstream)" "$(origin_hits /c/index.m3u8)" 1
for _ in 1 2; do status "$COOKIE" GET /hls/live-1.evideo.bg/c/seg1.ts >/dev/null; done
check "segments not cached (2 → 2)"     "$(origin_hits /c/seg1.ts)" 2

codes=$(req "for i in \$(seq 1 200); do curl -s -o /dev/null -w '%{http_code}\n' -H 'Cookie: $COOKIE' http://127.0.0.1:8080/hls/live-1.evideo.bg/d/seg\$i.ts; done | sort | uniq -c")
check "rate limit answers 429"          "$(echo "$codes" | grep -c ' 429$')" 1

docker exec "$name" touch /etc/nginx/coordinator-hls-off
check "switch off → 410"                "$(status "$COOKIE" GET /hls/live-1.evideo.bg/e/index.m3u8)" 410
check "switch off, no cookie → 401"     "$(status - GET /hls/live-1.evideo.bg/e/index.m3u8)" 401
docker exec "$name" rm /etc/nginx/coordinator-hls-off

logged=$(docker logs "$name" 2>&1 | grep -c '" 200 ' || true)
check "200s are not access-logged"      "$logged" 0

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
