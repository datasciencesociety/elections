#!/usr/bin/env bash
# teardown.sh — terminate the EC2 instance and release the Elastic IP.
# Safe to run twice (idempotent). Run after the election event is over.
# Usage: bash teardown.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.env.state"

if [ -f "$STATE_FILE" ]; then
  # shellcheck source=/dev/null
  source "$STATE_FILE"
fi

: "${INSTANCE_ID:?Set INSTANCE_ID or run provision.sh first}"
: "${ALLOC_ID:?Set ALLOC_ID or run provision.sh first}"
: "${REGION:=eu-central-1}"

echo "=== HLS Proxy Teardown ==="
echo "    Instance : $INSTANCE_ID"
echo "    EIP alloc: $ALLOC_ID"
echo "    Region   : $REGION"
echo ""
read -r -p "Terminate instance and release EIP? This cannot be undone. [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo "==> Terminating instance $INSTANCE_ID..."
aws ec2 terminate-instances \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --output text > /dev/null

echo "==> Waiting for termination..."
aws ec2 wait instance-terminated \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID"
echo "    Terminated."

echo "==> Releasing Elastic IP $ALLOC_ID..."
aws ec2 release-address \
  --region "$REGION" \
  --allocation-id "$ALLOC_ID"
echo "    Released."

# Archive state file so it's not accidentally re-used
mv "$STATE_FILE" "$STATE_FILE.terminated.$(date +%Y%m%dT%H%M%S)"
echo "==> State file archived. Teardown complete."
