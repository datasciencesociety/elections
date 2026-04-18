# nginx HLS Proxy

Caching reverse proxy for `evideo.bg` election video streams. Sits between viewers and the origin, reducing origin load and providing CORS headers for browser players.

**Public endpoint:** `https://evideo.izborenmonitor.com` (Cloudflare → EC2 port 80)

## URL scheme

```
/{hostname}/{path}  →  https://{hostname}/{path}
```

Only `evideo.bg` and subdomains (e.g. `archive.evideo.bg`) are allowed — everything else returns 403.

Examples:
```
/evideo.bg/live/stream.m3u8          →  https://evideo.bg/live/stream.m3u8
/archive.evideo.bg/le2025.../file.mp4  →  https://archive.evideo.bg/le2025.../file.mp4
```

## Cache behaviour

| File type | Cache TTL | Browser cache | Notes |
|-----------|-----------|---------------|-------|
| `.m3u8` | 2 s | no-store | Players poll every ~2 s |
| `.ts` / `.m4s` | 20 s | public, max-age=20 | Segments are immutable |
| `.mp4` / other | none | upstream value | Pure passthrough — range requests must flow through |

## AWS deployment

### Prerequisites (once)

```bash
aws configure sso   # SSO region: us-east-1, start URL: https://ilchev.awsapps.com/start
aws sso login --profile elections
export AWS_PROFILE=elections
```

### Provision

```bash
cd elections-video-monitoring/apps/proxy-nginx/aws
bash provision.sh        # creates SG, IAM role, EIP, launches c6a.xlarge in eu-central-1
bash verify.sh           # polls /healthz, checks headers, tails logs via SSM
```

State is saved to `.env.state` (INSTANCE_ID, ALLOC_ID, ELASTIC_IP, SG_ID).

### Point Cloudflare at the new IP

1. Cloudflare DNS → update the `evideo` A record to the new `ELASTIC_IP`
2. Set to orange cloud (proxied)
3. SSL/TLS → Flexible

### Push config fixes to a running instance (no SSH)

Edit `_fix-script.sh`, then:

```bash
bash fix-nginx.sh
```

This base64-encodes the script and runs it on the instance via SSM — no copy-paste, no SSH needed.

### Teardown after event

```bash
bash teardown.sh
```

Terminates instance + releases EIP.

---

## Scaling to multiple servers (Route 53)

When one instance isn't enough (~3K concurrent at 4 Mbps per `c6a.xlarge`), spin up additional instances and load-balance with Route 53 weighted routing.

```bash
# Each run creates its own EIP; rename state files to avoid overwriting
bash provision.sh && mv .env.state .env.state.server1
bash provision.sh && mv .env.state .env.state.server2
```

Then add weighted A records in Route 53 (one per EIP, equal Weight = round-robin, TTL 30s) and attach health checks polling `/healthz`.

---

## Instance sizes

| Type | vCPU | RAM | Network | ~Concurrent viewers |
|------|------|-----|---------|---------------------|
| `c6a.xlarge` | 4 | 8 GB | 10 Gbps | ~3 K at 4 Mbps |
| `c6a.4xlarge` | 16 | 32 GB | 25 Gbps | ~12 K at 4 Mbps |

---

## Hardening applied

- `server_tokens off` — nginx version hidden
- Method allowlist: `GET`, `HEAD`, `OPTIONS` only (405 on everything else)
- `client_max_body_size 1k` — no request body needed
- Client timeouts: 10 s header + body (drops slow-loris clients)
- `real_ip_header CF-Connecting-IP` — logs show real visitor IPs
- Rate limit: 300 req/min per real IP, burst 50 (via `limit_req_zone`)
- `proxy_ssl_server_name on` — required SNI for Cloudflare-hosted origins
- `resolver 169.254.169.253 ipv6=off` — AWS internal DNS, no IPv6 failures
- MP4 passthrough: `proxy_buffering off` + `proxy_cache off` — range requests work correctly

---

## Key production lessons

**proxy_ssl_server_name on** — required when `proxy_pass` uses a variable. Without it, nginx doesn't send SNI and Cloudflare-backed origins return `SSL handshake failure (alert 40)`.

**resolver ipv6=off** — EC2 has no IPv6 by default. Without this, nginx tries Cloudflare's IPv6 addresses and gets `connect() failed (101)`.

**proxy_buffering off for MP4** — browser players use `Range: bytes=X-Y` for seeking. nginx buffering intercepts range requests and returns 200 instead of 206, breaking playback.

**CORS in location blocks** — `add_header` inside `if {}` at server level is not allowed in nginx 1.18. The OPTIONS block must be inside each location, included via `_cors_preflight.inc`.

**Stuck cache entries** — failed requests can leave poisoned locked entries (`ignore long locked inactive cache entry`). Fix: `rm -rf /var/cache/nginx/hls/* && systemctl restart nginx` (SSM, no SSH needed).

**SSM runs as root** — no `sudo` needed in `aws ssm send-command` or `start-session`.
