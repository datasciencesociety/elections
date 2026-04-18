#!/bin/bash
# EC2 user-data: installs nginx and writes all proxy configs inline.
# Runs as root on first boot via cloud-init.
set -euo pipefail
exec > >(tee /var/log/user-data.log | logger -t user-data) 2>&1

echo "==> Installing nginx..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx

echo "==> Writing nginx.conf..."
# Single-quoted EOF: bash does NOT expand $vars inside — required for nginx variable syntax.
tee /etc/nginx/nginx.conf <<'NGINX_EOF'
user  www-data;
worker_processes  auto;
worker_rlimit_nofile  131072;

error_log  /var/log/nginx/error.log  warn;
pid        /run/nginx.pid;

events {
    worker_connections  4096;
    multi_accept        on;
    use                 epoll;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    server_tokens off;

    log_format  hls_main  '$remote_addr - [$time_local] '
                           '"$request" $status $body_bytes_sent '
                           '"$upstream_addr" ${upstream_response_time}s '
                           'cache=$upstream_cache_status';

    access_log  /var/log/nginx/access.log  hls_main  buffer=64k  flush=5s;

    sendfile            on;
    tcp_nopush          on;
    tcp_nodelay         on;
    keepalive_timeout   30;
    keepalive_requests  500;

    client_max_body_size    1k;
    client_header_timeout   10s;
    client_body_timeout     10s;

    proxy_http_version      1.1;
    proxy_set_header        Connection        "";
    proxy_set_header        Host              $proxy_host;
    proxy_set_header        User-Agent        "Mozilla/5.0";
    proxy_set_header        Referer           "https://evideo.bg/";
    proxy_set_header        X-Real-IP         $remote_addr;

    proxy_connect_timeout   5s;
    proxy_send_timeout      15s;
    proxy_read_timeout      30s;

    proxy_buffering         on;
    proxy_buffer_size       16k;
    proxy_buffers           8  64k;
    proxy_busy_buffers_size 128k;

    proxy_cache_path  /var/cache/nginx/hls
        levels=1:2
        keys_zone=HLS:50m
        max_size=1g
        inactive=60s
        use_temp_path=off;

    proxy_cache_key  "$request_uri";

    resolver 169.254.169.253 valid=10s ipv6=off;
    proxy_ssl_server_name on;

    # Real IP from Cloudflare (update from https://www.cloudflare.com/ips-v4)
    real_ip_header     CF-Connecting-IP;
    set_real_ip_from   103.21.244.0/22;
    set_real_ip_from   103.22.200.0/22;
    set_real_ip_from   103.31.4.0/22;
    set_real_ip_from   104.16.0.0/13;
    set_real_ip_from   104.24.0.0/14;
    set_real_ip_from   108.162.192.0/18;
    set_real_ip_from   131.0.72.0/22;
    set_real_ip_from   141.101.64.0/18;
    set_real_ip_from   162.158.0.0/15;
    set_real_ip_from   172.64.0.0/13;
    set_real_ip_from   173.245.48.0/20;
    set_real_ip_from   188.114.96.0/20;
    set_real_ip_from   190.93.240.0/20;
    set_real_ip_from   197.234.240.0/22;
    set_real_ip_from   198.41.128.0/17;

    limit_req_zone $binary_remote_addr zone=hls_rate:10m rate=300r/m;

    include /etc/nginx/conf.d/*.conf;
}
NGINX_EOF

echo "==> Writing hls-proxy.conf..."
tee /etc/nginx/conf.d/hls-proxy.conf <<'HLS_EOF'
server {
    listen      80;
    server_name _;

    if ($request_method !~ ^(GET|HEAD|OPTIONS)$) {
        return 405;
    }

    location = /healthz {
        access_log off;
        return 200 "OK\n";
    }

    location ~ ^/((?:[a-z0-9-]+\.)*evideo\.bg)(/.+\.m3u8.*)$ {
        limit_req zone=hls_rate burst=30 nodelay;
        include /etc/nginx/conf.d/_cors_preflight.inc;
        set $ups_host $1;
        set $ups_path $2;
        proxy_pass https://$ups_host$ups_path$is_args$args;
        proxy_set_header Host $ups_host;
        include /etc/nginx/conf.d/_proxy_headers.inc;
        include /etc/nginx/conf.d/_cors_headers.inc;
        proxy_cache             HLS;
        proxy_cache_valid       200 2s;
        proxy_cache_valid       206 2s;
        proxy_cache_use_stale   error timeout updating invalid_header;
        proxy_cache_background_update on;
        proxy_cache_lock        on;
        proxy_cache_lock_timeout 2s;
        add_header X-Cache-Status $upstream_cache_status always;
        add_header X-Upstream-Response-Time $upstream_response_time always;
        add_header Cache-Control "no-store" always;
    }

    location ~ ^/((?:[a-z0-9-]+\.)*evideo\.bg)(/.+\.(ts|m4s).*)$ {
        limit_req zone=hls_rate burst=30 nodelay;
        include /etc/nginx/conf.d/_cors_preflight.inc;
        set $ups_host $1;
        set $ups_path $2;
        proxy_pass https://$ups_host$ups_path$is_args$args;
        proxy_set_header Host $ups_host;
        include /etc/nginx/conf.d/_proxy_headers.inc;
        include /etc/nginx/conf.d/_cors_headers.inc;
        proxy_cache             HLS;
        proxy_cache_valid       200 20s;
        proxy_cache_valid       206 20s;
        proxy_cache_use_stale   error timeout updating;
        proxy_cache_background_update on;
        proxy_cache_lock        on;
        proxy_cache_lock_timeout 5s;
        proxy_set_header Range "";
        add_header X-Cache-Status $upstream_cache_status always;
        add_header X-Upstream-Response-Time $upstream_response_time always;
        add_header Cache-Control "public, max-age=20" always;
    }

    location ~ ^/((?:[a-z0-9-]+\.)*evideo\.bg)(/.+)$ {
        limit_req zone=hls_rate burst=50 nodelay;
        include /etc/nginx/conf.d/_cors_preflight.inc;
        set $ups_host $1;
        set $ups_path $2;
        proxy_pass https://$ups_host$ups_path$is_args$args;
        proxy_set_header Host $ups_host;
        include /etc/nginx/conf.d/_proxy_headers.inc;
        include /etc/nginx/conf.d/_cors_headers.inc;
        proxy_buffering  off;
        proxy_cache      off;
        add_header X-Cache-Status BYPASS always;
    }

    location / {
        return 403 "Invalid proxy path\n";
    }
}
HLS_EOF

echo "==> Writing _proxy_headers.inc..."
tee /etc/nginx/conf.d/_proxy_headers.inc <<'PROXY_HDR_EOF'
proxy_set_header User-Agent      "Mozilla/5.0";
proxy_set_header Referer         "https://evideo.bg/";
proxy_set_header X-Real-IP       $remote_addr;
proxy_set_header Connection      "";
proxy_http_version 1.1;

proxy_hide_header Content-Security-Policy;
proxy_hide_header X-Frame-Options;
proxy_hide_header Strict-Transport-Security;
PROXY_HDR_EOF

echo "==> Writing _cors_headers.inc..."
tee /etc/nginx/conf.d/_cors_headers.inc <<'CORS_HDR_EOF'
add_header Access-Control-Allow-Origin  "*"                  always;
add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
add_header Access-Control-Allow-Headers "*"                  always;
add_header Access-Control-Expose-Headers "content-length, content-range, accept-ranges" always;
CORS_HDR_EOF

echo "==> Writing _cors_preflight.inc..."
tee /etc/nginx/conf.d/_cors_preflight.inc <<'CORS_PRE_EOF'
if ($request_method = OPTIONS) {
    add_header Access-Control-Allow-Origin  "*"                  always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Allow-Headers "*"                  always;
    return 204;
}
CORS_PRE_EOF

echo "==> Removing default site..."
rm -f /etc/nginx/sites-enabled/default

echo "==> Creating cache directory..."
mkdir -p /var/cache/nginx/hls
chown www-data:www-data /var/cache/nginx/hls
chmod 750 /var/cache/nginx/hls

echo "==> Raising OS fd limits..."
tee /etc/security/limits.d/nginx-hls.conf <<'LIMITS_EOF'
www-data  soft  nofile  131072
www-data  hard  nofile  131072
root      soft  nofile  131072
root      hard  nofile  131072
LIMITS_EOF

echo "==> Applying systemd unit fd override..."
mkdir -p /etc/systemd/system/nginx.service.d
tee /etc/systemd/system/nginx.service.d/limits.conf <<'SYSTEMD_EOF'
[Service]
LimitNOFILE=131072
SYSTEMD_EOF
systemctl daemon-reload

echo "==> Testing nginx config..."
nginx -t

echo "==> Starting nginx..."
systemctl enable nginx
systemctl start nginx

echo "==> Done." | tee /var/log/user-data-done
date -u >> /var/log/user-data-done
