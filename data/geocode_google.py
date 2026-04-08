#!/usr/bin/env python3
"""
geocode_google.py

Geocodes locations with NULL lat/lng using Google Maps Geocoding API.
Caches all Google responses to avoid re-querying on subsequent runs.

Usage:
    GOOGLE_MAPS_API_KEY=xxx python3 geocode_google.py
    python3 geocode_google.py --dry-run
    python3 geocode_google.py --limit 10
"""

import argparse
import json
import math
import os
import re
import sqlite3
import sys
import urllib.parse
import urllib.request
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))
CACHE_PATH = Path(__file__).parent / "geocode_cache.json"
GADM_PATH = Path(__file__).parent / "gadm41_BGR_2.json"

API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

SOFIA_CENTER = (42.6977028, 23.3217359)
REJECT_RADIUS_KM = 0.3

TRANSLIT_MAP = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
    'ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht','ъ':'a','ь':'','ю':'yu','я':'ya'
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def _translit(s: str) -> str:
    """Transliterate Bulgarian Cyrillic to Latin. Preserves existing Latin chars."""
    result = []
    for c in s:
        low = c.lower()
        if low in TRANSLIT_MAP:
            mapped = TRANSLIT_MAP[low]
            result.append(mapped.upper() if c.isupper() and mapped else mapped)
        else:
            result.append(c)
    return ''.join(result)


# ── Cache ────────────────────────────────────────────────────────────────────

_cache: dict[str, dict | None] = {}


def load_cache() -> None:
    """Load Google geocode cache from disk."""
    global _cache
    if CACHE_PATH.exists():
        with open(CACHE_PATH) as f:
            _cache = json.load(f)


def save_cache() -> None:
    with open(CACHE_PATH, 'w') as f:
        json.dump(_cache, f, ensure_ascii=False, indent=2)


def cache_lookup(query: str) -> tuple[float, float] | None | str:
    """Check cache. Returns (lat,lng), None (cached miss), or 'uncached'."""
    if query in _cache:
        entry = _cache[query]
        if entry is None:
            return None
        return (entry["lat"], entry["lng"])
    return "uncached"


def cache_store(query: str, lat: float | None, lng: float | None,
                formatted: str | None = None, location_type: str | None = None) -> None:
    if lat is not None:
        _cache[query] = {"lat": lat, "lng": lng, "formatted": formatted, "type": location_type}
    else:
        _cache[query] = None


# ── Google API ───────────────────────────────────────────────────────────────

def geocode_google(query: str) -> tuple[float, float, str, str] | None:
    """Call Google Maps Geocoding API. Returns (lat, lng, formatted_address, location_type) or None."""
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
        if data["status"] != "ZERO_RESULTS":
            print(f"    Google status={data['status']}: {data.get('error_message', '')}", file=sys.stderr)
        return None

    result = data["results"][0]
    loc = result["geometry"]["location"]
    lat, lng = loc["lat"], loc["lng"]
    formatted = result.get("formatted_address", "")
    location_type = result["geometry"].get("location_type", "")

    # Reject approximate results at Sofia center (city-level fallback)
    if haversine_km(lat, lng, *SOFIA_CENTER) < REJECT_RADIUS_KM:
        if location_type in ("APPROXIMATE", "GEOMETRIC_CENTER"):
            print(f"    Rejected Sofia center fallback: {query[:50]}", file=sys.stderr)
            return None

    return (lat, lng, formatted, location_type)


def geocode(queries: list[str]) -> tuple[float, float] | None:
    """Try each query against cache first, then Google API.
    Caches every result (hit or miss)."""
    # Check cache for all queries first
    for query in queries:
        cached = cache_lookup(query)
        if cached == "uncached":
            continue
        if cached is not None:
            return cached  # (lat, lng)

    # Cache miss — call Google
    if not API_KEY:
        return None

    for query in queries:
        if cache_lookup(query) != "uncached":
            continue  # already cached as None (failed)

        result = geocode_google(query)
        if result:
            lat, lng, formatted, loc_type = result
            cache_store(query, lat, lng, formatted, loc_type)
            return (lat, lng)
        else:
            cache_store(query, None, None)

    return None


# ── Query builders ───────────────────────────────────────────────────────────

def extract_street_query(address: str) -> str | None:
    """Extract street + number from CIK address for geocoding."""
    addr = address.upper()
    m = re.search(r'(?:УЛ\.|БУЛ\.|ПЛ\.)\s*["""]?\s*([^,"""\n]+)', addr)
    if m:
        street = m.group(0).strip().rstrip(',.')
        street = re.sub(r'["""\u201c\u201d\u201e]', '', street)
        street = re.sub(r'№\s*', '', street)
        street = re.sub(r'\s+', ' ', street).strip()
        return street
    return None


def clean_address(address: str, settlement: str | None, municipality: str | None = None) -> list[str]:
    """Build geocoding queries for domestic locations."""
    queries = []
    addr = address.strip()

    town = "София"
    is_village = False
    if settlement:
        is_village = settlement.lower().startswith('с.')
        town_clean = re.sub(r'^(гр\.?\s*|с\.?\s*)', '', settlement, flags=re.IGNORECASE).strip()
        if town_clean:
            town = town_clean

    muni = municipality if municipality and municipality != town else None

    clean = re.sub(r'^ГР\.?\s*СОФИЯ\s*,?\s*', '', addr, flags=re.IGNORECASE)
    clean = re.sub(r'^гр\.?\s*София\s*,?\s*', '', clean, flags=re.IGNORECASE)
    clean = re.sub(r'\s+', ' ', clean).strip()

    street = extract_street_query(addr)

    if is_village:
        # Villages first: settlement + municipality (Google ignores village names
        # in street queries and matches generic streets like "ул. Първа" to cities)
        if muni:
            queries.append(f"{town}, община {muni}, България")
        queries.append(f"{town}, България")
        # Then try full address with village context
        if clean and len(clean) > 5 and muni:
            queries.append(f"{clean}, {town}, {muni}, България")
    else:
        # Cities: street-first is reliable
        if street and muni:
            queries.append(f"{street}, {town}, {muni}, България")
        elif street:
            queries.append(f"{street}, {town}, България")

        if clean and len(clean) > 5:
            if muni:
                queries.append(f"{clean}, {town}, {muni}, България")
            queries.append(f"{clean}, {town}, България")

        kv_match = re.search(r'кв\.?\s*([^,]+)', addr, re.IGNORECASE)
        if kv_match and street:
            kv = kv_match.group(1).strip().rstrip(',.')
            queries.append(f"{street} кв. {kv}, {town}, България")

    return queries


def clean_address_abroad(address: str, settlement: str | None) -> list[str]:
    """Build geocoding queries for abroad locations. Transliterates Cyrillic."""
    queries = []
    country_lat = None
    city_lat = None
    if settlement:
        parts = [p.strip() for p in settlement.split(',', 1)]
        if len(parts) == 2:
            country_lat = _translit(parts[0])
            city_lat = _translit(parts[1].strip())
        else:
            city_lat = _translit(parts[0])

    if address and country_lat:
        queries.append(f"{_translit(address)}, {country_lat}")

    if city_lat and country_lat:
        queries.append(f"{city_lat}, {country_lat}")

    if city_lat:
        queries.append(city_lat)

    return queries


# ── Municipality validation ──────────────────────────────────────────────────

def _load_municipality_bboxes() -> dict[str, tuple[float, float, float, float]]:
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

    MARGIN = 0.05
    bad_ids = []
    for loc_id, lat, lng, muni in rows:
        key = _translit(muni).lower()
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


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    load_cache()
    print(f"Cache: {len(_cache):,} entries loaded from {CACHE_PATH.name}")

    conn = sqlite3.connect(DB_PATH)

    missing = conn.execute("""
        SELECT l.id, l.address, l.settlement_name,
               CASE WHEN r.oik_prefix = '32' THEN 1 ELSE 0 END AS is_abroad,
               m.name as municipality
        FROM locations l
        LEFT JOIN riks r ON r.id = l.rik_id
        LEFT JOIN municipalities m ON m.id = l.municipality_id
        WHERE l.lat IS NULL
          AND l.address IS NOT NULL AND l.address != ''
          AND COALESCE(l.location_type, 'regular') NOT IN ('mobile', 'ship')
        ORDER BY l.id
    """).fetchall()

    print(f"Locations to geocode: {len(missing)}")
    if API_KEY:
        print("Google Maps API: enabled")
    else:
        print("Google Maps API: NOT SET — will only use cache")

    if args.limit:
        missing = missing[:args.limit]
        print(f"Limited to: {len(missing)}")

    if args.dry_run:
        for loc_id, addr, settlement, is_abroad, municipality in missing[:30]:
            if is_abroad:
                queries = clean_address_abroad(addr, settlement)
            else:
                queries = clean_address(addr, settlement, municipality)
            # Check if any query is cached
            cached = any(cache_lookup(q) != "uncached" for q in queries)
            tag = "ABR" if is_abroad else "DOM"
            flag = " [CACHED]" if cached else ""
            print(f"  [{tag}] [{loc_id}] {queries[0] if queries else 'NO QUERY'}{flag}")
        return

    geocoded = 0
    failed = 0
    from_cache = 0
    api_calls = 0
    save_every = 25

    for i, (loc_id, addr, settlement, is_abroad, municipality) in enumerate(missing, 1):
        if is_abroad:
            queries = clean_address_abroad(addr, settlement)
        else:
            queries = clean_address(addr, settlement, municipality)

        if not queries:
            failed += 1
            continue

        # Check cache first
        was_cached = any(cache_lookup(q) != "uncached" for q in queries)

        result = geocode(queries)

        if result:
            lat, lng = result
            conn.execute("UPDATE locations SET lat=?, lng=?, geocode_source=? WHERE id=?",
                         (lat, lng, "google", loc_id))
            geocoded += 1
            if was_cached:
                from_cache += 1
            else:
                api_calls += 1
        else:
            failed += 1
            if not was_cached:
                api_calls += 1

        if i % save_every == 0:
            conn.commit()
            save_cache()
            print(f"  [{i:>5}/{len(missing)}] geocoded={geocoded} failed={failed} "
                  f"cache_hits={from_cache} api_calls={api_calls}", flush=True)

    conn.commit()
    save_cache()

    total = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    with_gps = conn.execute("SELECT COUNT(*) FROM locations WHERE lat IS NOT NULL").fetchone()[0]
    print(f"\nDone. geocoded={geocoded:,} failed={failed:,} "
          f"cache_hits={from_cache:,} api_calls={api_calls:,}")
    print(f"Cache: {len(_cache):,} entries saved")
    print(f"GPS coverage: {with_gps:,}/{total:,} ({100*with_gps/total:.0f}%)")

    nulled = validate_municipality_bounds(conn)

    conn.close()


if __name__ == "__main__":
    main()
