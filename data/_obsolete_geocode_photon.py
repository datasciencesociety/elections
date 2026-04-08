#!/usr/bin/env python3
"""
geocode_photon.py

Geocodes locations with NULL lat/lng using Photon (Komoot) — free, no API key.
Tries street-level first, falls back to settlement name.

Usage:
    python3 geocode_photon.py              # geocode all missing
    python3 geocode_photon.py --dry-run    # show queries
    python3 geocode_photon.py --limit 50   # first 50 only
"""

import argparse
import json
import math
import os
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))
VL_PATH = Path(__file__).parent.parent.parent / "map-dashboard" / "public" / "voting_locations.json"

PHOTON_URL = "https://photon.komoot.io/api/"
BG_CENTER_LAT, BG_CENTER_LNG = 42.5, 25.5
RATE_LIMIT_S = 1.1
SAVE_EVERY = 50

# Bulgaria bounding box — reject results outside
BG_LAT_MIN, BG_LAT_MAX = 41.2, 44.3
BG_LNG_MIN, BG_LNG_MAX = 22.3, 29.0

_cache: dict[str, tuple[float, float] | None] = {}


def photon(query: str, bias_lat: float = BG_CENTER_LAT, bias_lng: float = BG_CENTER_LNG) -> tuple[float, float] | None:
    if query in _cache:
        return _cache[query]

    params = {"q": query, "limit": "1", "lat": str(bias_lat), "lon": str(bias_lng)}
    url = f"{PHOTON_URL}?{urllib.parse.urlencode(params)}"

    result = None
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=10) as resp:
            data = json.loads(resp.read())
        features = data.get("features", [])
        if features:
            coords = features[0]["geometry"]["coordinates"]
            lat, lng = coords[1], coords[0]
            # Reject if outside Bulgaria (for domestic queries)
            if BG_LAT_MIN <= lat <= BG_LAT_MAX and BG_LNG_MIN <= lng <= BG_LNG_MAX:
                result = (lat, lng)
    except Exception as e:
        print(f"    error: {e}", file=sys.stderr)

    _cache[query] = result
    time.sleep(RATE_LIMIT_S)
    return result


def extract_street(address: str) -> str | None:
    m = re.search(r'(?:УЛ\.?|БУЛ\.?|ПЛ\.?)\s*["""]?\s*([^,"""\n]+)', address.upper())
    if m:
        street = m.group(0).strip().rstrip(',.')
        street = re.sub(r'["""\u201c\u201d\u201e]', '', street)
        street = re.sub(r'№\s*', '', street)
        street = re.sub(r'\s+', ' ', street).strip()
        return street
    return None


def build_queries(address: str, settlement: str | None, municipality: str | None) -> list[str]:
    queries = []
    town = None
    if settlement:
        town = re.sub(r'^(гр\.?\s*|с\.?\s*)', '', settlement, flags=re.IGNORECASE).strip()

    street = extract_street(address)

    # Try street + town (most specific)
    if street and town:
        queries.append(f"{street}, {town}, България")
    if street and municipality:
        queries.append(f"{street}, {municipality}, България")

    # Settlement-level fallback — OK for villages, gives village center
    if town and municipality:
        queries.append(f"{town}, {municipality}, България")
    elif town:
        queries.append(f"{town}, България")

    return queries


def strip_norm(s: str) -> str:
    s = s.upper().strip()
    s = re.sub(r'^(ГР\.?\s+|С\.?\s+|МИН\.?\s+С\.?\s+)[А-ЯA-Z\-]+[\s,]*', '', s).strip()
    s = re.sub(r'["""\'„\u201c\u201d\u201e\(\)]', '', s)
    s = re.sub(r'[\u2013\u2014\u2012\-]', ' ', s)
    s = re.sub(r'№\s*', '', s)
    s = re.sub(r'([А-ЯA-Z])(\d)', r'\1 \2', s)
    s = re.sub(r'(\d)([А-ЯA-Z])', r'\1 \2', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)

    missing = conn.execute("""
        SELECT l.id, l.address, l.settlement_name, m.name as municipality
        FROM locations l
        LEFT JOIN municipalities m ON m.id = l.municipality_id
        LEFT JOIN riks r ON r.id = l.rik_id
        WHERE l.lat IS NULL
          AND l.address IS NOT NULL AND l.address != ''
          AND (r.oik_prefix IS NULL OR r.oik_prefix != '32')
        ORDER BY l.id
    """).fetchall()

    print(f"Locations to geocode: {len(missing)}")

    if args.limit:
        missing = missing[:args.limit]
        print(f"Limited to: {len(missing)}")

    print(f"Estimated time: ~{len(missing) * RATE_LIMIT_S / 60:.0f} minutes")

    if args.dry_run:
        for loc_id, addr, settlement, municipality in missing[:30]:
            queries = build_queries(addr, settlement, municipality)
            print(f"  [{loc_id}] {queries[0] if queries else 'NO QUERY'}")
        return

    # Load voting_locations.json
    if VL_PATH.exists():
        with open(VL_PATH) as f:
            vl_data = json.load(f)
    else:
        vl_data = []

    existing = {strip_norm(v['name']): v for v in vl_data if v.get('name')}
    next_id = max((v.get('id', 0) for v in vl_data), default=0) + 1

    geocoded = 0
    failed = 0

    for i, (loc_id, addr, settlement, municipality) in enumerate(missing, 1):
        queries = build_queries(addr, settlement, municipality)
        result = None
        query_used = None

        for q in queries:
            result = photon(q)
            query_used = q
            if result:
                break

        if result:
            lat, lng = result
            conn.execute("UPDATE locations SET lat=?, lng=? WHERE id=?", (lat, lng, loc_id))

            n = strip_norm(addr)
            if n not in existing:
                entry = {
                    "id": next_id,
                    "locationId": loc_id,
                    "name": addr,
                    "address": query_used,
                    "lat": lat,
                    "lng": lng,
                    "status": "photon"
                }
                vl_data.append(entry)
                existing[n] = entry
                next_id += 1
            geocoded += 1
        else:
            failed += 1

        if i % SAVE_EVERY == 0:
            conn.commit()
            with open(VL_PATH, 'w') as f:
                json.dump(vl_data, f, ensure_ascii=False, indent=2)
            print(f"  [{i:>5}/{len(missing)}] geocoded={geocoded} failed={failed}", flush=True)

    conn.commit()
    with open(VL_PATH, 'w') as f:
        json.dump(vl_data, f, ensure_ascii=False, indent=2)

    total = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    with_gps = conn.execute("SELECT COUNT(*) FROM locations WHERE lat IS NOT NULL").fetchone()[0]
    print(f"\nDone. geocoded={geocoded:,} failed={failed:,}")
    print(f"GPS coverage: {with_gps:,}/{total:,} ({100*with_gps/total:.0f}%)")
    conn.close()


if __name__ == "__main__":
    main()
