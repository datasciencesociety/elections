#!/usr/bin/env bash
# fix-nginx.sh — push corrected nginx config to the running instance via SSM.
# No SSH or copy-paste required. Encodes the fix script as base64 to avoid
# shell quoting issues when passing complex content through SSM.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/.env.state"

# Base64-encode the fix script (no line wrapping; instance decodes and runs it)
ENCODED=$(base64 -i "$SCRIPT_DIR/_fix-script.sh" | tr -d '\n')

echo "==> Sending fix to $INSTANCE_ID via SSM..."
CMD_ID=$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[\"echo '$ENCODED' | base64 -d | bash\"]" \
  --comment "nginx config fix" \
  --query 'Command.CommandId' \
  --output text)

echo "    Command: $CMD_ID"
echo "==> Waiting for result (10s)..."
sleep 10

aws ssm get-command-invocation \
  --region "$REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' \
  --output text
