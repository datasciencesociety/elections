#!/usr/bin/env python3
"""
Patch assigned_users in a seed JSON file from a CSV source of truth,
and produce a v3 seed that also includes previously-missing sections
whose URLs can be found in a scraped streams file.

Usage:
  python3 fix_assignments.py <csv_file> <seed_json> <streams_json> [v3_output]

  csv_file:     CSV with columns 'section' and 'Assigned Users'
  seed_json:    existing seed (combined-v2-seed.json) — patched in-place
  streams_json: scraper output with {section, url, label} entries
  v3_output:    defaults to combined-v3-seed.json

Actions:
  - Patches assigned_users for all matching sections in seed_json
  - Adds sections that are in CSV+streams but missing from seed to v3
  - Writes patched seed_json in-place
  - Writes v3_output with all entries (patched v2 + new sections)
"""

import csv
import json
import sys
import os

if len(sys.argv) < 4:
    print("Usage: python3 fix_assignments.py <csv_file> <seed_json> <streams_json> [v3_output]")
    sys.exit(1)

CSV_FILE     = sys.argv[1]
SEED_FILE    = sys.argv[2]
STREAMS_FILE = sys.argv[3]
V3_FILE      = sys.argv[4] if len(sys.argv) > 4 else os.path.join(
    os.path.dirname(SEED_FILE), "combined-v3-seed.json"
)

with open(CSV_FILE, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    csv_map = {
        row["section"].strip(): row["Assigned Users"].strip()
        for row in reader
    }

with open(SEED_FILE, encoding="utf-8") as f:
    seed = json.load(f)

with open(STREAMS_FILE, encoding="utf-8") as f:
    streams = json.load(f)

streams_index = {s["section"]: s for s in streams}
seed_index    = {entry["section"]: entry for entry in seed}

patched = correct = skipped_no_user = 0
added_new = []
no_url = []

# Patch existing seed entries
for section, csv_user in csv_map.items():
    if not csv_user:
        skipped_no_user += 1
        continue
    entry = seed_index.get(section)
    if entry is not None:
        current = entry.get("assigned_users") or ""
        if current == csv_user:
            correct += 1
        else:
            entry["assigned_users"] = csv_user
            patched += 1
    else:
        # Section not in seed — try to find URL in streams
        stream = streams_index.get(section)
        if stream:
            new_entry = {
                "section":        section,
                "url":            stream["url"],
                "label":          stream.get("label", section),
                "assigned_users": csv_user,
            }
            added_new.append(new_entry)
        else:
            no_url.append((section, csv_user))

# Write patched v2 in-place
with open(SEED_FILE, "w", encoding="utf-8") as f:
    json.dump(seed, f, ensure_ascii=False, indent=2)

# Build and write v3 = patched v2 + new sections (sorted by section)
v3 = seed + added_new
v3.sort(key=lambda s: s["section"])
with open(V3_FILE, "w", encoding="utf-8") as f:
    json.dump(v3, f, ensure_ascii=False, indent=2)

print(f"Patched assigned_users: {patched}")
print(f"Already correct:        {correct}")
print(f"Skipped (no user):      {skipped_no_user}")
print(f"New sections added:     {len(added_new)}")
if no_url:
    print(f"No URL found ({len(no_url)}) — not added:")
    for section, user in sorted(no_url):
        print(f"  {section}  ->  {user}")
print(f"\nUpdated {SEED_FILE}")
print(f"Written  {V3_FILE} ({len(v3)} total sections)")
