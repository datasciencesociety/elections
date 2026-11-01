# Live video proxy config

These files mirror the running proxy: the copies in `/etc/nginx/conf.d/` on the production server (nginx 1.18.0, Ubuntu, built with `http_slice_module`). They differ from `../nginx-hls*.conf`. Edit them here, test with `scripts/test-nginx-live-proxy.sh` (Docker, offline), and install with `sudo bash install.sh` on the server, from a copy of this directory at the reviewed commit.

`install.sh` refuses to run unless the server's files still match the verbatim copies committed before the change (sha256 inside the script). After installing a new version, update those hashes to the new files.
