#!/usr/bin/env bash
# Read-only probe of a server before a coordinator deploy. Changes nothing on the running system;
# writes a snapshot to /root/predeploy-<timestamp>/ (mode 700) and prints a summary.
#
# The snapshot preserves what is running, including changes other people deployed without
# pushing: a tarball of each app directory, a manifest of git blob hashes (check it locally with
# deploy/drift-check.sh), the full nginx config, the env keys, and a consistent DB copy.
#
# Usage (as root on the server): bash preflight.sh <domain> [port]
set -uo pipefail   # no -e: a failed probe is reported, not fatal

DOMAIN=${1:?usage: preflight.sh <domain> [port]}
PORT=${2:-3000}
SNAP=/root/predeploy-$(date +%Y%m%d-%H%M%S)
mkdir -p "$SNAP" && chmod 700 "$SNAP"
exec > >(tee "$SNAP/summary.txt") 2>&1

h() { printf '\n== %s\n' "$*"; }
warn() { echo "!! $*"; }
# The summary is read on screen and pasted into chats: hide passwords, tokens and URL credentials
mask() { sed -E 's#(://[^/:@[:space:]]+:)[^@[:space:]]+@#\1***@#g; s/([A-Za-z_]*(PASS|SECRET|TOKEN|KEY|PWD)[A-Za-z_]*[=:][[:space:]]*)[^[:space:]]+/\1***/Ig'; }
NODE=$(command -v node || ls /usr/local/bin/node /usr/bin/node 2>/dev/null | head -1)

h "host"
echo "$(hostname)  $(date -Is)  up $(uptime -p 2>/dev/null)"
echo "cpus=$(nproc)  mem=$(free -m | awk '/Mem:/{print $2" MB, "$7" MB available"}')"
df -h / /var /var/log /opt /home 2>/dev/null | awk 'NR==1 || !seen[$1]++'
for i in /sys/class/net/*; do n=$(basename "$i"); [ "$n" = lo ] && continue; echo "nic $n speed=$(cat "$i/speed" 2>/dev/null || echo ?) Mb/s"; done
echo "node=$($NODE -v 2>/dev/null || echo missing) ($NODE)  nginx=$(nginx -v 2>&1 | cut -d/ -f2)"

h "who listens on :$PORT, :80, :443"
ss -ltnpH "( sport = :$PORT or sport = :80 or sport = :443 )"

# Every app directory worth preserving: the process on $PORT, other node server.js processes,
# and a release installed by deploy.sh (someone may have deployed already)
declare -A ROOTS SEEN
for pid in $(ss -ltnpH "sport = :$PORT" | grep -o 'pid=[0-9]*' | cut -d= -f2) $(pgrep -x node); do
  [ -d "/proc/$pid" ] || continue
  grep -qa 'server\.js' "/proc/$pid/cmdline" || ss -ltnpH "sport = :$PORT" | grep -q "pid=$pid," || continue
  [ -n "${SEEN[$pid]:-}" ] && continue; SEEN[$pid]=1
  cwd=$(readlink -f "/proc/$pid/cwd")
  h "process $pid"
  echo "user=$(stat -c %U "/proc/$pid") started=$(ps -o lstart= -p "$pid") cwd=$cwd"
  echo "cmd: $(tr '\0' ' ' < "/proc/$pid/cmdline" | mask)"
  echo "unit: $(grep -o '[^/]*\.service' "/proc/$pid/cgroup" | head -1 || echo none)"
  # Env holds secrets: keys on screen, full copy only in the snapshot
  tr '\0' '\n' < "/proc/$pid/environ" > "$SNAP/environ-$pid"; chmod 600 "$SNAP/environ-$pid"
  echo "env keys: $(cut -d= -f1 "$SNAP/environ-$pid" | grep -vE '^(PATH|HOME|PWD|SHLVL|_|LANG|TERM|USER|LOGNAME|SHELL|OLDPWD|MAIL|LS_COLORS|SSH_.*|XDG_.*)$' | tr '\n' ' ')"
  # An app dir is the folder holding coordinator/ (and detector/), else the cwd itself
  root=$cwd; [ "$(basename "$cwd")" = coordinator ] && root=$(dirname "$cwd")
  ROOTS[$root]=$pid
done
[ -L /opt/election-coordinator/current ] && ROOTS[$(readlink -f /opt/election-coordinator/current)]=release
[ ${#ROOTS[@]} -eq 0 ] && warn "no app process found on :$PORT and no deploy.sh release"

n=0
for root in "${!ROOTS[@]}"; do
  n=$((n + 1))
  h "app dir $n: $root (${ROOTS[$root]})"
  # As the checkout's owner: root gets "dubious ownership" and must not run its hooks
  g() { runuser -u "$(stat -c %U "$root")" -- git -C "$root" "$@"; }
  if g rev-parse 2>/dev/null; then
    { echo "HEAD $(g rev-parse HEAD) on $(g rev-parse --abbrev-ref HEAD)"
      echo "remotes:"; g remote -v
      echo "commits not on its upstream:"; g log --oneline '@{u}..HEAD' 2>&1
      echo "uncommitted:"; g status --porcelain
      echo "stashes:"; g stash list; } 2>&1 | mask | tee "$SNAP/git-$n.txt"
  else
    echo "not a git checkout (or git missing): the manifest below is the only record of its version"
  fi
  # Git blob hash of every file, so drift-check.sh can tell pushed versions from unpushed ones
  (cd "$root" && find . -type f \
      -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/data/*' \
      -not -name '*.db' -not -name '*.db-*' -not -name '*.log' -print0 \
    | "$NODE" -e '
        const fs = require("fs"), crypto = require("crypto");
        const files = fs.readFileSync(0, "utf8").split("\0").filter(Boolean);
        for (const f of files) {
          const b = fs.readFileSync(f);
          const id = crypto.createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
          const m = fs.statSync(f).mtime.toISOString();
          process.stdout.write(`${id}\t${m}\t${f.slice(2)}\n`);
        }') | sort -k3 > "$SNAP/manifest-$n.tsv"
  echo "manifest: $SNAP/manifest-$n.tsv ($(wc -l < "$SNAP/manifest-$n.tsv") files); newest changes:"
  sort -k2 -r "$SNAP/manifest-$n.tsv" | head -5 | awk -F'\t' '{print "  "$2"  "$3}'
  tar -C "$root" --exclude=node_modules --exclude='*.db' --exclude='*.db-*' -czf "$SNAP/app-$n.tar.gz" .
  echo "tarball: $SNAP/app-$n.tar.gz"
  echo "$root" > "$SNAP/app-$n.path"
done

h "database"
DB=$(grep -h '^DB_PATH=' "$SNAP"/environ-* /etc/election-coordinator.env 2>/dev/null | head -1 | cut -d= -f2-)
if [ -z "$DB" ]; then
  for root in "${!ROOTS[@]}"; do [ -f "$root/coordinator/data/streams.db" ] && DB=$root/coordinator/data/streams.db && break; done
fi
if [ -n "$DB" ] && [ -f "$DB" ]; then
  ls -l "$DB"*
  "$NODE" -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const n = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return "-"; } };
    console.log(["streams", "users", "sessions", "assignments", "reports", "contacts"].map(t => `${t}=${n(t)}`).join("  "));
    try {
      const r = db.prepare("SELECT SUM(length(url) = 0) stubs, MIN(url) a, MAX(url) b FROM streams").get();
      console.log(`stubs=${r.stubs ?? 0}  sample URLs: ${r.a || "-"} … ${r.b || "-"}`);
    } catch (e) { console.log("stream summary failed:", e.message); }
    db.exec(`VACUUM INTO ${JSON.stringify(process.argv[2]).replace(/"/g, "\x27")}`);
  ' "$DB" "$SNAP/db-backup.db" 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings'
  chmod 600 "$SNAP/db-backup.db" 2>/dev/null && echo "DB copy: $SNAP/db-backup.db"
else
  warn "DB not found (DB_PATH=${DB:-unset})"
fi

h "nginx"
nginx -T > "$SNAP/nginx-T.txt" 2>&1 && echo "full config: $SNAP/nginx-T.txt" || warn "nginx -T failed"
echo "files serving $DOMAIN: $(grep -RlE "server_name[^;]*[[:space:]]$DOMAIN([[:space:];]|$)" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | tr '\n' ' ')"
for f in $(grep -RlE "server_name[^;]*[[:space:]]$DOMAIN([[:space:];]|$)" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null); do
  echo "  $f also serves: $(grep -oE 'server_name[^;]*' "$f" | sed 's/server_name//' | tr -s ' \n' ' ')"
done
grep -E '^\s*(worker_processes|worker_connections|worker_rlimit_nofile)' /etc/nginx/nginx.conf | sed 's/^\s*/  /'
grep -q worker_rlimit_nofile /etc/nginx/nginx.conf || warn "worker_rlimit_nofile not set: about 1024 open files per worker caps concurrent video"
[ -f /etc/nginx/coordinator-hls-off ] && warn "the /hls emergency switch file exists: video proxy is OFF"

h "TLS certificate"
c=/etc/letsencrypt/live/$DOMAIN/fullchain.pem
[ -f "$c" ] && openssl x509 -noout -enddate -in "$c" || warn "no certificate at $c"

h "other things that run the app or touch it"
systemctl list-units --all --no-pager --plain 2>/dev/null | grep -iE 'election|coordinator|pm2' || echo "no matching systemd units"
for u in $(cut -d: -f1 /etc/passwd); do crontab -l -u "$u" 2>/dev/null | grep -v '^#' | mask | sed "s/^/cron $u: /"; done
command -v pm2 >/dev/null && pm2 list 2>/dev/null | mask
command -v docker >/dev/null && docker ps --format '{{.Names}} {{.Image}} {{.Ports}}' 2>/dev/null
[ -f /etc/election-coordinator.env ] && echo "/etc/election-coordinator.env keys: $(grep -oE '^[A-Z_]+' /etc/election-coordinator.env | tr '\n' ' ')"
[ -d /opt/election-coordinator/releases ] && echo "deploy.sh releases: $(ls /opt/election-coordinator/releases | tr '\n' ' ') current=$(readlink /opt/election-coordinator/current)"

h "snapshot"
ls -la "$SNAP"
echo "Copy it off the server before deploying (RUNBOOK.md step 2): $SNAP"
