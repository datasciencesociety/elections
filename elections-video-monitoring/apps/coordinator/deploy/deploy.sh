#!/usr/bin/env bash
# Deploy the coordinator over SSH: run tests, upload a release, install it with remote-install.sh.
# Usage: DEPLOY_HOST=ji@10.10.10.1 DOMAIN=stork-ai.com [DEPLOY_PORT=22] ./deploy.sh
# Passed through to the server: APP_DIR SERVICE_USER NODE_BIN ALLOW_NEW_DB ADOPT_NGINX
set -euo pipefail

: "${DEPLOY_HOST:?set DEPLOY_HOST, e.g. ji@10.10.10.1 (stork is reached over WireGuard)}"
# No default: the site, certificate and checks all follow DOMAIN
: "${DOMAIN:?set DOMAIN to the site this server serves, e.g. stork-ai.com}"
SSH_PORT=${DEPLOY_PORT:-22}
APPS=$(cd "$(dirname "$0")/../.." && pwd)
cd "$APPS"

# Deploy only committed code, so every release maps to a commit
git diff --quiet HEAD -- coordinator detector || { echo "Uncommitted changes in coordinator/ or detector/; commit first" >&2; exit 1; }
TS=$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)

if [ "${SKIP_TESTS:-}" != 1 ]; then
  echo "==> tests"
  (cd coordinator && node --test integration.test.js auth.unit.test.js auth.property.test.js middleware.property.test.js)
  # The browser and nginx tests need Playwright's Chromium and Docker; a skipped one is said out loud
  if (cd coordinator && node -e "require('fs').accessSync(require('@playwright/test').chromium.executablePath())") 2>/dev/null; then
    (cd coordinator && node --test volunteer-waiting.e2e.test.js)
  else echo "!! SKIPPED volunteer e2e: no Playwright Chromium (pnpm exec playwright install chromium)"; fi
  if docker info >/dev/null 2>&1; then ../scripts/test-nginx-hls.sh
  else echo "!! SKIPPED nginx /hls test: Docker is not running"; fi
fi

STAGE=election-deploy/$TS
echo "==> upload $STAGE to $DEPLOY_HOST"
ssh -p "$SSH_PORT" "$DEPLOY_HOST" "mkdir -p $STAGE"
rsync -az -e "ssh -p $SSH_PORT" \
  --exclude node_modules --exclude data --exclude .env --exclude 'test*' --exclude '*.test.js' --exclude specs \
  coordinator detector "$DEPLOY_HOST:$STAGE/"

pass=""
for v in APP_DIR SERVICE_USER NODE_BIN ALLOW_NEW_DB ADOPT_NGINX; do
  [ -n "${!v:-}" ] && pass="$pass $v=$(printf %q "${!v}")"
done
echo "==> install (sudo on the server)"
ssh -t -p "$SSH_PORT" "$DEPLOY_HOST" "sudo env$pass bash \$HOME/$STAGE/coordinator/deploy/remote-install.sh \$HOME/$STAGE $DOMAIN"
