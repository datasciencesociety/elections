#!/usr/bin/env python3
"""
Compare section→user assignments between a CSV (stoil's source) and a seed JSON file.

Usage:
  python3 compare_assignments.py <csv_file> <seed_json>

  csv_file:  CSV with columns 'section' and 'Assigned Users'
  seed_json: coordinator seed JSON, array of {section, assigned_users, ...}

Output:
  - Sections in CSV but missing from seed
  - Sections in seed but missing from CSV
  - Sections where assigned_users differ
"""

import csv
import json
import sys

if len(sys.argv) < 3:
    print("Usage: python3 compare_assignments.py <csv_file> <seed_json>")
    sys.exit(1)

CSV_FILE  = sys.argv[1]
SEED_FILE = sys.argv[2]

# Load CSV: section -> user (single user per row in stoil's file)
csv_map = {}
with open(CSV_FILE, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        section = row["section"].strip()
        user    = row["Assigned Users"].strip()
        # CSV may have multiple users comma-separated — normalise to a sorted frozenset
        csv_map[section] = frozenset(u.strip() for u in user.split(",") if u.strip())

# Load seed JSON: section -> assigned_users (comma-separated string or None)
with open(SEED_FILE, encoding="utf-8") as f:
    seed = json.load(f)

seed_map = {}
for entry in seed:
    section = entry["section"].strip()
    raw     = entry.get("assigned_users") or ""
    seed_map[section] = frozenset(u.strip() for u in raw.split(",") if u.strip())

csv_sections  = set(csv_map)
seed_sections = set(seed_map)

only_in_csv  = csv_sections  - seed_sections
only_in_seed = seed_sections - csv_sections
in_both      = csv_sections  & seed_sections

mismatched = {
    s for s in in_both
    if csv_map[s] != seed_map[s]
}
matched = in_both - mismatched

print(f"CSV sections:        {len(csv_sections)}")
print(f"Seed sections:       {len(seed_sections)}")
print(f"In both:             {len(in_both)}")
print(f"  Matched:           {len(matched)}")
print(f"  Mismatched:        {len(mismatched)}")
print(f"Only in CSV:         {len(only_in_csv)}")
print(f"Only in seed:        {len(only_in_seed)}")
print()

if mismatched:
    print("=== MISMATCHED ASSIGNMENTS ===")
    print(f"{'section':<15}  {'csv':<30}  {'seed'}")
    print("-" * 80)
    for s in sorted(mismatched):
        csv_val  = ",".join(sorted(csv_map[s]))  or "(none)"
        seed_val = ",".join(sorted(seed_map[s])) or "(none)"
        print(f"{s:<15}  {csv_val:<30}  {seed_val}")
    print()

if only_in_csv:
    print("=== IN CSV BUT NOT IN SEED ===")
    for s in sorted(only_in_csv):
        print(f"  {s}  ->  {','.join(sorted(csv_map[s]))}")
    print()

if only_in_seed:
    print("=== IN SEED BUT NOT IN CSV ===")
    for s in sorted(only_in_seed):
        val = ",".join(sorted(seed_map[s])) or "(no user)"
        print(f"  {s}  ->  {val}")
    print()

if not mismatched and not only_in_csv and not only_in_seed:
    print("All assignments match perfectly.")
