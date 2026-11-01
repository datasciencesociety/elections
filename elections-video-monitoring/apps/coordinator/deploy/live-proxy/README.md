# Live video proxy config

These files mirror the running proxy: the copies in `/etc/nginx/conf.d/` on the production server (nginx 1.18.0, Ubuntu, built with `http_slice_module`). They differ from `../nginx-hls*.conf`. Edit them here, test with `scripts/test-nginx-live-proxy.sh`, and install with `install.sh`.
