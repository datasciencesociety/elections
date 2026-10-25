# Coordinator deploy runbook

For whoever deploys the coordinator to the live server. Placeholders: `<live-domain>` (the volunteer site), `<server>` (SSH target over the WireGuard tunnel), `<commit>` (the reviewed commit). Never write the live domain into the repo.

Local commands run from `elections-video-monitoring/` in your checkout. Every step ends with a check. If a check fails, stop and read **If something goes wrong** before going on.

## 0. Ground rules

- Other people may have changed the server by hand. **Nothing on the server is deleted or overwritten until step 2 has preserved it.**
- Never request evideo.bg or any `*.evideo.bg` host to test. It has wildcard DNS, so made-up subdomains reach it too, and Cloudflare blocks the IP after about 10 quick requests. The server's IP carries all volunteer video.
- Deploy outside volunteer hours. The switch takes about a minute and logs everyone out once if `COOKIE_SECRET` changes.
- Two people: one runs the commands, one reads the checks.

## 1. Locally: the release you will ship

```sh
git fetch && git checkout <commit> && git status          # clean tree
(cd apps/coordinator && node --test integration.test.js auth.unit.test.js auth.property.test.js middleware.property.test.js)
(cd apps/coordinator && node --test volunteer-waiting.e2e.test.js)   # needs Playwright Chromium
scripts/test-nginx-hls.sh                                  # needs Docker; offline
```

Check: all pass, `all passed` from the nginx test.

## 2. Probe and preserve the running system (read-only)

```sh
scp apps/coordinator/deploy/preflight.sh <server>:
ssh <server> 'sudo bash preflight.sh <live-domain> 3000'
# The snapshot holds secrets and the DB: copy it to a private folder outside the repo
mkdir -m 700 -p ~/predeploy
ssh <server> 'sudo tar -C /root -cz predeploy-<ts>' | tar -xz -C ~/predeploy
```

`preflight.sh` changes nothing (reading the DB updates its `-shm` file; that is normal). Read its summary and fill in:

| Check | Where in the summary | Note it |
|---|---|---|
| What serves port 3000: pid, user, cwd, command, systemd unit or not | `process …` | how to restart it if you must go back |
| Every app directory, and whether it is a git checkout | `app dir N` | |
| Git checkout: commits not on its upstream, uncommitted files, stashes | `git-N.txt` | all of it is drift |
| DB path, row counts, sample URLs | `database` | counts to compare after deploy |
| nginx files serving the domain, and **other domains in the same file** | `nginx` | `ADOPT_NGINX=1` disables whole files |
| `worker_connections`, `worker_rlimit_nofile` | `nginx` | step 4 |
| Certificate expiry | `TLS certificate` | must outlast the night |
| Disk free on `/`, `/var/log`, `/opt`; NIC speed | `host` | about 2.2 Mbit/s per volunteer card goes in and out |
| Someone already ran deploy.sh (`releases:`, env file keys) | `other things` | |
| cron jobs, pm2, docker containers touching the app | `other things` | stop or keep, decide with their owner |

### Drift: changes deployed but never pushed

```sh
apps/coordinator/deploy/drift-check.sh ~/predeploy/predeploy-<ts>/manifest-1.tsv    # once per manifest
```

It compares every file on the server with every pushed commit and tag, after `git fetch`.

- `same as HEAD` / `pushed, differs from HEAD`: already in the repo. The last line names the newest commit the server's code includes.
- `NOT IN REPO`: changed or added on the server only. It is already preserved in the snapshot's `app-N.tar.gz`. **Keep it in git too, locally first:**

```sh
mkdir -m 700 -p ~/predeploy/drift && tar -xzf ~/predeploy/predeploy-<ts>/app-1.tar.gz -C ~/predeploy/drift
git switch -c server-drift/<date> <the commit the last line named>
cp ~/predeploy/drift/<one NOT IN REPO path> apps/<same path>      # one file at a time
git diff --cached --stat; git diff                                  # read every line
git add apps/<same path> && git commit -m "server drift found on <date>, preserved before deploy"
```

Copy only code. Never copy `.env` files, keys, certificates, databases, logs, user or contact lists: they stay in the snapshot. **The repo is public:** push the branch only after a second person has read the diff and found no secrets, phone numbers or usernames. Until then it lives on your laptop and in the snapshot.

Then ask the author, by name in the team channel, whether the release needs it. Either merge it into the release and go back to step 1, or deploy without it and say so in the channel. Never discard it silently.

Check: each manifest has exit 0, or its drift is on a `server-drift/` branch and the decision is written down.

## 3. Settings the old app ran with

The snapshot's `environ-<pid>` files hold the old process's environment, including secrets. Carry over what the new release still uses, such as `ADMIN_*` (used only when the users table is empty), the DB path and the proxy. Write `/etc/election-coordinator.env` (root, mode 600):

```
PORT=3000
HOST=127.0.0.1
DB_PATH=<the DB path from step 2>
COOKIE_SECRET=<openssl rand -hex 32, or the old one to keep volunteers logged in>
COOKIE_SECURE=1
PROXY_URL=/hls
```

Check: `sudo stat -c '%U %a' /etc/election-coordinator.env` gives `root 600`. The DB file is owned by the non-root user that will run the service.

## 4. nginx limits (once per server)

Ubuntu's defaults (768 connections, 1024 open files per worker) stop at a few hundred cards. In `/etc/nginx/nginx.conf`, at top level `worker_rlimit_nofile 65535;`, and in `events {}` `worker_connections 8192;`, then:

```sh
sudo nginx -t && sudo systemctl reload nginx
```

Check: `nginx -T | grep -E 'worker_(connections|rlimit)'` shows both values.

## 5. Deploy

1. Stop the old app only if it is not systemd's `election-coordinator`. Use the pid from step 2: `sudo kill <pid>`, then `ss -ltn 'sport = :3000'` is empty.
2. From the checkout of `<commit>`:

   ```sh
   DEPLOY_HOST=<server> DOMAIN=<live-domain> ADOPT_NGINX=1 apps/coordinator/deploy/deploy.sh
   ```

   `ADOPT_NGINX=1` is only for the first run, and only if step 2 showed that the old nginx file serves nothing but this domain.

`remote-install.sh` refuses to start if anything is missing: env, cert, DB, node 22.13+, a port held by an unmanaged process, or other nginx files for the domain. It backs up the DB, switches, and checks:
- the app answers;
- nginx serves this release's `/hls/healthz`;
- unauthenticated writes get 401;
- `/hls` refuses a missing cookie and non-evideo hosts.

If any check fails it restores the previous config and release.

Check: it ends with `==> live: https://<live-domain> (release <ts>, …)` and printed a `database backup:` line.

## 6. Validate from outside

```sh
D=https://<live-domain>
curl -s  -o /dev/null -w '%{http_code}\n' $D/login                                   # 200
curl -s  -o /dev/null -w '%{http_code}\n' -X POST $D/api/streams/toggle              # 401
curl -s  $D/hls/healthz                                                              # OK <release>
curl -s  -o /dev/null -w '%{http_code}\n' $D/hls/evideo.bg/x.m3u8                    # 401 (no cookie; never reaches evideo)
curl -s  -o /dev/null -w '%{http_code}\n' "http://${D#https://}/hls/healthz"         # 301
```

Then in a browser:
- Log in as admin. Stream and user counts match step 2.
- Log in as a test volunteer. Cards show "Излъчването не е започнало" or video. Open one card's inspect panel.

## 7. Data for the night

- Stubs, if the live DB still has test or old streams. This wipes sessions and reports:
  `COORDINATOR_URL=https://<live-domain> SEED_USER=… SEED_PASS=… node scripts/seed.js <sections.json> --stubs --replace --force`
- Users and contacts: admin page uploads, from private files that are never in the repo.
- Scraper: from an operator laptop, never the server. See `apps/scraper/README.md`, Election day.

## During the night

| Watch | Command on the server |
|---|---|
| Bandwidth | `nload` or `iftop` (about 2.2 Mbit/s per card each way) |
| Proxy errors, 429s, 5xx | `sudo tail -f /var/log/nginx/access.log` (only failures are logged for `/hls`) |
| nginx limits | `sudo grep -c 'worker_connections are not enough' /var/log/nginx/error.log` |
| App | `journalctl -u election-coordinator -f` |

**Video proxy emergency switch, no reload:** `sudo touch /etc/nginx/coordinator-hls-off`. `/hls` then answers 410, and volunteer cards fall back to playing evideo directly from their own browsers, without detection. Use it if the server's bandwidth is full or evideo blocks its IP. Undo: `sudo rm /etc/nginx/coordinator-hls-off`; reloaded pages use the proxy again. While it is on, every `/hls` request is a logged 410, so filter them out when tailing: `grep -v '" 410 '`.

## If something goes wrong

- **Deploy aborted in preflight:** nothing changed. Fix what it names and run it again. A retry of the same release is fine.
- **Deploy rolled back by itself:** the previous release is live again. Read the ROLLBACK line and `journalctl -u election-coordinator`.
- **Bad release found later, while a good one is installed:**

  ```sh
  ls /opt/election-coordinator/releases                     # pick <good>
  sudo ln -sfn /opt/election-coordinator/releases/<good> /opt/election-coordinator/current
  sudo cp /opt/election-coordinator/rollback-<bad ts>/election-coordinator /etc/nginx/sites-available/
  sudo systemctl restart election-coordinator && sudo nginx -t && sudo systemctl reload nginx
  ```

  Or re-run `remote-install.sh` with the good release's stage directory. Pruning keeps the live and previous releases.
- **Back to the old app:**

  ```sh
  sudo systemctl disable --now election-coordinator
  sudo rm /etc/nginx/sites-enabled/election-coordinator
  sudo mv /opt/election-coordinator/rollback-<first ts>/<old site file> /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx
  ```

  Then start it the way step 2 recorded. The new release only added DB columns. If needed, restore the DB from `backup-<ts>.db` next to it, or from the snapshot's `db-backup.db`.

## Afterwards

- Keep the snapshot until the next deploy. It holds secrets: then delete `~/predeploy` from laptops and `/root/predeploy-*` from the server.
- Decide how long volunteer usernames, contact phones and reports are kept, then purge them.
