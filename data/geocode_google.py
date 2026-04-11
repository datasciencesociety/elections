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


def _in_bbox(lat: float, lng: float, bbox: tuple[float, float, float, float], margin: float = 0.05) -> bool:
    min_lat, max_lat, min_lng, max_lng = bbox
    return (min_lat - margin <= lat <= max_lat + margin
            and min_lng - margin <= lng <= max_lng + margin)


def geocode(
    queries: list[str],
    target_bbox: tuple[float, float, float, float] | None = None,
) -> tuple[float, float] | None:
    """Try each query against cache first, then Google API.
    Caches every result (hit or miss).

    If `target_bbox` is given, each candidate (cached or fresh) that falls
    outside the bbox is skipped so the next query has a chance. This keeps
    a ROOFTOP hit in the wrong town from winning over a town-centroid
    fallback in the right town.
    """
    def _accept(lat: float, lng: float) -> bool:
        return target_bbox is None or _in_bbox(lat, lng, target_bbox)

    # Check cache for all queries first; accept the first in-bbox cached hit.
    for query in queries:
        cached = cache_lookup(query)
        if cached == "uncached" or cached is None:
            continue
        lat, lng = cached
        if _accept(lat, lng):
            return cached

    # Cache miss — call Google
    if not API_KEY:
        return None

    for query in queries:
        if cache_lookup(query) != "uncached":
            continue  # already cached (hit or miss); handled above or below

        result = geocode_google(query)
        if result:
            lat, lng, formatted, loc_type = result
            cache_store(query, lat, lng, formatted, loc_type)
            if _accept(lat, lng):
                return (lat, lng)
            # Out-of-bbox result cached but skipped — next query might land in.
        else:
            cache_store(query, None, None)

    return None


# ── Query builders ───────────────────────────────────────────────────────────

# Bulgarian ordinal words → digit form that Google indexes.
# Masculine -ти / feminine -та / neuter -то / masculine-soft -ри / feminine-soft -ра
# and a few irregulars (Втори/Втора, Седми/Седма, Осми/Осма).
_ORDINAL_MAP = {
    'ПЪРВИ': '1-ВИ', 'ПЪРВА': '1-ВА', 'ПЪРВО': '1-ВО',
    'ВТОРИ': '2-РИ', 'ВТОРА': '2-РА', 'ВТОРО': '2-РО',
    'ТРЕТИ': '3-ТИ', 'ТРЕТА': '3-ТА', 'ТРЕТО': '3-ТО',
    'ЧЕТВЪРТИ': '4-ТИ', 'ЧЕТВЪРТА': '4-ТА', 'ЧЕТВЪРТО': '4-ТО',
    'ПЕТИ': '5-ТИ', 'ПЕТА': '5-ТА', 'ПЕТО': '5-ТО',
    'ШЕСТИ': '6-ТИ', 'ШЕСТА': '6-ТА', 'ШЕСТО': '6-ТО',
    'СЕДМИ': '7-МИ', 'СЕДМА': '7-МА', 'СЕДМО': '7-МО',
    'ОСМИ': '8-МИ', 'ОСМА': '8-МА', 'ОСМО': '8-МО',
    'ДЕВЕТИ': '9-ТИ', 'ДЕВЕТА': '9-ТА', 'ДЕВЕТО': '9-ТО',
    'ДЕСЕТИ': '10-ТИ', 'ДЕСЕТА': '10-ТА', 'ДЕСЕТО': '10-ТО',
    'ЕДИНАДЕСЕТИ': '11-ТИ', 'ЕДИНАДЕСЕТА': '11-ТА',
    'ДВАНАДЕСЕТИ': '12-ТИ', 'ДВАНАДЕСЕТА': '12-ТА',
    'ТРИНАДЕСЕТИ': '13-ТИ', 'ТРИНАДЕСЕТА': '13-ТА',
    'ЧЕТИРИНАДЕСЕТИ': '14-ТИ', 'ЧЕТИРИНАДЕСЕТА': '14-ТА',
    'ПЕТНАДЕСЕТИ': '15-ТИ', 'ПЕТНАДЕСЕТА': '15-ТА',
    'ШЕСТНАДЕСЕТИ': '16-ТИ', 'ШЕСТНАДЕСЕТА': '16-ТА',
    'СЕДЕМНАДЕСЕТИ': '17-ТИ', 'СЕДЕМНАДЕСЕТА': '17-ТА',
    'ОСЕМНАДЕСЕТИ': '18-ТИ', 'ОСЕМНАДЕСЕТА': '18-ТА',
    'ДЕВЕТНАДЕСЕТИ': '19-ТИ', 'ДЕВЕТНАДЕСЕТА': '19-ТА',
    'ДВАДЕСЕТИ': '20-ТИ', 'ДВАДЕСЕТА': '20-ТА',
}
_ORDINAL_RE = re.compile(r'\b(' + '|'.join(_ORDINAL_MAP) + r')\b')

# Compound ordinals "двадесет и първа" → "21-ва" (rare but present).
_COMPOUND_ORDINALS = {
    'ДВАДЕСЕТ И ПЪРВИ': '21-ВИ', 'ДВАДЕСЕТ И ПЪРВА': '21-ВА',
    'ДВАДЕСЕТ И ВТОРИ': '22-РИ', 'ДВАДЕСЕТ И ВТОРА': '22-РА',
    'ДВАДЕСЕТ И ТРЕТИ': '23-ТИ', 'ДВАДЕСЕТ И ТРЕТА': '23-ТА',
    'ДВАДЕСЕТ И ЧЕТВЪРТИ': '24-ТИ', 'ДВАДЕСЕТ И ЧЕТВЪРТА': '24-ТА',
    'ДВАДЕСЕТ И ПЕТИ': '25-ТИ', 'ДВАДЕСЕТ И ПЕТА': '25-ТА',
}
_COMPOUND_RE = re.compile(r'\b(' + '|'.join(_COMPOUND_ORDINALS) + r')\b')


def _normalize_ordinals(s: str) -> str:
    """Convert spelled-out ordinals to the digit form Google indexes.
    `ШЕСТИ СЕПТЕМВРИ` → `6-ТИ СЕПТЕМВРИ`, `ТРЕТИ МАРТ` → `3-ТИ МАРТ`."""
    s = _COMPOUND_RE.sub(lambda m: _COMPOUND_ORDINALS[m.group(1)], s)
    return _ORDINAL_RE.sub(lambda m: _ORDINAL_MAP[m.group(1)], s)


def extract_street_query(address: str) -> str | None:
    """Extract street + house number from CIK address for geocoding.

    Rules:
      - Recognise УЛ./БУЛ./ПЛ. followed by the name.
      - A `№` must be followed by digits (1+), optionally with a space and an
        optional trailing letter (e.g. №15, № 151, №21А). `№` on its own is
        noise and is dropped.
      - CIK often writes `бул. „Захари Стоянов", №15` — the comma between the
        closing quote and the number splits the street from its number. We
        collapse a comma-before-№ into a plain space so they stay contiguous.
      - Spelled-out ordinals in the street name are converted to digit form
        (`ТРЕТИ МАРТ` → `3-ТИ МАРТ`) — Google returns ROOFTOP for the digit
        form and only street-centroid for the spelled form.
    """
    # Upper-case + strip every typographic quote variant we've seen.
    addr = address.upper()
    addr = re.sub(r'["\u201c\u201d\u201e\u00ab\u00bb\u2018\u2019\u201a]', '', addr)
    # Glue street to its number when CIK separates them with a comma.
    addr = re.sub(r'\s*,\s*№', ' №', addr)

    m = re.search(r'(УЛ\.|БУЛ\.|ПЛ\.)\s*([^,\n]+)', addr)
    if not m:
        return None
    street_type = m.group(1)
    rest = _normalize_ordinals(m.group(2).strip().rstrip(',.'))

    # Require digits after №. A bare № with nothing after it is noise.
    num_match = re.search(r'№\s*(\d+[А-Я]?)', rest)
    if num_match:
        street_name = rest[:num_match.start()].strip().rstrip(',.')
        number = num_match.group(1)
        if street_name:
            return f"{street_type} {street_name} №{number}"
        return None

    # No number — drop any stray bare № and return just the street name.
    rest = re.sub(r'\s*№\s*$', '', rest).strip()
    if not rest:
        return None
    return f"{street_type} {rest}"


def clean_address(
    address: str,
    settlement: str | None,
    municipality: str | None = None,
    district: str | None = None,
) -> list[str]:
    """Build geocoding queries for domestic locations.

    Every query always carries the full hierarchy town → muni → district →
    country. Village names duplicate across oblasts (Бяла is a municipality
    in Бургас, Русе and Варна; Ситово in Силистра and Пловдив; Черковна in
    multiple oblasts), so district is the only reliable disambiguator.
    """
    queries: list[str] = []
    addr = address.strip()

    town = "София"
    is_village = False
    if settlement:
        is_village = settlement.lower().startswith('с.')
        town_clean = re.sub(r'^(гр\.?\s*|с\.?\s*)', '', settlement, flags=re.IGNORECASE).strip()
        if town_clean:
            town = town_clean

    # Full-hierarchy suffix appended to every query. Leave out components that
    # duplicate the town (a Бургас-oblast section in a town called "Бургас" is
    # fine with just "Бургас, България").
    parts = [town]
    if municipality and municipality != town:
        parts.append(f"община {municipality}")
    if district and district != town and district != municipality:
        parts.append(f"{district} област")
    parts.append("България")
    suffix = ", ".join(parts)

    clean = re.sub(r'^ГР\.?\s*СОФИЯ\s*,?\s*', '', addr, flags=re.IGNORECASE)
    clean = re.sub(r'^гр\.?\s*София\s*,?\s*', '', clean, flags=re.IGNORECASE)
    clean = re.sub(r'\s+', ' ', clean).strip()

    street = extract_street_query(addr)

    if is_village:
        # Villages first: Google has almost no street-level data, so the town
        # centroid with full hierarchy is the most reliable answer.
        queries.append(suffix)
        if clean and len(clean) > 5:
            queries.append(f"{clean}, {suffix}")
    else:
        if street:
            queries.append(f"{street}, {suffix}")

        if clean and len(clean) > 5:
            queries.append(f"{clean}, {suffix}")

        kv_match = re.search(r'кв\.?\s*([^,]+)', addr, re.IGNORECASE)
        if kv_match and street:
            kv = kv_match.group(1).strip().rstrip(',.')
            queries.append(f"{street} кв. {kv}, {suffix}")

        # Final fallback: town centroid with full hierarchy. Used when Google
        # has no street data for the specific town and would otherwise return
        # a ROOFTOP match from a similarly-named street elsewhere.
        queries.append(suffix)

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

def _normalize_muni_name(name: str) -> str:
    """Canonical form for municipality name comparison.

    GADM uses `aitos`, `starazagora`, `veliko tarnovo` → `velikotarnovo`; our
    transliterator produces `aytos`, `stara zagora`, `veliko tarnovo`. To
    compare them we lowercase, drop spaces/hyphens, and map й→i.
    """
    s = _translit(name).lower()
    s = s.replace('y', 'i')  # aytos → aitos, veliki → veliki (unchanged)
    s = re.sub(r'[\s\-\']+', '', s)
    return s


def _load_municipality_bboxes() -> dict[tuple[str | None, str], tuple[float, float, float, float]]:
    """Return a lookup keyed by (district_key, muni_key).

    GADM has duplicate municipality names (e.g. Byala exists in both Ruse and
    Varna oblasts), so the muni key alone is not unique. We key by
    (district, muni), and additionally fill a (None, muni) entry pointing at
    the unique bbox for munis that appear in only one oblast.
    """
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

    by_muni: dict[str, list[tuple[str, tuple]]] = {}
    for feat in geo['features']:
        bbox = get_bbox(feat['geometry'])
        if not bbox:
            continue
        district_key = _normalize_muni_name(feat['properties']['NAME_1'])
        muni_key = _normalize_muni_name(feat['properties']['NAME_2'])
        by_muni.setdefault(muni_key, []).append((district_key, bbox))

    bboxes: dict[tuple[str | None, str], tuple[float, float, float, float]] = {}
    for muni_key, entries in by_muni.items():
        for district_key, bbox in entries:
            bboxes[(district_key, muni_key)] = bbox
        # Unique muni (no collision) — allow fallback lookup without district.
        if len(entries) == 1:
            bboxes[(None, muni_key)] = entries[0][1]
    return bboxes


def _lookup_bbox(
    bboxes: dict[tuple[str | None, str], tuple[float, float, float, float]],
    municipality: str | None,
    district: str | None,
) -> tuple[float, float, float, float] | None:
    if not municipality:
        return None
    muni_key = _normalize_muni_name(municipality)
    if district:
        hit = bboxes.get((_normalize_muni_name(district), muni_key))
        if hit is not None:
            return hit
    return bboxes.get((None, muni_key))


def validate_municipality_bounds(conn: sqlite3.Connection) -> int:
    bboxes = _load_municipality_bboxes()
    if not bboxes:
        print("Warning: no GADM data found, skipping municipality validation")
        return 0

    rows = conn.execute("""
        SELECT DISTINCT l.id, l.lat, l.lng, m.name, d.name
        FROM locations l
        JOIN municipalities m ON l.municipality_id = m.id
        LEFT JOIN districts d ON d.id = l.district_id
        LEFT JOIN riks r ON r.id = l.rik_id
        WHERE l.lat IS NOT NULL
          AND (r.oik_prefix IS NULL OR r.oik_prefix != '32')
    """).fetchall()

    MARGIN = 0.05
    bad_ids = []
    for loc_id, lat, lng, muni, district in rows:
        # Use (district, muni) lookup — muni name alone is not unique
        # (Бяла exists in both Русе and Варна). Unknown munis are skipped.
        bbox = _lookup_bbox(bboxes, muni, district)
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
    bboxes = _load_municipality_bboxes()

    missing = conn.execute("""
        SELECT l.id, l.address, l.settlement_name,
               CASE WHEN r.oik_prefix = '32' THEN 1 ELSE 0 END AS is_abroad,
               m.name as municipality,
               d.name as district
        FROM locations l
        LEFT JOIN riks r ON r.id = l.rik_id
        LEFT JOIN municipalities m ON m.id = l.municipality_id
        LEFT JOIN districts d ON d.id = l.district_id
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
        for loc_id, addr, settlement, is_abroad, municipality, district in missing[:30]:
            if is_abroad:
                queries = clean_address_abroad(addr, settlement)
            else:
                queries = clean_address(addr, settlement, municipality, district)
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

    for i, (loc_id, addr, settlement, is_abroad, municipality, district) in enumerate(missing, 1):
        if is_abroad:
            queries = clean_address_abroad(addr, settlement)
            target_bbox = None
        else:
            queries = clean_address(addr, settlement, municipality, district)
            target_bbox = _lookup_bbox(bboxes, municipality, district)

        if not queries:
            failed += 1
            continue

        # Check cache first
        was_cached = any(cache_lookup(q) != "uncached" for q in queries)

        result = geocode(queries, target_bbox=target_bbox)

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
