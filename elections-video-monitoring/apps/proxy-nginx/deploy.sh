#!/usr/bin/env bash
# deploy.sh — install nginx HLS proxy on Ubuntu 22.04
# Run as root (or via sudo)
set -euo pipefail

CACHE_DIR=/var/cache/nginx/hls
NGINX_USER=www-data

echo "==> Installing nginx..."
apt-get update -qq
apt-get install -y nginx

echo "==> Creating cache directory..."
mkdir -p "$CACHE_DIR"
chown "$NGINX_USER:$NGINX_USER" "$CACHE_DIR"
chmod 750 "$CACHE_DIR"

echo "==> Copying config..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/nginx.conf"            /etc/nginx/nginx.conf
cp "$SCRIPT_DIR/conf.d/hls-proxy.conf" /etc/nginx/conf.d/hls-proxy.conf
cp "$SCRIPT_DIR/conf.d/_proxy_headers.inc" /etc/nginx/conf.d/_proxy_headers.inc
cp "$SCRIPT_DIR/conf.d/_cors_headers.inc"  /etc/nginx/conf.d/_cors_headers.inc

echo "==> Removing default site..."
rm -f /etc/nginx/sites-enabled/default

echo "==> Raising OS fd limits..."
cat > /etc/security/limits.d/nginx-hls.conf <<EOF
www-data  soft  nofile  131072
www-data  hard  nofile  131072
root      soft  nofile  131072
root      hard  nofile  131072
EOF

# Also raise the systemd unit override
mkdir -p /etc/systemd/system/nginx.service.d
cat > /etc/systemd/system/nginx.service.d/limits.conf <<EOF
[Service]
LimitNOFILE=131072
EOF
systemctl daemon-reload

echo "==> Testing config..."
nginx -t

echo "==> Reloading nginx..."
systemctl enable nginx
systemctl restart nginx

echo "==> Done. Proxy listening on :80"
echo "    Cache at: $CACHE_DIR"
echo "    Logs at:  /var/log/nginx/"
