#!/usr/bin/env bash
# Runs on the server as root (called by deploy.sh): installs a staged release, backs up the DB,
# switches the `current` symlink, and rolls back if the app or its auth checks fail.
# Usage: remote-install.sh <stage-dir> <domain>
# Env: APP_DIR (/opt/election-coordinator), SERVICE_USER (default: owner of DB_PATH), NODE_BIN,
#      ALLOW_NEW_DB=1, ADOPT_NGINX=1 (disable other nginx sites that serve <domain>)
set -euo pipefail

STAGE=$1 DOMAIN=$2
APP_DIR=${APP_DIR:-/opt/election-coordinator}
ENV_FILE=/etc/election-coordinator.env
UNIT=election-coordinator
SITE=/etc/nginx/sites-available/$UNIT
TS=$(basename "$STAGE")

die() { echo "ABORT: $*" >&2; exit 1; }
say() { echo "==> $*"; }
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }  # a missing key is empty, not fatal

# ── Preflight: refuse anything that could lose data or leave the site half-configured ──
[ -f "$ENV_FILE" ] || die "$ENV_FILE missing; start from deploy/election-coordinator.env.example"
DB_PATH=$(env_get DB_PATH); PORT=$(env_get PORT); PORT=${PORT:-3000}
[ -n "$(env_get COOKIE_SECRET)" ] || die "COOKIE_SECRET is empty in $ENV_FILE"
[ "$(env_get HOST)" = 127.0.0.1 ] || die "set HOST=127.0.0.1 in $ENV_FILE (nginx serves the public side)"
[ -n "$DB_PATH" ] || die "DB_PATH is empty in $ENV_FILE"
[ -f "$DB_PATH" ] || [ "${ALLOW_NEW_DB:-}" = 1 ] || die "DB_PATH=$DB_PATH does not exist; fix the path or set ALLOW_NEW_DB=1"
DB_DIR=$(dirname "$DB_PATH")

SERVICE_USER=${SERVICE_USER:-$(stat -c %U "$DB_PATH" 2>/dev/null || true)}
[ -n "$SERVICE_USER" ] && [ "$SERVICE_USER" != root ] || die "set SERVICE_USER (non-root) for the service"
NODE_BIN=${NODE_BIN:-$(sudo -u "$SERVICE_USER" -i bash -c 'command -v node' || true)}
[ -x "$NODE_BIN" ] || die "node not found for $SERVICE_USER; set NODE_BIN"
"$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "node $("$NODE_BIN" -v) is too old; node:sqlite needs >= 22.13"

[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] || die "no certificate for $DOMAIN (certbot certonly --webroot -w /var/www/html -d $DOMAIN)"

# Warn only: without a working proxy, cards play evideo directly and detection does not run
PROXY_URL=$(env_get PROXY_URL)
if [ -z "$PROXY_URL" ]; then
  echo "WARNING: PROXY_URL is empty; cards will play without detection" >&2
else
  pcode=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$PROXY_URL/healthz" || true)
  case $pcode in
    000) echo "WARNING: PROXY_URL $PROXY_URL does not answer" >&2 ;;
    3??) echo "WARNING: PROXY_URL $PROXY_URL redirects ($pcode); browsers will fail CORS on it" >&2 ;;
  esac
fi

others=$(grep -RlE "server_name[^;]*[[:space:]]$DOMAIN([[:space:];]|$)" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | grep -v "/$UNIT\$" || true)
if [ -n "$others" ]; then
  [ "${ADOPT_NGINX:-}" = 1 ] || die "other nginx configs serve $DOMAIN: $others — review, then rerun with ADOPT_NGINX=1 to disable them"
fi

holder=$(ss -ltnpH "sport = :$PORT" || true)
if [ -n "$holder" ] && ! systemctl is-active --quiet "$UNIT"; then
  die "port $PORT is held by a process this script does not manage: $holder — stop it first"
fi

# ── Install the release ──
say "release $TS"
REL=$APP_DIR/releases/$TS
mkdir -p "$APP_DIR/releases" "$DB_DIR"
rm -rf "$REL"; cp -a "$STAGE" "$REL"; chown -R root:root "$REL"
(cd "$REL/coordinator" && PATH="$(dirname "$NODE_BIN"):$PATH" npm ci --omit=dev --no-audit --no-fund --loglevel=error)
chown "$SERVICE_USER" "$DB_DIR"

if [ -f "$DB_PATH" ]; then
  BACKUP=$DB_DIR/backup-$TS.db
  "$NODE_BIN" -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1]).exec(`VACUUM INTO ${JSON.stringify(process.argv[2]).replace(/"/g, "\x27")}`)' "$DB_PATH" "$BACKUP"
  say "database backup: $BACKUP"
fi

PREV=""; [ -L "$APP_DIR/current" ] && PREV=$(readlink -f "$APP_DIR/current")
SAVED=$APP_DIR/rollback-$TS   # this deploy's previous unit/site files and disabled nginx sites
mkdir -p "$SAVED"
for f in "/etc/systemd/system/$UNIT.service" "$SITE"; do [ -f "$f" ] && cp "$f" "$SAVED/"; done

restore_config() {
  for f in $others; do mv "$SAVED/$(basename "$f")" "$f"; done
  if [ -f "$SAVED/$UNIT" ]; then cp "$SAVED/$UNIT" "$SITE"; else rm -f "/etc/nginx/sites-enabled/$UNIT" "$SITE"; fi
  if [ -f "$SAVED/$UNIT.service" ]; then cp "$SAVED/$UNIT.service" /etc/systemd/system/; fi
  systemctl daemon-reload
}

rollback() {
  echo "ROLLBACK: $*" >&2
  restore_config
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" "$APP_DIR/current"; systemctl restart "$UNIT" || true
  else
    systemctl disable --now --quiet "$UNIT" || true
    rm -f "/etc/systemd/system/$UNIT.service" "$APP_DIR/current"; systemctl daemon-reload
    echo "First install failed: the old nginx config is back; restart the old app process yourself." >&2
  fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  exit 1
}

render() {
  sed -e "s#@SERVICE_USER@#$SERVICE_USER#g" -e "s#@APP_DIR@#$APP_DIR#g" -e "s#@NODE_BIN@#$NODE_BIN#g" \
      -e "s#@DB_DIR@#$DB_DIR#g" -e "s#@DOMAIN@#$DOMAIN#g" -e "s#@PORT@#$PORT#g" "$1"
}
render "$REL/coordinator/deploy/$UNIT.service" > "/etc/systemd/system/$UNIT.service"
render "$REL/coordinator/deploy/nginx-site.conf" > "$SITE"
ln -sfn "$SITE" "/etc/nginx/sites-enabled/$UNIT"
for f in $others; do mv "$f" "$SAVED/"; say "disabled $f (saved in $SAVED)"; done

if ! nginx -t 2>&1; then
  restore_config
  die "nginx -t failed; nginx config restored"
fi

# ── Switch and verify ──
ln -sfn "$REL" "$APP_DIR/current"
systemctl daemon-reload
systemctl enable --quiet "$UNIT"
systemctl restart "$UNIT"

for _ in $(seq 1 20); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" 2>/dev/null && break; sleep 1; done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" || rollback "app did not answer on 127.0.0.1:$PORT (journalctl -u $UNIT)"
systemctl reload nginx

pub() { curl -sk -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "$@"; }
[ "$(pub "https://$DOMAIN/login")" = 200 ] || rollback "https://$DOMAIN/login did not return 200 through nginx"
# Auth must deny by default: one admin route and one volunteer route, without a login
for route in /api/streams/toggle /api/report; do
  code=$(pub -X POST -H 'Content-Type: application/json' -d '{}' "https://$DOMAIN$route")
  [ "$code" = 401 ] || rollback "unauthenticated POST $route returned $code, expected 401"
done
[ "$(pub -H 'Cookie: session=abc.def' "https://$DOMAIN/admin")" = 302 ] || rollback "malformed cookie did not redirect to /login"

# keep the 5 newest releases
ls -1dt "$APP_DIR"/releases/* | tail -n +6 | xargs -r rm -rf
say "live: https://$DOMAIN (release $TS, service user $SERVICE_USER)"
