# nginx HLS proxy

- The nginx config exists in 4 places. Change all of them together: `nginx.conf` + `conf.d/`, `aws/user-data.sh` (new instances) and `aws/_fix-script.sh` (running instances).
- Each stream has one viewer, so the cache saves almost nothing; the network is the bottleneck. The `limit_req` value is sized for shared Wi-Fi: about 45 requests/min per card.
- `teardown.sh` releases the Elastic IP. Afterwards, delete the Cloudflare record, or it will point at another AWS customer.
