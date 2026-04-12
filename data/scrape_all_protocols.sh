#!/usr/bin/env bash
# Scrape CIK protocol URLs for all elections.
# Uses the cached results when available (data/cik_address_cache/<slug>.json).
# Only makes HTTP requests for elections not yet cached.
#
# Usage: bash data/scrape_all_protocols.sh

set -e
cd "$(dirname "$0")/.."

PYTHON=${PYTHON:-python3}

# Mapping: DB slug → CIK results URL slug
# The CIK site uses different path segments than our DB slugs.
# Some elections have sub-paths (e.g., mi2023 has /os, /kmet, /ko, /kr).
# The pvrns2021 has separate /ns and /pr paths.
declare -A SLUG_MAP=(
  # 2024
  ["pe202410"]="pe202410"
  ["pe202410_ks"]="pe202410_ks"
  ["europe2024_ns"]="europe2024"
  ["europe2024_ep"]="europe2024"
  # 2023
  ["mi2023_council"]="mi2023/os"
  ["mi2023_mayor_r1"]="mi2023/kmet"
  ["mi2023_kmetstvo_r1"]="mi2023/ko"
  ["mi2023_neighbourhood_r1"]="mi2023/kr"
  ["mi2023_mayor_r2"]="mi2023_tur2/kmet"
  ["mi2023_kmetstvo_r2"]="mi2023_tur2/ko"
  ["mi2023_neighbourhood_r2"]="mi2023_tur2/kr"
  ["ns2023"]="ns2023"
  # 2022
  ["ns2022"]="ns2022"
  # 2021
  ["pvrns2021_ns"]="pvrns2021/ns"
  ["pvrns2021_pvr_r1"]="pvrns2021/pvr"
  ["pvrns2021_pvr_r2"]="pvrns2021_tur2"
  ["pi2021_jul"]="pi2021_07"
  ["pi2021_apr"]="pi2021"
)

echo "Scraping CIK protocol URLs for all elections..."
echo ""

for db_slug in "${!SLUG_MAP[@]}"; do
  cik_slug="${SLUG_MAP[$db_slug]}"
  echo "=== $db_slug → $cik_slug ==="
  $PYTHON data/scrape_cik_addresses.py --election "$cik_slug" || echo "  FAILED: $db_slug"
  echo ""
done

echo "Done. Run scrape_cik_addresses.py with individual slugs to update the DB."
