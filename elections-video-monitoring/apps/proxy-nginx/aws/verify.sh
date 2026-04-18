#!/usr/bin/env bash
# verify.sh — confirm nginx is healthy after provisioning.
# Sources .env.state written by provision.sh, or accepts env vars directly.
# Usage: bash verify.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.env.state"

if [ -f "$STATE_FILE" ]; then
  # shellcheck source=/dev/null
  source "$STATE_FILE"
fi

: "${ELASTIC_IP:?Set ELASTIC_IP or run provision.sh first}"
: "${INSTANCE_ID:?Set INSTANCE_ID or run provision.sh first}"
: "${REGION:=eu-central-1}"

echo "=== Verifying HLS proxy at $ELASTIC_IP ==="

################################################################################
# 1. Poll /healthz until nginx responds (max ~4 min)
################################################################################
echo "==> Polling http://$ELASTIC_IP/healthz (nginx starts ~2-3 min after boot)..."
DEADLINE=$((SECONDS + 240))
until curl -sf --max-time 5 "http://$ELASTIC_IP/healthz" > /dev/null 2>&1; do
  if [ $SECONDS -ge $DEADLINE ]; then
    echo "ERROR: /healthz did not respond within 4 minutes."
    echo "Check: aws ssm start-session --region $REGION --target $INSTANCE_ID"
    exit 1
  fi
  printf '.'; sleep 5
done
echo ""
echo "    /healthz OK"

################################################################################
# 2. Check response headers
################################################################################
echo "==> Checking proxy headers on a .m3u8 path..."
HEADERS=$(curl -sI --max-time 5 "http://$ELASTIC_IP/evideo.bg/live/stream.m3u8" 2>&1 || true)
echo "$HEADERS" | grep -iE "(x-cache-status|access-control-allow-origin|cache-control|x-upstream-response-time)" || true

################################################################################
# 3. Verify fd limits via SSM Run Command
################################################################################
echo "==> Checking fd limits via SSM (AmazonSSMManagedInstanceCore required)..."
CMD_ID=$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["cat /proc/$(pgrep -o nginx)/limits | grep -i open.files", "cat /var/log/user-data-done"]' \
  --comment "verify fd limits" \
  --query 'Command.CommandId' \
  --output text)

echo "    SSM command $CMD_ID sent. Waiting for output..."
sleep 8
aws ssm get-command-invocation \
  --region "$REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' \
  --output text 2>/dev/null || echo "    (SSM not yet ready — check manually via SSM Session Manager)"

################################################################################
# 4. Tail nginx error log via SSM
################################################################################
echo "==> Tailing nginx error log via SSM..."
ERR_CMD_ID=$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["tail -20 /var/log/nginx/error.log"]' \
  --comment "nginx error log" \
  --query 'Command.CommandId' \
  --output text)

sleep 5
aws ssm get-command-invocation \
  --region "$REGION" \
  --command-id "$ERR_CMD_ID" \
  --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' \
  --output text 2>/dev/null || echo "    (SSM output not ready yet)"

echo ""
echo "======================================================="
echo "  Direct IP  : http://$ELASTIC_IP"
echo "  CF domain  : https://evideo.izborenmonitor.com  (after DNS propagation)"
echo "  Test stream: curl -sI 'http://$ELASTIC_IP/evideo.bg/live/stream.m3u8'"
echo "  MP4 test   : curl -sI 'http://$ELASTIC_IP/archive.evideo.bg/path/to/file.mp4'"
echo "  Load test  : k6 run -e TARGET_URL=http://$ELASTIC_IP ../load-test.js"
echo "======================================================="
