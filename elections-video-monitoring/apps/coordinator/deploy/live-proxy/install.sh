#!/usr/bin/env bash
# Installs the video proxy config in this directory into /etc/nginx/conf.d on the live server.
# Never contacts evideo: the checks go only to the proxy on 127.0.0.1.
#
# Usage, on the server, from a copy of this directory (reviewed commit):
#   sudo bash install.sh
#
# It refuses to start unless the live files are exactly the ones committed verbatim before this
# change (the sha256 values below). It backs up /etc/nginx/conf.d to /root/proxy-<timestamp>/,
# installs, runs nginx -t, reloads, and checks. On any failure after installing it puts the
# backup back and reloads. nginx.conf is not touched.
set -euo pipefail

SRC=$(cd "$(dirname "$0")" && pwd)
CONF=/etc/nginx/conf.d
FILES=(hls-proxy.conf hls-http-settings-no-cf.conf _cors_headers.inc _cors_preflight.inc _proxy_headers.inc)
# sha256 of the live files as committed verbatim (commit "commit the live video proxy config verbatim")
declare -A LIVE_SHA=(
  [hls-proxy.conf]=c01643148607eda1c17eafc60ac3045731c477977834154e044e7894c4ce8560
  [hls-http-settings-no-cf.conf]=833f593172e699427e34fa930bfa6fa6d9fbe3e15ed8cef348d172263d11381c
  [_cors_headers.inc]=8ee8d7a764b3608c03e222308f24f518c0d267502d2ae207d2aad907c118c26f
  [_cors_preflight.inc]=95aae3056e1e4ebe964f377bdbf20d15ce1614c23c857d1beede0acb577da451
  [_proxy_headers.inc]=682d4d30961d1dc36a7dfd3c559b3645c63e9e6b873eb4d15d2048f9704f4461
)
CACHE_DIR=/var/cache/nginx/archive   # must match proxy_cache_path ... keys_zone=ARCHIVE
MIN_FREE_KB=$((1536 * 1024))         # 1.5 GB: the ARCHIVE cache may grow to 1 GB
PROXY=http://127.0.0.1:8666
BACKUP=/root/proxy-$(date +%Y%m%d-%H%M%S)

installed=0 restored=0 created_cache=0
step() { echo; echo "==> [$1/10] $2"; }
die() { echo "ERROR: $*" >&2; exit 1; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
workers() { pgrep -P "$(cat /run/nginx.pid)" | sort; }

undo() {
  [ "$installed" = 1 ] && [ "$restored" = 0 ] || return 0
  restored=1
  set +e   # keep going: every restore step matters even if one fails
  echo "==> UNDO: restoring $CONF from $BACKUP" >&2
  for f in "${FILES[@]}"; do install -m 644 -o root -g root "$BACKUP/conf.d/$f" "$CONF/$f"; done
  for f in "${FILES[@]}"; do
    [ "$(sha "$CONF/$f")" = "${LIVE_SHA[$f]}" ] || echo "UNDO: $CONF/$f does not match the backup, check by hand" >&2
  done
  [ "$created_cache" = 1 ] && rmdir "$CACHE_DIR" 2>/dev/null || true
  if nginx -t; then
    systemctl reload nginx && echo "UNDO: old config restored and reloaded" >&2
  else
    echo "UNDO: nginx -t fails even on the restored files: do NOT reload or restart nginx; investigate" >&2
  fi
}
on_exit() { local rc=$?; [ "$rc" = 0 ] || undo; exit "$rc"; }
trap on_exit EXIT

step 1 "preconditions"
[ "$(id -u)" = 0 ] || die "run with sudo"
for c in nginx curl sha256sum systemctl pgrep df ip; do command -v "$c" >/dev/null || die "$c not found"; done
[ -s /run/nginx.pid ] || die "nginx is not running (/run/nginx.pid missing)"
build=$(nginx -V 2>&1)
[[ $build == *--with-http_slice_module* ]] || die "this nginx is built without http_slice_module"
for f in "${FILES[@]}"; do
  [ -s "$SRC/$f" ] || die "$SRC/$f missing"
  [ "$(sha "$SRC/$f")" != "${LIVE_SHA[$f]}" ] || [ "$f" = _cors_headers.inc ] || [ "$f" = _cors_preflight.inc ] \
    || die "$SRC/$f is the old live file, not the new one: wrong checkout?"
done
grep -q 'keys_zone=ARCHIVE' "$SRC/hls-http-settings-no-cf.conf" || die "new http settings lack the ARCHIVE zone"
grep -qF "$CACHE_DIR" "$SRC/hls-http-settings-no-cf.conf" || die "new http settings do not use $CACHE_DIR"
echo "ok: root, tools, slice module, new files present"

step 2 "live files still match the committed verbatim copies"
for f in "${FILES[@]}"; do
  [ -f "$CONF/$f" ] || die "$CONF/$f missing on the server; config drifted, stop and review"
  got=$(sha "$CONF/$f")
  [ "$got" = "${LIVE_SHA[$f]}" ] || die "$CONF/$f changed since it was committed (sha256 $got); review the diff before installing"
done
echo "ok: all ${#FILES[@]} live files match"

step 3 "current config passes nginx -t"
nginx -t || die "the config fails nginx -t BEFORE any change; fix that first"

step 4 "free disk for the archive cache"
free_kb=$(df -Pk /var/cache/nginx | awk 'NR == 2 { print $4 }')
[ "$free_kb" -ge "$MIN_FREE_KB" ] || die "only $((free_kb / 1024)) MB free on /var/cache/nginx, need 1536 MB"
echo "ok: $((free_kb / 1024)) MB free"

step 5 "back up $CONF to $BACKUP (root only)"
umask 077
[ ! -e "$BACKUP" ] || die "$BACKUP already exists"
install -d -m 700 -o root -g root "$BACKUP"
cp -a "$CONF" "$BACKUP/conf.d"
chmod -R go-rwx "$BACKUP"
for f in "${FILES[@]}"; do
  [ "$(sha "$BACKUP/conf.d/$f")" = "${LIVE_SHA[$f]}" ] || die "backup of $f does not match the live file"
done
diff -r "$CONF" "$BACKUP/conf.d" >/dev/null || die "backup differs from $CONF"
[ "$(stat -c '%U %a' "$BACKUP")" = "root 700" ] || die "$BACKUP is not root-only"
echo "ok: backup verified ($(ls "$BACKUP/conf.d" | wc -l) files)"

step 6 "cache directory $CACHE_DIR owned by nginx's user"
user=$(awk '$1 == "user" { sub(/;$/, "", $2); print $2; exit }' /etc/nginx/nginx.conf)
user=${user:-www-data}
group=$(id -gn "$user") || die "nginx user '$user' not found"
if [ ! -d "$CACHE_DIR" ]; then created_cache=1; fi
install -d -m 700 -o "$user" -g "$group" "$CACHE_DIR"
[ "$(stat -c '%U' "$CACHE_DIR")" = "$user" ] || die "$CACHE_DIR is not owned by $user"
echo "ok: $CACHE_DIR ($user:$group)"

step 7 "install the new files"
installed=1
for f in "${FILES[@]}"; do
  install -m 644 -o root -g root "$SRC/$f" "$CONF/$f"
  [ "$(sha "$CONF/$f")" = "$(sha "$SRC/$f")" ] || die "$CONF/$f did not install cleanly"
done
echo "ok: installed ${FILES[*]}"

step 8 "nginx -t"
nginx -t || die "new config fails nginx -t"

step 9 "reload"
before=$(workers)
systemctl reload nginx
new=""
for _ in $(seq 1 20); do
  new=$(comm -13 <(echo "$before") <(workers))
  [ -n "$new" ] && break
  sleep 0.5
done
[ -n "$new" ] || die "no new nginx workers after reload: the reload did not take"
# Until every old worker has stopped accepting (its title becomes "... is shutting down", or it
# exits), a check below could be answered by the old config and pass for the wrong reason.
accepting_old() { for p in $before; do ps -o args= -p "$p" 2>/dev/null; done | grep -c 'worker process$' || true; }
for _ in $(seq 1 60); do [ "$(accepting_old)" = 0 ] && break; sleep 0.5; done
[ "$(accepting_old)" = 0 ] || die "old nginx workers still accept connections 30 s after reload"
echo "ok: new workers $(echo $new); old workers no longer accept"

step 10 "checks (127.0.0.1 only, no request to evideo)"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$PROXY/healthz")
[ "$code" = 200 ] || die "healthz answered $code, want 200"
echo "ok: healthz 200"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$PROXY/example.com/a/index.m3u8")
[ "$code" = 403 ] || die "non-evideo path answered $code, want 403"
echo "ok: non-evideo path 403"
# An OPTIONS preflight is answered by the proxy itself, never forwarded
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X OPTIONS "$PROXY/archive.evideo.bg/x.mp4")
[ "$code" = 204 ] || die "archive preflight answered $code, want 204"
echo "ok: archive preflight 204"
# From a non-loopback address the proxy must refuse everything (answered by nginx itself, never forwarded)
EXT=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)
if [ -n "$EXT" ]; then
  body=$(curl -s --max-time 5 "http://$EXT:8666/healthz")
  [ "$body" = "local only" ] || die "proxy answered '$body' from $EXT, want 'local only'"
  echo "ok: refused from a non-loopback address"
fi

echo
echo "DONE. Backup: $BACKUP"
echo "Next, by hand: play the archive test video once through the public site (https://<live-domain>) and seek;"
echo "  expect 'X-Cache-Status: MISS' then 'HIT' on repeat, and files under $CACHE_DIR."
echo "  Watch: tail -f /var/log/nginx/error.log | grep -E 'slice|cache'"
echo "  ('unexpected status code 200 in slice response' means evideo ignores Range: undo below)."
echo "Undo: sudo install -m 644 $BACKUP/conf.d/{$(IFS=,; echo "${FILES[*]}")} $CONF/ && sudo nginx -t && sudo systemctl reload nginx"
