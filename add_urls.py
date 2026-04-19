#!/usr/bin/env python3
"""
Merge stream URLs from scraper output into combined-sections.json.

For each section in combined-sections that has a matching stream URL, adds
the 'url' and 'label' fields.  Sections without a URL are left unchanged.

Also writes a coordinator seed file containing only sections that have a URL
(the format expected by seed.js / POST /api/streams/upsert).

Usage:
  python3 add_urls.py <streams.json> [combined_sections] [seed_output]

  streams.json:     scraper output  (section, url, label)
  combined_sections defaults to /home/stork/combined-sections.json
  seed_output       defaults to combined-seed.json (coordinator format)
"""

import json
import sys

STREAMS  = sys.argv[1]
COMBINED = sys.argv[2] if len(sys.argv) > 2 else "/home/stork/combined-sections.json"
SEED_OUT = sys.argv[3] if len(sys.argv) > 3 else "combined-seed.json"

with open(STREAMS, encoding="utf-8") as f:
    streams = json.load(f)

with open(COMBINED, encoding="utf-8") as f:
    combined = json.load(f)

url_map = {s["section"]: {"url": s["url"], "label": s.get("label", s["section"])} for s in streams}

added = updated = 0
for section in combined:
    entry = url_map.get(section["section"])
    if entry:
        had_url = "url" in section
        section["url"]   = entry["url"]
        section["label"] = entry["label"]
        if had_url:
            updated += 1
        else:
            added += 1

print(f"URLs added: {added}, updated: {updated}, no match: {len(combined) - added - updated}")

with open(COMBINED, "w", encoding="utf-8") as f:
    json.dump(combined, f, ensure_ascii=False, indent=2)
print(f"Updated {COMBINED}")

# Coordinator seed: only sections that now have a url
seed = [
    {
        "section":        s["section"],
        "url":            s["url"],
        "label":          s.get("label", s["section"]),
        "assigned_users": s.get("assigned_users") or None,
    }
    for s in combined if s.get("url")
]

with open(SEED_OUT, "w", encoding="utf-8") as f:
    json.dump(seed, f, ensure_ascii=False, indent=2)
print(f"Seed file: {SEED_OUT} ({len(seed)} sections with URL)")
