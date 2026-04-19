#!/usr/bin/env bash
# One-time install on the Hetzner box running elections-api.
# Run as a user with sudo rights. Idempotent — safe to re-run.
#
# Does:
#   1. Generates PROXY_SECRET (if not already set in /etc/elections-video.env)
#   2. Writes /etc/elections-video.env (mode 0640, owned by root:elections)
#   3. Installs the systemd unit → /etc/systemd/system/elections-video.service
#   4. Creates /opt/elections/discovery/data/ (SQLite lives here)
#   5. Splices the nginx /video/ location blocks into sites-enabled/elections
#   6. Enables + starts the service
#   7. Reloads nginx
#   8. Prints the PROXY_SECRET so you can copy it into the analyzer's
#      per-instance cloud-init.
#
# Prereqs:
#   - Repo checked out at /opt/elections with pnpm install already run
#     (i.e. one successful CI deploy; or run manually: cd /opt/elections && pnpm install)

set -euo pipefail

REPO=/opt/elections
APP_DIR="$REPO/discovery"
ENV_FILE=/etc/elections-video.env
UNIT=/etc/systemd/system/elections-video.service
NGINX_SITE=/etc/nginx/sites-enabled/elections
VIDEO_CONF_MARKER="# BEGIN /video/* discovery — managed by bootstrap.sh"
VIDEO_CONF_END="# END /video/* discovery"

log() { printf '[bootstrap] %s\n' "$*"; }

# 1/2: env file + secret
if [ ! -f "$ENV_FILE" ] || ! grep -q '^PROXY_SECRET=' "$ENV_FILE"; then
  SECRET="$(openssl rand -hex 32)"
  sudo install -m 0640 -o root -g elections /dev/null "$ENV_FILE"
  cat <<EOF | sudo tee "$ENV_FILE" >/dev/null
PROXY_SECRET=$SECRET
DB_PATH=$APP_DIR/data/video.db
PORT=3001
NODE_ENV=production
EOF
  sudo chmod 0640 "$ENV_FILE"
  sudo chown root:elections "$ENV_FILE"
  log "wrote $ENV_FILE with new PROXY_SECRET"
else
  SECRET="$(sudo awk -F= '/^PROXY_SECRET=/{print $2}' "$ENV_FILE")"
  log "$ENV_FILE already has PROXY_SECRET; reusing"
fi

# 3: systemd unit
sudo install -m 0644 "$APP_DIR/systemd/elections-video.service" "$UNIT"
log "installed $UNIT"

# 4: data dir
sudo mkdir -p "$APP_DIR/data"
sudo chown -R elections:elections "$APP_DIR/data"

# 5: nginx splice
if ! sudo grep -qF "$VIDEO_CONF_MARKER" "$NGINX_SITE"; then
  TMP="$(mktemp)"
  # Insert before the last closing brace of the first server block that
  # contains karta.izborenmonitor.com. Conservative sed: find the first
  # "server {" that mentions karta, then inject before its trailing "}".
  sudo awk -v marker="$VIDEO_CONF_MARKER" -v endmarker="$VIDEO_CONF_END" \
           -v snippet="$(cat "$APP_DIR/nginx/video.location.conf")" '
    BEGIN { in_karta=0; depth=0; injected=0 }
    /server_name .*karta\.izborenmonitor\.com/ { in_karta=1 }
    in_karta && /\{/ { depth++ }
    in_karta && /\}/ {
      depth--
      if (depth == 0 && !injected) {
        print marker
        print snippet
        print endmarker
        injected=1
        in_karta=0
      }
    }
    { print }
  ' "$NGINX_SITE" | sudo tee "$TMP" >/dev/null
  sudo mv "$TMP" "$NGINX_SITE"
  log "spliced /video/ location into $NGINX_SITE"
  sudo nginx -t
  sudo systemctl reload nginx
  log "reloaded nginx"
else
  log "nginx already has /video/ splice; skipping"
fi

# 6: enable + start
sudo systemctl daemon-reload
sudo systemctl enable elections-video
sudo systemctl restart elections-video
sleep 1
sudo systemctl status elections-video --no-pager --lines=5 || true

echo
echo "=============================================================="
echo " PROXY_SECRET = $SECRET"
echo "=============================================================="
echo "Bake this into the analyzer's per-instance cloud-init (NOT the snapshot)."
echo "Test: curl -fsS https://map.izborenmonitor.com/video/metrics | head -c 200"
