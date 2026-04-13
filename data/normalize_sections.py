#!/usr/bin/env python3
"""
normalize_sections.py

Deduplicates polling station data into a `locations` table (one row per
physical building), then links `sections` to locations via location_id.

Before:
  sections(election_id, section_code, rik_code, rik_name, ekatte,
           settlement_name, address, is_mobile, is_ship, machine_count)
  → 574k+ rows, address/settlement repeated ~13x per station

After:
  locations(id PK, ekatte, settlement_name, address)
  → ~9k rows, one per unique (ekatte, address) building

  sections(election_id, section_code, location_id FK, rik_code, rik_name,
           is_mobile, is_ship, machine_count)
  → 574k+ rows, no address duplication

Multiple section_codes at the same building share one location_id.
Canonical values: most frequently used non-empty string per section_code,
then deduplicated by (ekatte, normalized_address).

Safe to re-run: drops and recreates locations, rebuilds sections in-place.
"""

import json
import os
import re
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))
GEOCODE_CACHE_PATH = Path(__file__).parent / "geocode_cache.json"
# Snapshot of (ekatte|normalized_address) → {lat, lng, protocol_address} produced by
# data/dump_location_cache.py after a successful geocode / CIK scrape. Survives rebuilds.
LOCATION_CACHE_PATH = Path(__file__).parent / "location_cache.json"


def normalize_address(addr: str) -> str:
    """Normalize address for dedup: uppercase, collapse whitespace, strip punctuation noise."""
    s = addr.upper().strip()
    # Remove city/village prefix — "ГР. БАНСКО " or "С. ГОСТУН, "
    s = re.sub(r"^(ГР\.?\s+|С\.?\s+|МИН\.?\s+С\.?\s+|ОБЩ\.?\s+)[А-ЯA-Z\-]+[,\s]*", "", s)
    # Normalize quotes: replace all quote variants with nothing
    s = re.sub(r'["""\'„\u201c\u201d\u201e]', '', s)
    # Normalize № spacing
    s = re.sub(r"№\s*", "№", s)
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


def restore_coordinates_from_cache(cur: sqlite3.Cursor, loc_rows: list[tuple]) -> int:
    """Restore lat/lng from geocode_cache.json for locations that have cached results.

    The cache maps geocoding query strings → {lat, lng, ...}. We rebuild the same
    query strings that geocode_google.py would use for each address, then look them up.
    This means a rebuild never loses previously geocoded coordinates.
    """
    if not GEOCODE_CACHE_PATH.exists():
        print("  No geocode cache found, skipping coordinate restore")
        return 0

    with open(GEOCODE_CACHE_PATH) as f:
        cache = json.load(f)

    # Build a reverse lookup: normalized address → (lat, lng) from cache
    # The cache keys are query strings like "ул. Първа 5, София, България"
    # We need to match locations to cache entries. The simplest reliable approach:
    # try the same query patterns that geocode_google.py uses.
    restored = 0
    for loc_id, ekatte, settlement_name, address in loc_rows:
        if not address:
            continue

        # Try the full address as-is (most common cache key pattern)
        # Also try common query patterns from geocode_google.py
        queries_to_try = []

        # The cache stores queries built by clean_address() in geocode_google.py.
        # Rather than reimplementing that logic, do a simpler match:
        # search cache keys that contain the address or settlement
        addr_upper = address.upper().strip()
        settlement_clean = ""
        if settlement_name:
            settlement_clean = re.sub(r'^(гр\.?\s*|с\.?\s*)', '', settlement_name, flags=re.IGNORECASE).strip()

        # Try direct cache key matches for common patterns
        if settlement_clean:
            queries_to_try.append(f"{address}, {settlement_clean}, България")
            queries_to_try.append(f"{settlement_clean}, България")

        # Try extracting street from address
        m = re.search(r'(?:УЛ\.|БУЛ\.|ПЛ\.)\s*["""]?\s*([^,"""\n]+)', addr_upper)
        if m and settlement_clean:
            street = m.group(0).strip().rstrip(',.')
            street = re.sub(r'["""\u201c\u201d\u201e]', '', street)
            street = re.sub(r'№\s*', '', street)
            street = re.sub(r'\s+', ' ', street).strip()
            queries_to_try.append(f"{street}, {settlement_clean}, България")

        for q in queries_to_try:
            if q in cache and cache[q] is not None:
                lat = cache[q].get("lat")
                lng = cache[q].get("lng")
                if lat is not None and lng is not None:
                    cur.execute(
                        "UPDATE locations SET lat=?, lng=?, geocode_source='google' WHERE id=?",
                        (lat, lng, loc_id),
                    )
                    restored += 1
                    break

    return restored


def build_locations(cur: sqlite3.Cursor) -> int:
    """
    Build locations table from sections data.

    1. For each section_code, pick canonical ekatte, settlement_name, address
       (most frequent non-empty value across elections).
    2. Deduplicate by (ekatte, normalized_address) — one location per building.
    3. Map each section_code → location_id.
    """
    # Step 1: canonical values per section_code (same logic as old section_locations)
    print("  Extracting canonical values per section_code...")
    section_data = cur.execute("""
        SELECT
            section_code,
            (SELECT ekatte FROM sections s2
             WHERE s2.section_code = s.section_code
               AND s2.ekatte IS NOT NULL AND s2.ekatte != ''
             GROUP BY ekatte ORDER BY COUNT(*) DESC LIMIT 1),
            (SELECT settlement_name FROM sections s2
             WHERE s2.section_code = s.section_code
               AND s2.settlement_name IS NOT NULL AND s2.settlement_name != ''
             GROUP BY settlement_name ORDER BY COUNT(*) DESC LIMIT 1),
            (SELECT address FROM sections s2
             WHERE s2.section_code = s.section_code
               AND s2.address IS NOT NULL AND s2.address != ''
             GROUP BY address ORDER BY COUNT(*) DESC LIMIT 1)
        FROM sections s
        GROUP BY section_code
    """).fetchall()
    print(f"  {len(section_data):,} unique section_codes")

    # Step 2: deduplicate by (ekatte, normalized_address) → location_id
    # For sections without address, use (ekatte, section_code) as fallback key
    # For sections without ekatte AND address, each gets its own location
    print("  Deduplicating by (ekatte, normalized_address)...")
    loc_map: dict[tuple, int] = {}  # (ekatte, norm_addr) → location_id
    loc_rows: list[tuple] = []      # (id, ekatte, settlement_name, address)
    section_to_loc: dict[str, int] = {}  # section_code → location_id
    next_id = 1

    for section_code, ekatte, settlement_name, address in section_data:
        if address:
            norm = normalize_address(address)
            key = (ekatte or "", norm)
        elif ekatte:
            # No address but has ekatte — group by ekatte only
            # (small villages with one polling station)
            key = (ekatte, "")
        else:
            # No address, no ekatte — unique per section_code
            key = ("", section_code)

        if key not in loc_map:
            loc_map[key] = next_id
            loc_rows.append((next_id, ekatte, settlement_name, address))
            next_id += 1

        section_to_loc[section_code] = loc_map[key]

    print(f"  {len(loc_rows):,} unique locations")

    # Step 3: write to DB
    cur.executescript("""
        DROP TABLE IF EXISTS locations;
        CREATE TABLE locations (
            id               INTEGER PRIMARY KEY,
            ekatte           TEXT,
            settlement_name  TEXT,
            address          TEXT,
            lat              REAL,
            lng              REAL,
            geocode_source   TEXT,
            location_type    TEXT,
            protocol_address TEXT
        );
    """)

    cur.executemany(
        "INSERT INTO locations (id, ekatte, settlement_name, address) VALUES (?,?,?,?)",
        loc_rows,
    )

    # Step 4: restore coordinates + protocol addresses.
    # location_cache.json is authoritative — it holds the output of prior
    # geocoding + CIK scraping runs, so a rebuild keeps that work.
    # Fall back to the raw geocode_cache.json for anything missing.
    cache_restored = restore_from_location_cache(cur, loc_rows)
    print(f"  {cache_restored['coords']:,} locations restored coordinates from location_cache.json")
    print(f"  {cache_restored['proto']:,} locations restored protocol_address from location_cache.json")

    legacy_restored = restore_coordinates_from_cache(cur, loc_rows)
    if legacy_restored:
        print(f"  {legacy_restored:,} additional coordinates restored from legacy geocode_cache.json")

    return section_to_loc


def restore_from_location_cache(cur: sqlite3.Cursor, loc_rows: list[tuple]) -> dict[str, int]:
    """Fill lat/lng/protocol_address from data/location_cache.json.

    Key format: "{ekatte}|{normalized_address}" — matches dump_location_cache.py.
    """
    if not LOCATION_CACHE_PATH.exists():
        print("  No location_cache.json found — skip persistent restore")
        return {"coords": 0, "proto": 0}

    with open(LOCATION_CACHE_PATH, encoding="utf-8") as f:
        cache = json.load(f)

    coords = 0
    proto  = 0
    for loc_id, ekatte, settlement_name, address in loc_rows:
        ek = (ekatte or "").strip()
        addr_norm = normalize_address(address) if address else ""
        key = f"{ek}|{addr_norm}"
        if not key or key == "|":
            continue
        entry = cache.get(key)
        if not entry:
            continue

        lat = entry.get("lat")
        lng = entry.get("lng")
        if lat is not None and lng is not None:
            cur.execute(
                "UPDATE locations SET lat = ?, lng = ?, "
                "geocode_source = COALESCE(?, geocode_source) WHERE id = ?",
                (lat, lng, entry.get("geocode_source"), loc_id),
            )
            coords += 1

        proto_addr = entry.get("protocol_address")
        if proto_addr:
            cur.execute(
                "UPDATE locations SET protocol_address = ? WHERE id = ?",
                (proto_addr, loc_id),
            )
            proto += 1

    return {"coords": coords, "proto": proto}


def rebuild_sections(cur: sqlite3.Cursor, section_to_loc: dict[str, int]) -> None:
    """Recreate sections: drop address columns (except settlement_name), add location_id FK.

    settlement_name is preserved per-election because abroad sections can map to
    different countries across elections — the server uses it for country grouping.
    """

    cur.executescript("""
        ALTER TABLE sections RENAME TO sections_old;

        CREATE TABLE sections (
            id              INTEGER PRIMARY KEY,
            election_id     INTEGER NOT NULL,
            section_code    TEXT    NOT NULL,
            location_id     INTEGER,
            rik_code        TEXT,
            rik_name        TEXT,
            settlement_name TEXT,
            is_mobile       INTEGER DEFAULT 0,
            is_ship         INTEGER DEFAULT 0,
            machine_count   INTEGER DEFAULT 0,
            FOREIGN KEY (election_id) REFERENCES elections(id),
            FOREIGN KEY (location_id) REFERENCES locations(id)
        );

        INSERT INTO sections
               (id, election_id, section_code, rik_code, rik_name,
                settlement_name, is_mobile, is_ship, machine_count)
        SELECT  id, election_id, section_code, rik_code, rik_name,
                settlement_name, is_mobile, is_ship, machine_count
        FROM sections_old;

        DROP TABLE sections_old;

        CREATE INDEX idx_sections_election ON sections(election_id);
        CREATE INDEX idx_sections_code     ON sections(section_code);
        CREATE INDEX idx_sections_location ON sections(location_id);
    """)

    # Set location_id from the mapping
    cur.executemany(
        "UPDATE sections SET location_id = ? WHERE section_code = ?",
        [(loc_id, sec_code) for sec_code, loc_id in section_to_loc.items()],
    )


def print_stats(cur: sqlite3.Cursor) -> None:
    n_locs = cur.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    n_with_addr = cur.execute(
        "SELECT COUNT(*) FROM locations WHERE address IS NOT NULL AND address != ''"
    ).fetchone()[0]
    n_sections = cur.execute("SELECT COUNT(*) FROM sections").fetchone()[0]
    n_linked = cur.execute("SELECT COUNT(*) FROM sections WHERE location_id IS NOT NULL").fetchone()[0]

    print(f"\n  locations:  {n_locs:>6,} rows  ({n_with_addr:,} with address)")
    print(f"  sections:   {n_sections:>6,} rows  ({n_linked:,} linked to location)")


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    print("Building locations from sections...")
    section_to_loc = build_locations(cur)

    print("Rebuilding sections table...")
    rebuild_sections(cur, section_to_loc)

    conn.commit()
    print_stats(cur)
    conn.close()


if __name__ == "__main__":
    main()
