#!/usr/bin/env bash
# provision.sh — launch an EC2 instance running the nginx HLS proxy.
# Prerequisites:
#   - aws CLI configured (eu-central-1 profile or default)
#   - A key pair already exists in eu-central-1 (or leave KEY_PAIR_NAME empty to skip SSH)
# Usage: bash provision.sh
set -euo pipefail

################################################################################
# CONFIG — edit these before running
################################################################################
KEY_PAIR_NAME="${KEY_PAIR_NAME:-}"               # leave empty to omit SSH key
MY_CIDR="${MY_CIDR:-$(curl -s ifconfig.me)/32}"  # your IP for SSH access
REGION="${REGION:-eu-central-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-c6a.xlarge}"      # 4 vCPU, 8 GB, 10 Gbps
PROJECT_TAG="elections"
NAME_TAG="hls-proxy"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.env.state"

echo "=== HLS Proxy Provisioner (region: $REGION, type: $INSTANCE_TYPE) ==="

################################################################################
# Resolve latest Ubuntu 22.04 LTS AMD64 AMI from Canonical
################################################################################
echo "==> Resolving Ubuntu 22.04 AMI..."
AMI_ID=$(aws ec2 describe-images \
  --region "$REGION" \
  --owners 099720109477 \
  --filters \
    "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
    "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text)
echo "    AMI: $AMI_ID"

################################################################################
# IAM role + instance profile for SSM access (check-before-create)
################################################################################
ROLE_NAME="hls-proxy-ssm-role"
PROFILE_NAME="hls-proxy-instance-profile"

echo "==> Ensuring IAM role $ROLE_NAME..."
if ! aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version":"2012-10-17",
      "Statement":[{
        "Effect":"Allow",
        "Principal":{"Service":"ec2.amazonaws.com"},
        "Action":"sts:AssumeRole"
      }]
    }' \
    --description "HLS proxy: SSM access for log inspection" \
    --output text > /dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  echo "    Created IAM role."
else
  echo "    IAM role already exists, skipping."
fi

if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" &>/dev/null; then
  aws iam create-instance-profile \
    --instance-profile-name "$PROFILE_NAME" \
    --output text > /dev/null
  aws iam add-role-to-instance-profile \
    --instance-profile-name "$PROFILE_NAME" \
    --role-name "$ROLE_NAME"
  echo "    Created instance profile."
  # IAM changes take a few seconds to propagate
  sleep 10
else
  echo "    Instance profile already exists, skipping."
fi

################################################################################
# Security group (check-before-create)
################################################################################
SG_NAME="hls-proxy-sg"
echo "==> Ensuring security group $SG_NAME..."
SG_ID=$(aws ec2 describe-security-groups \
  --region "$REGION" \
  --filters "Name=group-name,Values=$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' \
  --output text 2>/dev/null || true)

if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID=$(aws ec2 create-security-group \
    --region "$REGION" \
    --group-name "$SG_NAME" \
    --description "HLS nginx proxy - election streams" \
    --query 'GroupId' \
    --output text)

  # HTTP — open to all viewers
  aws ec2 authorize-security-group-ingress \
    --region "$REGION" \
    --group-id "$SG_ID" \
    --protocol tcp --port 80 --cidr 0.0.0.0/0

  # HTTPS — pre-open for future TLS
  aws ec2 authorize-security-group-ingress \
    --region "$REGION" \
    --group-id "$SG_ID" \
    --protocol tcp --port 443 --cidr 0.0.0.0/0

  # SSH — restricted to operator IP
  if [ -n "$MY_CIDR" ]; then
    aws ec2 authorize-security-group-ingress \
      --region "$REGION" \
      --group-id "$SG_ID" \
      --protocol tcp --port 22 --cidr "$MY_CIDR"
  fi

  echo "    Created SG: $SG_ID"
else
  echo "    Security group already exists: $SG_ID"
fi

################################################################################
# Elastic IP
################################################################################
echo "==> Allocating Elastic IP..."
ALLOC_OUTPUT=$(aws ec2 allocate-address \
  --region "$REGION" \
  --domain vpc \
  --output json)
ALLOC_ID=$(echo "$ALLOC_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['AllocationId'])")
ELASTIC_IP=$(echo "$ALLOC_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['PublicIp'])")
echo "    EIP: $ELASTIC_IP (alloc: $ALLOC_ID)"

################################################################################
# Launch EC2 instance
################################################################################
echo "==> Launching EC2 instance..."

RUN_ARGS=(
  --region "$REGION"
  --image-id "$AMI_ID"
  --instance-type "$INSTANCE_TYPE"
  --security-group-ids "$SG_ID"
  --user-data "file://$SCRIPT_DIR/user-data.sh"
  --iam-instance-profile "Name=$PROFILE_NAME"
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3","DeleteOnTermination":true}}]'
  --tag-specifications
    "ResourceType=instance,Tags=[{Key=Name,Value=$NAME_TAG},{Key=Project,Value=$PROJECT_TAG}]"
    "ResourceType=volume,Tags=[{Key=Name,Value=$NAME_TAG},{Key=Project,Value=$PROJECT_TAG}]"
  --query 'Instances[0].InstanceId'
  --output text
)

if [ -n "$KEY_PAIR_NAME" ]; then
  RUN_ARGS+=(--key-name "$KEY_PAIR_NAME")
fi

INSTANCE_ID=$(aws ec2 run-instances "${RUN_ARGS[@]}")
echo "    Instance: $INSTANCE_ID"

################################################################################
# Wait for instance to be running
################################################################################
echo "==> Waiting for instance to enter 'running' state..."
aws ec2 wait instance-running \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID"
echo "    Instance is running."

################################################################################
# Associate Elastic IP
################################################################################
echo "==> Associating EIP $ELASTIC_IP → $INSTANCE_ID..."
aws ec2 associate-address \
  --region "$REGION" \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "$ALLOC_ID" \
  --output text > /dev/null
echo "    Associated."

################################################################################
# Write state file (sourced by verify.sh and teardown.sh)
################################################################################
cat > "$STATE_FILE" <<EOF
# Generated by provision.sh on $(date -u)
REGION=$REGION
INSTANCE_ID=$INSTANCE_ID
ALLOC_ID=$ALLOC_ID
ELASTIC_IP=$ELASTIC_IP
SG_ID=$SG_ID
EOF
echo "==> State written to $STATE_FILE"

echo ""
echo "======================================================="
echo "  Proxy IP : http://$ELASTIC_IP"
echo "  Health   : http://$ELASTIC_IP/healthz"
echo "  SSH      : ssh ubuntu@$ELASTIC_IP  (or use SSM — no SSH needed)"
echo "  SSM      : aws ssm start-session --region $REGION --target $INSTANCE_ID"
echo ""
echo "  nginx starts via user-data in ~2-3 min after boot."
echo "  Run: bash verify.sh"
echo ""
echo "  Then update Cloudflare A record to point to $ELASTIC_IP"
echo "  (orange cloud + Flexible SSL for HTTPS via CF)"
echo "======================================================="
