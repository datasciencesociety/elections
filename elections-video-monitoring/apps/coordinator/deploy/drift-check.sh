#!/usr/bin/env bash
# Compare a server manifest (from preflight.sh) with every commit in the shared repo.
# Finds what runs on the server that was never pushed, so it can be preserved before a deploy.
#
# Usage (locally, in this repo): apps/coordinator/deploy/drift-check.sh <manifest.tsv> [app-dir-in-repo]
#   app-dir-in-repo defaults to elections-video-monitoring/apps (the folder holding coordinator/)
# Exit 0: every file matches some pushed commit. Exit 2: unpushed files found (listed).
set -euo pipefail

MANIFEST=${1:?usage: drift-check.sh <manifest.tsv> [app-dir-in-repo]}
APPDIR=${2:-elections-video-monitoring/apps}
cd "$(git rev-parse --show-toplevel)"

git fetch --all --quiet || echo "warning: git fetch failed; comparing with local refs only" >&2
# Every blob reachable from any branch or tag, local or remote
KNOWN=$(mktemp); trap 'rm -f "$KNOWN"' EXIT
git rev-list --all --objects | cut -d' ' -f1 | sort -u > "$KNOWN"

unpushed=0 older=0 same=0 newest=""
while IFS=$'\t' read -r blob mtime path; do
  head=$(git rev-parse -q --verify "HEAD:$APPDIR/$path" 2>/dev/null || true)
  if [ "$blob" = "$head" ]; then
    same=$((same + 1))
  elif grep -qx "$blob" "$KNOWN"; then
    older=$((older + 1))
    first=$(git log --all --format='%ad %h' --date=iso-strict --find-object="$blob" -- "$APPDIR/$path" | tail -1)
    [[ -n "$first" && "$first" > "$newest" ]] && newest=$first
    echo "pushed, differs from HEAD   $path   (version from ${first:-another path})"
  else
    unpushed=$((unpushed + 1))
    [ -n "$head" ] && what="changed" || what="new file"
    echo "NOT IN REPO ($what)        $path   modified $mtime"
  fi
done < "$MANIFEST"

echo
echo "same as HEAD: $same   pushed but different from HEAD: $older   NOT IN REPO: $unpushed"
[ -n "$newest" ] && echo "the server's pushed files are no newer than commit ${newest#* } (${newest%% *})"
if [ "$unpushed" -gt 0 ]; then
  echo "Preserve them before deploying: extract from the snapshot's app tarball and commit them on a"
  echo "branch (e.g. server-drift/<date>), then decide with their author whether the release needs them."
  exit 2
fi
