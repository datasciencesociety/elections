#!/usr/bin/env python3
"""
override_section_addresses.py

Populates `sections.address` per (election_id, section_code) from each
election's CIK sections CSV. Unlike the normal import pipeline — which
consolidates addresses into `locations` by picking the most-frequent one
across all elections — this preserves per-election variants so a section
that was temporarily relocated (e.g. renovations) has the right address
for each election it's displayed in.

Also populates `sections.lat`/`sections.lng` for sections whose per-election
address differs materially from the shared `locations.address`. The server
then COALESCEs section over location.

Steps:
  1. ALTER TABLE sections ADD COLUMN address/lat/lng (done separately if needed).
  2. For each election CSV, UPDATE sections.address WHERE (election_id, section_code).
  3. For each section where address extraction differs from locations.address,
     queue it for geocoding.
  4. Run the geocoder on the queue, writing lat/lng to sections.
"""

from __future__ import annotations

import os
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from geocode_google import (
    clean_address, geocode_google, load_cache, cache_lookup, cache_store, save_cache,
    extract_street_query, _load_municipality_bboxes, _lookup_bbox, _in_bbox, _cache,
)

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))

# (election_id, CSV path). Elections that share a CSV (same date + same RIK set)
# have one entry per election_id.
SOURCES: list[tuple[int, str]] = [
    (1,  "data/cik-exports/pe202410/Актуализирана база данни/sections_27.10.2024.txt"),
    (2,  "data/cik-exports/pe202410_ks/Актуализирана база данни/sections.txt"),
    (3,  "data/cik-exports/europe2024/Актуализирана база данни - НС/sections_09.06.2024.txt"),
    (4,  "data/cik-exports/europe2024/Актуализирана база данни - ЕП/sections_09.06.2024.txt"),
    (12, "data/cik-exports/ns2023/data_02/sections_02.04.2023.txt"),
    (13, "data/cik-exports/ns2022/np/sections_02.10.2022.txt"),
    (5,  "data/cik-exports/mi2023_tur1/data_02/sections_29.10.2023.txt"),
    (6,  "data/cik-exports/mi2023_tur1/data_02/sections_29.10.2023.txt"),
    (7,  "data/cik-exports/mi2023_tur1/data_02/sections_29.10.2023.txt"),
    (8,  "data/cik-exports/mi2023_tur1/data_02/sections_29.10.2023.txt"),
    (9,  "data/cik-exports/mi2023_tur2/data_02/sections_29.10.2023.txt"),
    (10, "data/cik-exports/mi2023_tur2/data_02/sections_29.10.2023.txt"),
    (11, "data/cik-exports/mi2023_tur2/data_02/sections_29.10.2023.txt"),
]


def _street_key(addr: str | None) -> tuple[frozenset[str], str] | None:
    """Normalised (token_set, number) for semantic street comparison.
    Matches the logic we used to count genuine relocations."""
    if not addr:
        return None
    q = extract_street_query(addr)
    if not q:
        return None
    m = re.match(r'(УЛ\.|БУЛ\.|ПЛ\.)\s+(.+?)(?:\s+№(\S+))?$', q)
    if not m:
        return None
    name = re.sub(r'[^А-ЯA-Z0-9 ]', ' ', m.group(2))
    # Drop abbreviation-sized tokens (ИВ., Н., Г.) so "ИВ ГАЛЧЕВ" matches "ИВАН ГАЛЧЕВ"
    tokens = frozenset(t for t in name.split() if len(t) >= 4)
    num = (m.group(3) or '').lstrip('0')
    return (tokens, num)


def _addresses_differ(section_addr: str | None, location_addr: str | None) -> bool:
    """True if the section address is a meaningfully different building."""
    a = _street_key(section_addr)
    b = _street_key(location_addr)
    if not a or not b:
        return False
    a_tok, a_num = a
    b_tok, b_num = b
    if a == b:
        return False
    # Token-disjoint = different street entirely
    if a_tok and b_tok and not (a_tok & b_tok):
        return True
    # Same street, number diff of more than 5 = likely different building
    if a_tok == b_tok and a_num and b_num and a_num != b_num:
        try:
            if abs(int(re.sub(r'\D', '', a_num)) - int(re.sub(r'\D', '', b_num))) > 5:
                return True
        except ValueError:
            pass
    return False


def load_csv_addresses(path: Path) -> dict[str, str]:
    """Return {section_code: address} from a CIK sections CSV."""
    if not path.exists():
        print(f"  MISSING: {path}", file=sys.stderr)
        return {}
    result: dict[str, str] = {}
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        parts = line.split(';')
        if len(parts) < 6:
            continue
        code = parts[0]
        if not re.match(r'^\d{9}$', code):
            continue
        addr = parts[5].strip()
        if addr:
            result[code] = addr
    return result


def populate_section_addresses(conn: sqlite3.Connection) -> int:
    """Write per-election addresses to `sections.address`."""
    total_updated = 0
    by_election: dict[int, dict[str, str]] = defaultdict(dict)
    for elec_id, path in SOURCES:
        addrs = load_csv_addresses(Path(path))
        by_election[elec_id] = addrs
        print(f"  election {elec_id}: loaded {len(addrs):,} addresses from {Path(path).name}")

    cur = conn.cursor()
    for elec_id, addrs in by_election.items():
        rows = [(addr, elec_id, code) for code, addr in addrs.items()]
        cur.executemany(
            "UPDATE sections SET address = ? WHERE election_id = ? AND section_code = ?",
            rows,
        )
        total_updated += cur.rowcount if cur.rowcount >= 0 else len(rows)
    conn.commit()
    return total_updated


def find_relocations(conn: sqlite3.Connection) -> list[tuple[int, str, str, str, int, str | None, str | None]]:
    """Return sections where address materially differs from the shared location.
    Tuple: (section_id, section_code, section_address, loc_address, election_id, settlement, muni, district)."""
    rows = conn.execute("""
        SELECT s.id, s.section_code, s.address, l.address, s.election_id,
               l.settlement_name, m.name as muni, d.name as district,
               l.lat as loc_lat, l.lng as loc_lng
        FROM sections s
        JOIN locations l ON l.id = s.location_id
        LEFT JOIN municipalities m ON m.id = l.municipality_id
        LEFT JOIN districts d ON d.id = l.district_id
        LEFT JOIN riks r ON r.id = l.rik_id
        WHERE s.address IS NOT NULL
          AND l.address IS NOT NULL
          AND COALESCE(l.location_type, 'regular') NOT IN ('mobile','ship')
          AND (r.oik_prefix IS NULL OR r.oik_prefix != '32')
    """).fetchall()
    return [r for r in rows if _addresses_differ(r[2], r[3])]


def geocode_sections(conn: sqlite3.Connection, rows: list) -> tuple[int, int]:
    """Geocode each relocated section's address; store on sections.lat/lng.

    Uses the existing geocoder cache + bbox validation. Same query shapes
    as the normal pipeline (full hierarchy, ordinal normalization, inline
    bbox accept/reject)."""
    load_cache()
    bboxes = _load_municipality_bboxes()

    cur = conn.cursor()
    ok = 0
    fail = 0
    for (sec_id, code, sec_addr, loc_addr, elec_id, settlement, muni, district, _ll, _lg) in rows:
        target = _lookup_bbox(bboxes, muni, district)
        queries = clean_address(sec_addr, settlement, muni, district)

        result = None
        for q in queries:
            cached = cache_lookup(q)
            if cached == 'uncached':
                if geocode_google is None:
                    continue
                r = geocode_google(q)
                if r:
                    lat, lng, fmt, t = r
                    cache_store(q, lat, lng, fmt, t)
                    if target is None or _in_bbox(lat, lng, target):
                        result = (lat, lng)
                        break
                else:
                    cache_store(q, None, None)
            elif cached is not None:
                lat, lng = cached
                if target is None or _in_bbox(lat, lng, target):
                    result = (lat, lng)
                    break

        if result:
            lat, lng = result
            cur.execute("UPDATE sections SET lat = ?, lng = ? WHERE id = ?", (lat, lng, sec_id))
            ok += 1
        else:
            fail += 1

        if (ok + fail) % 50 == 0:
            conn.commit()
            save_cache()
            print(f"    [{ok+fail}/{len(rows)}] ok={ok} fail={fail}", flush=True)

    conn.commit()
    save_cache()
    return ok, fail


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    print("1. Populating sections.address from per-election CSVs…")
    n = populate_section_addresses(conn)
    print(f"   updated: {n:,} section rows")

    print("\n2. Finding material relocations (different street or number>5 apart)…")
    rows = find_relocations(conn)
    print(f"   relocations: {len(rows):,}")

    print("\n3. Geocoding per-section addresses…")
    ok, fail = geocode_sections(conn, rows)
    print(f"   geocoded: {ok:,}  failed: {fail:,}")

    # Post-validation: null any sections.lat/lng that landed outside the muni bbox.
    # (Defensive; geocode_sections already in-line validates.)
    bboxes = _load_municipality_bboxes()
    nulled = 0
    for row in conn.execute("""
        SELECT s.id, s.lat, s.lng, m.name, d.name
        FROM sections s
        JOIN locations l ON l.id = s.location_id
        LEFT JOIN municipalities m ON m.id = l.municipality_id
        LEFT JOIN districts d ON d.id = l.district_id
        WHERE s.lat IS NOT NULL
    """).fetchall():
        sid, lat, lng, muni, district = row
        bbox = _lookup_bbox(bboxes, muni, district)
        if bbox and not _in_bbox(lat, lng, bbox):
            conn.execute("UPDATE sections SET lat = NULL, lng = NULL WHERE id = ?", (sid,))
            nulled += 1
    conn.commit()
    if nulled:
        print(f"   post-validation nulled {nulled} out-of-bounds section coords")

    conn.close()


if __name__ == "__main__":
    main()
