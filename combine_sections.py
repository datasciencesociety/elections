#!/usr/bin/env python3
"""
Combine highrisk-sections.json (contacts) with sections-with-volunteers.json (assigned users).
Output: sections that have both a valid section ID and at least one assigned user.
"""

import json
import sys

HIGHRISK = sys.argv[1] if len(sys.argv) > 1 else "/home/stork/highrisk-sections.json"
VOLUNTEERS = sys.argv[2] if len(sys.argv) > 2 else "/home/stork/sections-with-volunteers.json"
OUTPUT = sys.argv[3] if len(sys.argv) > 3 else "combined-sections.json"

VALID_SECTION_RE = None  # sections starting with digits only


def is_valid_section(section_id: str) -> bool:
    return section_id.isdigit()


with open(HIGHRISK, encoding="utf-8") as f:
    highrisk = json.load(f)

with open(VOLUNTEERS, encoding="utf-8") as f:
    volunteers = json.load(f)

# Index highrisk by section ID
highrisk_map = {s["section"]: s for s in highrisk if is_valid_section(s["section"])}

# Index volunteers by section ID, skip invalid sections
volunteer_map = {
    s["section"]: s["assigned_users"]
    for s in volunteers
    if is_valid_section(s["section"]) and s.get("assigned_users", "").strip()
}

all_section_ids = set(highrisk_map) | set(volunteer_map)

combined = []
for section_id in all_section_ids:
    if section_id in highrisk_map:
        row = highrisk_map[section_id].copy()
    else:
        # section only in volunteers file
        src = next(s for s in volunteers if s["section"] == section_id)
        row = {k: v for k, v in src.items() if k != "assigned_users"}
    row["assigned_users"] = volunteer_map.get(section_id, "")
    combined.append(row)

combined.sort(key=lambda s: s["section"])

highrisk_invalid = [s["section"] for s in highrisk if not is_valid_section(s["section"])]
volunteers_invalid = [s["section"] for s in volunteers if not is_valid_section(s["section"])]
volunteers_pool_users = len({
    u.strip()
    for s in volunteers if not is_valid_section(s["section"])
    for u in s.get("assigned_users", "").split(",") if u.strip()
})
only_in_highrisk = len(set(highrisk_map) - set(volunteer_map))
only_in_volunteers = len(set(volunteer_map) - set(highrisk_map))
in_both = len(set(highrisk_map) & set(volunteer_map))

print(f"--- Source ---")
print(f"Highrisk sections:      {len(highrisk_map)} valid, {len(highrisk_invalid)} skipped (no valid ID)")
for sid in highrisk_invalid:
    print(f"  skipped: {sid}")
print(f"Volunteer sections:     {len(volunteer_map)} valid, {len(volunteers_invalid)} skipped (no valid ID, {volunteers_pool_users} pooled users dropped)")
for sid in volunteers_invalid:
    print(f"  skipped: {sid}")
print(f"  only in highrisk:     {only_in_highrisk}")
print(f"  only in volunteers:   {only_in_volunteers}")
print(f"  in both:              {in_both}")
print()

with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(combined, f, ensure_ascii=False, indent=2)

with_users = sum(1 for s in combined if s["assigned_users"])
without_users = len(combined) - with_users
total_users = len({u.strip() for s in combined for u in s["assigned_users"].split(",") if u.strip()})

print(f"--- Output: {OUTPUT} ---")
print(f"Total sections:    {len(combined)}")
print(f"  with volunteers: {with_users}")
print(f"  no volunteers:   {without_users}")
print(f"Unique volunteers: {total_users}")
