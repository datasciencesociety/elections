#!/usr/bin/env python3
"""
geocode_google.py

Geocodes locations with NULL lat/lng using:
  1. Google Maps Geocoding API (if GOOGLE_MAPS_API_KEY is set)
  2. Photon (Komoot) — free, no key needed, OSM-based with better search

Usage:
    python3 geocode_google.py                    # geocode all missing domestic
    python3 geocode_google.py --dry-run          # show what would be geocoded
    python3 geocode_google.py --limit 10         # geocode first 10 only
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

API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PHOTON_URL = "https://photon.komoot.io/api/"

# Sofia center bias for Photon
SOFIA_LAT, SOFIA_LNG = 42.69, 23.32

# Reject results that are clearly wrong settlement-level fallbacks
SOFIA_CENTER = (42.6977028, 23.3217359)
REJECT_RADIUS_KM = 0.3

RATE_LIMIT_S = 1.5  # Photon rate limit


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def extract_street_query(address: str) -> str | None:
    """Extract street + number from CIK address for geocoding."""
    addr = address.upper()
    m = re.search(r'(?:УЛ\.?|БУЛ\.?|ПЛ\.?)\s*["""]?\s*([^,"""\n]+)', addr)
    if m:
        street = m.group(0).strip().rstrip(',.')
        street = re.sub(r'["""\u201c\u201d\u201e]', '', street)
        street = re.sub(r'№\s*', '', street)
        street = re.sub(r'\s+', ' ', street).strip()
        return street
    return None


def clean_address(address: str, settlement: str | None) -> list[str]:
    """Build geocoding queries from CIK address, most to least specific."""
    queries = []
    addr = address.strip()

    town = "София"
    if settlement:
        town_clean = re.sub(r'^(гр\.?\s*|с\.?\s*)', '', settlement, flags=re.IGNORECASE).strip()
        if town_clean:
            town = town_clean

    # Strip leading "ГР. СОФИЯ," etc
    clean = re.sub(r'^ГР\.?\s*СОФИЯ\s*,?\s*', '', addr, flags=re.IGNORECASE)
    clean = re.sub(r'^гр\.?\s*София\s*,?\s*', '', clean, flags=re.IGNORECASE)
    clean = re.sub(r'\s+', ' ', clean).strip()

    # Query 1: street + number (most precise)
    street = extract_street_query(addr)
    if street:
        queries.append(f"{street}, {town}, България")

    # Query 2: full cleaned address
    if clean and len(clean) > 5:
        queries.append(f"{clean}, {town}, България")

    # Query 3: try extracting a neighbourhood (кв.) + street
    kv_match = re.search(r'кв\.?\s*([^,]+)', addr, re.IGNORECASE)
    if kv_match and street:
        kv = kv_match.group(1).strip().rstrip(',.')
        queries.append(f"{street} кв. {kv}, {town}, България")

    return queries


def clean_address_abroad(address: str, settlement: str | None) -> list[str]:
    """Build geocoding queries for abroad (RIK 32) locations.
    Uses settlement_name (country + city) for context, combined with the address."""
    queries = []
    # settlement_name is like "Обединено кралство, Кроули" or "Австрия, Виена"
    if settlement:
        # Try: address + settlement (most specific)
        if address and len(address.strip()) > 2:
            queries.append(f"{address.strip()}, {settlement}")
        # Try: just settlement_name (country + city)
        queries.append(settlement)
    elif address:
        queries.append(address.strip())
    return queries


def geocode_photon(query: str) -> tuple[float, float] | None:
    """Geocode using Photon (Komoot). Free, no key needed."""
    params = {"q": query, "limit": "1", "lat": str(SOFIA_LAT), "lon": str(SOFIA_LNG)}
    url = f"{PHOTON_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"    Photon error: {e}", file=sys.stderr)
        return None

    features = data.get("features", [])
    if not features:
        return None

    coords = features[0]["geometry"]["coordinates"]
    lat, lng = coords[1], coords[0]

    # Reject exact Sofia center (settlement-level fallback)
    if haversine_km(lat, lng, *SOFIA_CENTER) < REJECT_RADIUS_KM:
        props = features[0].get("properties", {})
        osm_type = props.get("osm_type", "")
        # Only reject if it's a city/town-level result, not a specific building
        if osm_type in ("relation", "way") and not props.get("street"):
            print(f"    Rejected city-level: {query}")
            return None

    return (lat, lng)


def geocode_google(query: str) -> tuple[float, float] | None:
    """Geocode using Google Maps API. Requires GOOGLE_MAPS_API_KEY."""
    if not API_KEY:
        return None

    params = {"address": query, "key": API_KEY, "language": "bg", "region": "bg"}
    url = f"{GEOCODE_URL}?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"    Google error: {e}", file=sys.stderr)
        return None

    if data["status"] != "OK" or not data.get("results"):
        return None

    result = data["results"][0]
    loc = result["geometry"]["location"]
    lat, lng = loc["lat"], loc["lng"]

    if haversine_km(lat, lng, *SOFIA_CENTER) < REJECT_RADIUS_KM:
        location_type = result["geometry"].get("location_type", "")
        if location_type in ("APPROXIMATE", "GEOMETRIC_CENTER"):
            return None

    return (lat, lng)


def geocode(queries: list[str]) -> tuple[float, float, str] | None:
    """Try Google first (accurate), fall back to Photon (free).
    Returns (lat, lng, source) or None."""
    if API_KEY:
        for query in queries:
            result = geocode_google(query)
            if result:
                return (*result, "google")

    # Photon fallback
    for query in queries:
        result = geocode_photon(query)
        if result:
            return (*result, "photon")
        time.sleep(RATE_LIMIT_S)

    return None


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


GADM_PATH = Path(__file__).parent / "gadm41_BGR_2.json"

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


def validate_municipality_bounds(conn: sqlite3.Connection) -> int:
    """Null coordinates that fall outside their municipality bounding box.
    Returns the number of locations nulled."""
    bboxes = _load_municipality_bboxes()
    if not bboxes:
        print("Warning: no GADM data found, skipping municipality validation")
        return 0

    rows = conn.execute("""
        SELECT DISTINCT l.id, l.lat, l.lng, m.name
        FROM locations l
        JOIN municipalities m ON l.municipality_id = m.id
        LEFT JOIN riks r ON r.id = l.rik_id
        WHERE l.lat IS NOT NULL
          AND (r.oik_prefix IS NULL OR r.oik_prefix != '32')
    """).fetchall()

    MARGIN = 0.05  # ~5km tolerance
    bad_ids = []
    for loc_id, lat, lng, muni in rows:
        key = _translit(muni)
        bbox = None
        for bk, bv in bboxes.items():
            if bk == key or bk in key or key in bk:
                bbox = bv
                break
        if not bbox:
            continue
        min_lat, max_lat, min_lng, max_lng = bbox
        if (lat < min_lat - MARGIN or lat > max_lat + MARGIN or
                lng < min_lng - MARGIN or lng > max_lng + MARGIN):
            bad_ids.append(loc_id)

    if bad_ids:
        placeholders = ','.join(['?'] * len(bad_ids))
        conn.execute(f"UPDATE locations SET lat = NULL, lng = NULL WHERE id IN ({placeholders})", bad_ids)
        conn.commit()
        print(f"Validation: nulled {len(bad_ids)} locations outside their municipality bounds")
    else:
        print("Validation: all coordinates within municipality bounds")
    return len(bad_ids)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)

    # Get locations with NULL coords — domestic and abroad
    missing = conn.execute("""
        SELECT l.id, l.address, l.settlement_name,
               CASE WHEN r.oik_prefix = '32' THEN 1 ELSE 0 END AS is_abroad
        FROM locations l
        LEFT JOIN riks r ON r.id = l.rik_id
        WHERE l.lat IS NULL
          AND l.address IS NOT NULL AND l.address != ''
        ORDER BY l.id
    """).fetchall()

    print(f"Locations to geocode: {len(missing)}")
    if API_KEY:
        print("Google Maps API: enabled (primary)")
    else:
        print("Google Maps API: not set (Photon only)")

    if args.limit:
        missing = missing[:args.limit]
        print(f"Limited to: {len(missing)}")

    print(f"Estimated time: ~{len(missing) * RATE_LIMIT_S / 60:.0f} minutes")

    if args.dry_run:
        for loc_id, addr, settlement, is_abroad in missing[:30]:
            if is_abroad:
                queries = clean_address_abroad(addr, settlement)
            else:
                queries = clean_address(addr, settlement)
            print(f"  [{'ABR' if is_abroad else 'DOM'}] [{loc_id}] {queries[0] if queries else 'NO QUERY'}")
        return

    # Load existing voting_locations.json
    if VL_PATH.exists():
        with open(VL_PATH) as f:
            vl_data = json.load(f)
    else:
        vl_data = []

    existing = {strip_norm(v['name']): v for v in vl_data if v.get('name')}
    next_id = max((v.get('id', 0) for v in vl_data), default=0) + 1

    geocoded = 0
    failed = 0
    save_every = 25

    for i, (loc_id, addr, settlement, is_abroad) in enumerate(missing, 1):
        if is_abroad:
            queries = clean_address_abroad(addr, settlement)
        else:
            queries = clean_address(addr, settlement)
        result = geocode(queries)

        if result:
            lat, lng, source = result
            conn.execute("UPDATE locations SET lat=?, lng=?, geocode_source=? WHERE id=?", (lat, lng, source, loc_id))

            n = strip_norm(addr)
            if n not in existing:
                entry = {
                    "id": next_id,
                    "locationId": loc_id,
                    "name": addr,
                    "address": queries[0] if queries else addr,
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
            print(f"    FAILED [{loc_id}]: {addr[:60]}", file=sys.stderr)

        if i % save_every == 0:
            conn.commit()
            with open(VL_PATH, 'w') as f:
                json.dump(vl_data, f, ensure_ascii=False, indent=2)
            print(f"  [{i:>5}/{len(missing)}] geocoded={geocoded} failed={failed}", flush=True)

    # Final save
    conn.commit()
    with open(VL_PATH, 'w') as f:
        json.dump(vl_data, f, ensure_ascii=False, indent=2)

    total = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    with_gps = conn.execute("SELECT COUNT(*) FROM locations WHERE lat IS NOT NULL").fetchone()[0]
    print(f"\nDone. geocoded={geocoded:,} failed={failed:,}")
    print(f"GPS coverage: {with_gps:,}/{total:,} ({100*with_gps/total:.0f}%)")

    # Validate: null coords that fall outside their municipality bounding box
    nulled = validate_municipality_bounds(conn)
    if nulled:
        # Remove nulled entries from JSON cache
        valid_ids = {r[0] for r in conn.execute("SELECT id FROM locations WHERE lat IS NOT NULL")}
        vl_data = [e for e in vl_data if e.get("locationId") in valid_ids]
        with open(VL_PATH, 'w') as f:
            json.dump(vl_data, f, ensure_ascii=False, indent=2)

    conn.close()


if __name__ == "__main__":
    main()
