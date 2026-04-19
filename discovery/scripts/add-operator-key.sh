#!/usr/bin/env bash
# Print an API key for a human operator.
#
# Format: "<PROXY_SECRET>:<operator-name>"
# The whole string is what the operator sets as API_KEY when running the
# analyzer. No server restart required — all keys validate against the
# same shared PROXY_SECRET.
#
# Usage:
#   sudo ./add-operator-key.sh georgi
#   # copy the printed string to Georgi on a secure channel.

set -euo pipefail

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "usage: $0 <operator-name>"
  exit 1
fi

# Keep names simple / unambiguous — letters, digits, hyphens.
if [[ ! "$NAME" =~ ^[a-zA-Z0-9-]+$ ]]; then
  echo "ERROR: operator name must match [a-zA-Z0-9-]+"
  exit 1
fi

ENV_FILE=/etc/elections-video.env
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run bootstrap.sh first."
  exit 1
fi

SECRET="$(sudo awk -F= '/^PROXY_SECRET=/{print $2}' "$ENV_FILE")"
if [ -z "$SECRET" ]; then
  echo "ERROR: PROXY_SECRET not found in $ENV_FILE"
  exit 1
fi

echo
echo "=============================================================="
echo " API key for operator: $NAME"
echo "=============================================================="
echo
echo "  $SECRET:$NAME"
echo
echo "Operator usage:"
echo "  export API_KEY='$SECRET:$NAME'"
echo "  cd elections-video-monitoring/apps/analyzer"
echo "  ./scripts/run-locally.sh"
echo
echo "Revoking this operator means rotating PROXY_SECRET on the server"
echo "(breaks ALL keys — use sparingly)."
