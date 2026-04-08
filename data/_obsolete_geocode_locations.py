#!/usr/bin/env python3
"""
geocode_locations.py

Matches polling station locations from local caches (voting_locations.json
and google_maps_locations.csv). No external API calls.

For actual geocoding via Google Maps API, use geocode_google.py.

Usage:
    python3 geocode_locations.py              # match all missing from caches
    python3 geocode_locations.py --dry-run    # show what would be matched
"""

import argparse
import csv
import json
import os
import re
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))
VL_PATH = Path(__file__).parent.parent.parent / "map-dashboard" / "public" / "voting_locations.json"
GADM_PATH = Path(__file__).parent / "gadm41_BGR_2.json"
GOOGLE_CSV = Path(__file__).parent / "google_maps_locations.csv"

BBOX_MARGIN = 0.05  # ~5km tolerance for municipality bounds check

TRANSLIT_MAP = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
    'ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht','ъ':'a','ь':'','ю':'yu','я':'ya'
}


def _translit(s: str) -> str:
    return ''.join(TRANSLIT_MAP.get(c, c) for c in s.lower())


def _load_municipality_bboxes() -> dict[str, tuple[float, float, float, float]]:
    """Load municipality bounding boxes from GADM GeoJSON."""
    if not GADM_PATH.exists():
        return {}
    with open(GADM_PATH) as f:
        geo = json.load(f)

    def get_bbox(geometry):
        coords = []
        def extract(obj):
            if isinstance(obj, list) and obj and isinstance(obj[0], (int, float)):
                coords.append(obj)
            elif isinstance(obj, list):
                for sub in obj:
                    extract(sub)
        extract(geometry['coordinates'])
        if not coords:
            return None
        lngs = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        return min(lats), max(lats), min(lngs), max(lngs)

    bboxes = {}
    for feat in geo['features']:
        bbox = get_bbox(feat['geometry'])
        if bbox:
            bboxes[feat['properties']['NAME_2'].lower()] = bbox
    return bboxes


def is_in_municipality(lat: float, lng: float, municipality: str | None, bboxes: dict) -> bool:
    """Check if coordinates fall within the municipality bounding box."""
    if not municipality or not bboxes:
        return True
    key = _translit(municipality)
    for bk, bv in bboxes.items():
        if bk == key or bk in key or key in bk:
            min_lat, max_lat, min_lng, max_lng = bv
            return (min_lat - BBOX_MARGIN <= lat <= max_lat + BBOX_MARGIN and
                    min_lng - BBOX_MARGIN <= lng <= max_lng + BBOX_MARGIN)
    return True  # can't validate — allow it


_google_cache: dict[str, tuple[float, float]] = {}


def load_google_maps_cache() -> None:
    """Load Google Maps geocoded data from CSV as a lookup by normalized CIK address."""
    if not GOOGLE_CSV.exists():
        return
    with open(GOOGLE_CSV, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            try:
                lat, lng = float(row['lat']), float(row['lng'])
            except (ValueError, KeyError):
                continue
            addr = row.get('cik_address', '')
            if addr:
                _google_cache[strip_norm(addr)] = (lat, lng)


def strip_norm(s: str) -> str:
    s = s.upper().strip()
    s = re.sub(r'^(ГР\.?\s+|С\.?\s+|МИН\.?\s+С\.?\s+)[А-ЯA-Z\-]+[\s,]*', '', s).strip()
    s = re.sub(r'["""\'„\u201c\u201d\u201e\(\)]', '', s)
    s = re.sub(r'[\u2013\u2014\u2012\-]', ' ', s)
    s = re.sub(r'№\s*', '', s)
    s = re.sub(r'[,\.]', ' ', s)
    s = re.sub(r'([А-ЯA-Z])(\d)', r'\1 \2', s)
    s = re.sub(r'(\d)([А-ЯA-Z])', r'\1 \2', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)

    bboxes = _load_municipality_bboxes()
    if bboxes:
        print(f"Loaded {len(bboxes)} municipality bounding boxes for validation")

    load_google_maps_cache()
    if _google_cache:
        print(f"Loaded {len(_google_cache):,} Google Maps entries as lookup")

    # Ensure columns exist
    for col in ['lat', 'lng', 'geocode_source']:
        col_type = 'TEXT' if col == 'geocode_source' else 'REAL'
        try:
            conn.execute(f'ALTER TABLE locations ADD COLUMN {col} {col_type}')
        except Exception:
            pass
    conn.commit()

    # Load existing voting_locations.json
    if VL_PATH.exists():
        with open(VL_PATH) as f:
            vl_data = json.load(f)
    else:
        vl_data = []

    existing = {strip_norm(v['name']): v for v in vl_data if v.get('name')}
    next_id = max((v.get('id', 0) for v in vl_data), default=0) + 1

    missing = conn.execute("""
        SELECT l.id, l.address, l.ekatte, l.settlement_name,
               m.name as municipality, l.rik_id,
               (SELECT r.oik_prefix FROM riks r WHERE r.id = l.rik_id) as rik_prefix
        FROM locations l
        LEFT JOIN municipalities m ON m.id = l.municipality_id
        WHERE l.lat IS NULL
          AND l.address IS NOT NULL AND l.address != ''
        ORDER BY l.id
    """).fetchall()

    print(f"Locations missing coords: {len(missing):,}")

    # Pass 1: match from existing voting_locations.json
    to_geocode = []
    vl_matched = 0
    for loc_id, addr, ekatte, settlement, municipality, rik_id, rik_prefix in missing:
        n = strip_norm(addr)
        is_abroad = rik_prefix == '32'
        if not is_abroad and n in existing and existing[n].get('lat'):
            v = existing[n]
            if not is_in_municipality(v['lat'], v['lng'], municipality, bboxes):
                to_geocode.append((loc_id, addr, ekatte, settlement, municipality, is_abroad))
                continue
            if not args.dry_run:
                conn.execute("UPDATE locations SET lat=?, lng=? WHERE id=?",
                             (v['lat'], v['lng'], loc_id))
            vl_matched += 1
        else:
            to_geocode.append((loc_id, addr, ekatte, settlement, municipality, is_abroad))
    if not args.dry_run:
        conn.commit()
    print(f"Matched {vl_matched:,} from voting_locations.json")

    # Pass 2: match from Google Maps CSV
    still_missing = []
    csv_matched = 0
    csv_rejected = 0
    for loc_id, addr, ekatte, settlement, municipality, is_abroad in to_geocode:
        n = strip_norm(addr)
        if not is_abroad and n in _google_cache:
            lat, lng = _google_cache[n]
            if not is_in_municipality(lat, lng, municipality, bboxes):
                csv_rejected += 1
                still_missing.append((loc_id, addr, ekatte, settlement, municipality, is_abroad))
                continue
            if not args.dry_run:
                conn.execute("UPDATE locations SET lat=?, lng=?, geocode_source=? WHERE id=?",
                             (lat, lng, "google_csv", loc_id))
                if n not in existing:
                    entry = {
                        "id": next_id,
                        "locationId": loc_id,
                        "name": addr,
                        "address": addr,
                        "lat": lat,
                        "lng": lng,
                        "status": "google_maps"
                    }
                    vl_data.append(entry)
                    existing[n] = entry
                    next_id += 1
            csv_matched += 1
        else:
            still_missing.append((loc_id, addr, ekatte, settlement, municipality, is_abroad))

    if not args.dry_run:
        conn.commit()
        with open(VL_PATH, 'w') as f:
            json.dump(vl_data, f, ensure_ascii=False, indent=2)
    print(f"Matched {csv_matched:,} from Google Maps CSV (rejected {csv_rejected:,} outside municipality)")

    domestic = sum(1 for t in still_missing if not t[5])
    abroad = sum(1 for t in still_missing if t[5])
    print(f"\nStill missing: {len(still_missing):,} ({domestic:,} domestic, {abroad:,} abroad)")
    print(f"Run geocode_google.py to geocode these via Google Maps API")

    total = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    with_gps = conn.execute("SELECT COUNT(*) FROM locations WHERE lat IS NOT NULL").fetchone()[0]
    print(f"GPS coverage: {with_gps:,}/{total:,} ({100*with_gps/total:.0f}%)")

    conn.close()


if __name__ == "__main__":
    main()
