#!/usr/bin/env bash
# Local nginx with the same /hls proxy as the live site, in front of the coordinator on the host.
# Usage: scripts/dev-nginx.sh [PORT of the coordinator, default 3000]
# Start the coordinator with PROXY_URL=/hls, then open http://localhost:8080.
set -euo pipefail

PORT=${1:-${PORT:-3000}}
DEPLOY=$(cd "$(dirname "$0")/../apps/coordinator/deploy" && pwd)
# Under $HOME: colima and Docker Desktop share it with the VM by default, unlike $TMPDIR
CONF=${XDG_CACHE_HOME:-$HOME/.cache}/coordinator-nginx/default.conf
mkdir -p "$(dirname "$CONF")"
sed "s#@PORT@#$PORT#g" "$DEPLOY/nginx-dev.conf" > "$CONF"

# nginx 1.18 matches the live server (Ubuntu's nginx/1.18.0)
exec docker run --rm --name coordinator-nginx -p 8080:8080 \
  --add-host host.docker.internal:host-gateway \
  -v "$CONF:/etc/nginx/conf.d/default.conf:ro" \
  -v "$DEPLOY/nginx-hls.conf:/etc/nginx/coordinator-hls.conf:ro" \
  -v "$DEPLOY/nginx-hls-http.conf:/etc/nginx/coordinator-hls-http.conf:ro" \
  nginx:1.18.0-alpine
