#!/usr/bin/env python3
"""
Diff a fresh scrape against an existing seed and produce an updated seed.

Usage:
  python3 update_streams.py <new_scrape.json> <seed_json> <csv_file> [updated_seed_out]

  new_scrape.json:   fresh scraper output {section, url, label}
  seed_json:         existing seed (e.g. combined-v3-seed.json) — NOT modified
  csv_file:          check-assignments.csv — used to assign users to new sections
  updated_seed_out:  defaults to seed_json with the version number bumped
                     (combined-v3-seed.json → combined-v4-seed.json)

Logic:
  For each section in the new scrape:
    - Already in seed, same URL  → unchanged
    - Already in seed, URL diff  → update url + label in output
    - Not in seed                → add as new entry; assigned_users taken from
                                   CSV if present, otherwise null

  Sections already in seed but absent from new scrape are kept as-is.

  After processing, reports which sections from a built-in watch list
  (the 18 that had no URL in the previous run) are now found vs still missing.
  Pass --watch=sec1,sec2,... to override the watch list.

Output: writes updated_seed_out only; does not touch seed_json.
"""

import csv
import json
import os
import re
import sys

args      = [a for a in sys.argv[1:] if not a.startswith("--")]
watch_arg = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--watch=")), None)
# watch_list resolved after CSV is loaded (defaults to all CSV sections with a user)

if len(args) < 3:
    print("Usage: python3 update_streams.py <new_scrape.json> <seed_json> <csv_file> [out]")
    sys.exit(1)

SCRAPE_FILE = args[0]
SEED_FILE   = args[1]
CSV_FILE    = args[2]

def bump_version(path):
    name = os.path.basename(path)
    m = re.search(r'v(\d+)', name)
    if m:
        bumped = name.replace(f"v{m.group(1)}", f"v{int(m.group(1))+1}")
    else:
        root, ext = os.path.splitext(name)
        bumped = root + "-updated" + ext
    return os.path.join(os.path.dirname(path), bumped)

OUT_FILE = args[3] if len(args) > 3 else bump_version(SEED_FILE)

with open(SCRAPE_FILE, encoding="utf-8") as f:
    new_scrape = json.load(f)

with open(SEED_FILE, encoding="utf-8") as f:
    seed = json.load(f)

with open(CSV_FILE, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    csv_map = {row["section"].strip(): row["Assigned Users"].strip() for row in reader}

scrape_index = {s["section"]: s for s in new_scrape}
seed_index   = {e["section"]: e for e in seed}

# Default watch list: CSV sections that have a user but no URL in the current seed
watch_list = (
    watch_arg.split(",") if watch_arg
    else [s for s, u in csv_map.items() if u and s not in seed_index]
)

# Deep-copy seed so we can mutate
import copy
output = copy.deepcopy(seed)
out_index = {e["section"]: e for e in output}

url_updated = url_same = newly_added = 0

for section, scraped in scrape_index.items():
    entry = out_index.get(section)
    if entry is None:
        user = csv_map.get(section) or None
        new_entry = {
            "section":        section,
            "url":            scraped["url"],
            "label":          scraped.get("label", section),
            "assigned_users": user,
        }
        output.append(new_entry)
        out_index[section] = new_entry
        newly_added += 1
    elif entry["url"] != scraped["url"]:
        entry["url"]   = scraped["url"]
        entry["label"] = scraped.get("label", entry.get("label", section))
        url_updated += 1
    else:
        url_same += 1

output.sort(key=lambda s: s["section"])

with open(OUT_FILE, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"URLs updated:    {url_updated}")
print(f"URLs unchanged:  {url_same}")
print(f"Sections added:  {newly_added}")
print(f"Total in output: {len(output)}")
print(f"Written: {OUT_FILE}")

print(f"\n=== Watch list ({len(watch_list)} sections) ===")
found_now = []
still_missing = []
for s in watch_list:
    if s in scrape_index:
        found_now.append((s, scrape_index[s]["url"]))
    else:
        still_missing.append(s)

if found_now:
    print(f"NOW HAS URL ({len(found_now)}):")
    for s, url in found_now:
        print(f"  {s}  {url}")
if still_missing:
    print(f"STILL MISSING ({len(still_missing)}) — check manually on site:")
    for s in still_missing:
        print(f"  {s}")
