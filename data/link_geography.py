#!/usr/bin/env python3
"""
link_geography.py

Links locations rows to the geography reference tables:
  - municipality_id  derived from section_code prefix → municipalities.oik_code
  - kmetstvo_id      derived from ekatte → kmetstva
  - district_id      derived from municipality → districts
  - rik_id           derived from section_code prefix → riks.oik_prefix
  - local_region_id  derived from settlement_name "р-н <name>"

Each location gets its geography from the most common section_code that
maps to it (for prefix-based lookups like municipality and rik).

Safe to re-run — columns are added with IF NOT EXISTS and updates are idempotent.
"""

import os
import re
import sqlite3
from collections import Counter
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))


def column_exists(conn: sqlite3.Connection, table: str, col: str) -> bool:
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})").fetchall())


def ensure_columns(conn: sqlite3.Connection) -> None:
    """Add geography FK columns to locations if not present."""
    columns = [
        ("municipality_id", "INTEGER REFERENCES municipalities(id)"),
        ("kmetstvo_id", "INTEGER REFERENCES kmetstva(id)"),
        ("district_id", "INTEGER REFERENCES districts(id)"),
        ("rik_id", "INTEGER REFERENCES riks(id)"),
        ("local_region_id", "INTEGER REFERENCES local_regions(id)"),
    ]
    for col, typedef in columns:
        if not column_exists(conn, "locations", col):
            conn.execute(f"ALTER TABLE locations ADD COLUMN {col} {typedef}")
    conn.commit()


def extract_local_region_name(raw: str) -> str | None:
    """Extract local region name from settlement_name.

    "гр. Варна р-н "Одесос"" → "Одесос"
    "р-н Аспарухово"         → "Аспарухово"
    """
    if not raw:
        return None
    idx = raw.lower().find("р-н")
    if idx < 0:
        return None
    rest = raw[idx + 3:].strip()
    rest = re.sub(r'^[\"\'„\u201c\u201d]+|[\"\'„\u201c\u201d]+$', '', rest).strip()
    return rest if rest else None


def match_local_region(name: str, municipality_id: int | None,
                        lr_by_municipality: dict[int, list[tuple[int, str]]],
                        lr_all: list[tuple[int, str]] | None = None) -> int | None:
    """Return local_region.id by word-overlap match."""
    name_words = set(re.sub(r"[^А-ЯA-Z0-9]", " ", name.upper()).split()) - {""}
    if not name_words:
        return None

    def _any_word(regions: list[tuple[int, str]]) -> int | None:
        hits = [lr_id for lr_id, lr_name in regions
                if name_words & set(re.sub(r"[^А-ЯA-Z0-9]", " ", lr_name.upper()).split())]
        return hits[0] if len(hits) == 1 else None

    def _all_words(regions: list[tuple[int, str]]) -> int | None:
        hits = [lr_id for lr_id, lr_name in regions
                if name_words <= set(re.sub(r"[^А-ЯA-Z0-9]", " ", lr_name.upper()).split())]
        return hits[0] if len(hits) == 1 else None

    if municipality_id is not None:
        regions = lr_by_municipality.get(municipality_id, [])
        result = _any_word(regions)
        if result is not None:
            return result

    if lr_all:
        return _all_words(lr_all)
    return None


def extract_name(raw: str) -> str | None:
    """Extract clean title-cased settlement name from settlement_name.
      "гр.Банско" → "Банско"
      "с. Гостун" → "Гостун"
    """
    if not raw:
        return None
    lower = raw.lower().strip()
    if any(skip in lower for skip in ("плавателни", "р-н ", "р-н\t")):
        return None
    dot = raw.rfind(".")
    name = raw[dot + 1:].strip() if dot >= 0 else raw.strip()
    return name.title() if name else None


def main() -> None:
    conn = sqlite3.connect(DB_PATH, timeout=120)
    conn.execute("PRAGMA journal_mode=WAL")

    total = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]

    ensure_columns(conn)

    # Build a mapping: location_id → most common section_code prefix (first 4 digits)
    # This determines municipality assignment for each location.
    print("Building location → section_code mapping...")
    loc_sections = conn.execute("""
        SELECT location_id, section_code FROM sections WHERE location_id IS NOT NULL
    """).fetchall()

    # For each location, find the most common 4-digit prefix (municipality code)
    loc_prefix: dict[int, str] = {}
    loc_rik_prefix: dict[int, str] = {}
    prefix_counter: dict[int, Counter] = {}
    rik_counter: dict[int, Counter] = {}

    for loc_id, sec_code in loc_sections:
        prefix_counter.setdefault(loc_id, Counter())[sec_code[:4]] += 1
        rik_counter.setdefault(loc_id, Counter())[sec_code[:2]] += 1

    for loc_id, counter in prefix_counter.items():
        loc_prefix[loc_id] = counter.most_common(1)[0][0]
    for loc_id, counter in rik_counter.items():
        loc_rik_prefix[loc_id] = counter.most_common(1)[0][0]

    # -----------------------------------------------------------------------
    # Step 1 — municipality_id from section_code prefix
    # -----------------------------------------------------------------------
    print("Step 1: municipality_id")
    muni_map: dict[str, int] = {
        row[0]: row[1]
        for row in conn.execute("SELECT oik_code, id FROM municipalities").fetchall()
    }

    muni_updates = []
    for loc_id, oik_code in loc_prefix.items():
        if oik_code[:2] == "32":  # abroad
            continue
        muni_id = muni_map.get(oik_code)
        if muni_id:
            muni_updates.append((muni_id, loc_id))

    conn.executemany("UPDATE locations SET municipality_id = ? WHERE id = ?", muni_updates)
    conn.commit()

    n = conn.execute("SELECT COUNT(*) FROM locations WHERE municipality_id IS NOT NULL").fetchone()[0]
    print(f"  {n:,}/{total:,} locations linked to municipality")

    # -----------------------------------------------------------------------
    # Step 2 — populate kmetstva.ekatte by name-matching
    # -----------------------------------------------------------------------
    print("\nStep 2: populate kmetstva.ekatte")

    kmetstva_lut: dict[tuple, int] = {
        (row[1], row[2]): row[0]
        for row in conn.execute("SELECT id, name, municipality_id FROM kmetstva").fetchall()
    }

    kmetstva_by_name: dict[str, list[int]] = {}
    for kid, kname in conn.execute("SELECT id, name FROM kmetstva").fetchall():
        kmetstva_by_name.setdefault(kname, []).append(kid)

    # From locations: (ekatte → list of (settlement_name, oik_code))
    ekatte_candidates: dict[str, list] = {}
    for loc_id, ekatte, sname in conn.execute("""
        SELECT id, ekatte, settlement_name FROM locations
        WHERE ekatte IS NOT NULL AND ekatte != ''
          AND settlement_name IS NOT NULL
    """).fetchall():
        oik = loc_prefix.get(loc_id, "")
        if oik[:2] != "32":
            ekatte_candidates.setdefault(ekatte, []).append((sname, oik))

    ekatte_to_kid: dict[str, int] = {}
    matched = 0
    matched_fallback = 0

    for ekatte, candidates in ekatte_candidates.items():
        sname_raw, oik = Counter(candidates).most_common(1)[0][0]
        muni_id = muni_map.get(oik)
        clean = extract_name(sname_raw)

        if not clean:
            continue

        kid = kmetstva_lut.get((clean, muni_id)) if muni_id else None
        if kid is not None:
            ekatte_to_kid[ekatte] = kid
            matched += 1
            continue

        candidates_by_name = kmetstva_by_name.get(clean, [])
        if len(candidates_by_name) == 1:
            ekatte_to_kid[ekatte] = candidates_by_name[0]
            matched_fallback += 1

    conn.executemany(
        "UPDATE kmetstva SET ekatte = ? WHERE id = ?",
        [(ekatte, kid) for ekatte, kid in ekatte_to_kid.items()],
    )
    conn.commit()

    print(f"  {matched:,} ekatte codes matched (by name+municipality)")
    print(f"  {matched_fallback:,} ekatte codes matched (by unique name, fallback)")

    # -----------------------------------------------------------------------
    # Step 3 — kmetstvo_id on locations
    # -----------------------------------------------------------------------
    print("\nStep 3: kmetstvo_id")
    conn.execute("""
        UPDATE locations
        SET kmetstvo_id = (
            SELECT id FROM kmetstva WHERE kmetstva.ekatte = locations.ekatte
        )
        WHERE locations.ekatte IS NOT NULL
    """)
    conn.commit()

    n = conn.execute("SELECT COUNT(*) FROM locations WHERE kmetstvo_id IS NOT NULL").fetchone()[0]
    print(f"  {n:,}/{total:,} locations linked to kmetstvo")

    # -----------------------------------------------------------------------
    # Step 4 — fill remaining municipality_id via kmetstvo → municipality
    # -----------------------------------------------------------------------
    print("\nStep 4: municipality_id via kmetstvo_id")
    conn.execute("""
        UPDATE locations
        SET municipality_id = (
            SELECT municipality_id FROM kmetstva WHERE id = locations.kmetstvo_id
        )
        WHERE municipality_id IS NULL AND kmetstvo_id IS NOT NULL
    """)
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM locations WHERE municipality_id IS NOT NULL").fetchone()[0]
    print(f"  {n:,}/{total:,} total after kmetstvo fallback")

    # -----------------------------------------------------------------------
    # Step 4b — fix municipality_id conflicts using EKATTE as ground truth
    # -----------------------------------------------------------------------
    # Some section code prefixes changed when МИР boundaries were reorganized
    # (e.g. Елин Пелин sections moved from prefix 2317 to 2617). The prefix-based
    # mapping in Step 1 assigns these to the wrong municipality. Kmetstva table
    # has the authoritative EKATTE → municipality mapping for settlements.
    print("\nStep 4b: fix municipality_id via EKATTE → kmetstva")
    # Build EKATTE → correct municipality from kmetstva
    ekatte_correct_muni = {}
    for ek, mid in conn.execute(
        "SELECT ekatte, municipality_id FROM kmetstva WHERE ekatte IS NOT NULL"
    ).fetchall():
        ekatte_correct_muni[ek] = mid

    # Cities that don't have kmetstva entries — hardcoded from EKATTE registry
    ekatte_correct_muni.setdefault("27303", 207)  # гр. Елин Пелин
    ekatte_correct_muni.setdefault("18280", 225)  # гр. Гълъбово

    # Find locations where municipality_id disagrees with kmetstva
    fixes = []
    for loc_id, ekatte, current_mid in conn.execute("""
        SELECT id, ekatte, municipality_id FROM locations
        WHERE ekatte IS NOT NULL AND municipality_id IS NOT NULL
    """).fetchall():
        correct = ekatte_correct_muni.get(ekatte)
        if correct and correct != current_mid:
            fixes.append((correct, loc_id))

    if fixes:
        conn.executemany("UPDATE locations SET municipality_id = ? WHERE id = ?", fixes)
        conn.commit()
        print(f"  {len(fixes):,} locations corrected")
    else:
        print("  no corrections needed")

    n = conn.execute("SELECT COUNT(*) FROM locations WHERE municipality_id IS NOT NULL").fetchone()[0]
    print(f"  {n:,}/{total:,} total after EKATTE correction")

    # -----------------------------------------------------------------------
    # Step 4c — fix remaining NULL municipality_id using RIK + settlement name
    # -----------------------------------------------------------------------
    # Locations with new section prefixes (МИР renumbering) that don't match
    # any municipality oik_code. Use the RIK district + settlement name to
    # find the correct municipality from already-mapped data.
    print("\nStep 4c: remaining NULL municipality via RIK + settlement name")

    # Build RIK → set of municipalities (from correctly mapped data)
    rik_munis: dict[str, set[int]] = {}
    for rik_code, mid in conn.execute("""
        SELECT DISTINCT s.rik_code, l.municipality_id
        FROM sections s
        JOIN locations l ON l.id = s.location_id
        WHERE l.municipality_id IS NOT NULL AND s.rik_code != '32'
    """).fetchall():
        rik_munis.setdefault(rik_code, set()).add(mid)

    # Build municipality → set of settlement names
    muni_snames: dict[int, set[str]] = {}
    for mid, name in conn.execute("SELECT municipality_id, name FROM kmetstva").fetchall():
        muni_snames.setdefault(mid, set()).add(name.lower())
    for mid, sname in conn.execute("""
        SELECT municipality_id, settlement_name FROM locations
        WHERE municipality_id IS NOT NULL AND settlement_name IS NOT NULL
    """).fetchall():
        clean = re.sub(r"^(гр\.|с\.|мин\.с\.)\s*", "", sname.strip(), flags=re.IGNORECASE).strip().lower()
        clean = re.sub(r"\s*\(.*\)", "", clean).strip()
        muni_snames.setdefault(mid, set()).add(clean)

    # Sofia district → Столична община mapping
    sofia_id = conn.execute(
        "SELECT id FROM municipalities WHERE name = 'Столична'"
    ).fetchone()
    sofia_muni = sofia_id[0] if sofia_id else None

    unfixed = conn.execute("""
        SELECT l.id, l.ekatte, l.settlement_name,
               (SELECT s.rik_code FROM sections s WHERE s.location_id = l.id LIMIT 1)
        FROM locations l
        WHERE l.municipality_id IS NULL AND l.ekatte IS NOT NULL
          AND l.id IN (SELECT location_id FROM sections WHERE rik_code != '32')
    """).fetchall()

    step4c_fixes = []
    for loc_id, ekatte, sname, rik in unfixed:
        if not rik or not sname:
            continue

        # Sofia quarters and Банкя belong to Столична община
        if sofia_muni and (sname.startswith("гр. София") or "банкя" in sname.lower()):
            step4c_fixes.append((sofia_muni, loc_id))
            continue

        clean = re.sub(r"^(гр\.|с\.|мин\.с\.)\s*", "", sname.strip(), flags=re.IGNORECASE)
        clean = re.sub(r"\s*\(.*\)", "", clean).strip().lower()
        candidates = rik_munis.get(rik, set())
        matched = [mid for mid in candidates if clean in muni_snames.get(mid, set())]
        if len(matched) == 1:
            step4c_fixes.append((matched[0], loc_id))
        elif len(matched) > 1:
            # Disambiguate: the section prefix suffix (last 2 of 4 digits) should
            # match the municipality oik_code suffix. E.g. prefix 3122 → oik XX22.
            sec_prefix = loc_prefix.get(loc_id, "")
            suffix = sec_prefix[2:4] if len(sec_prefix) >= 4 else ""
            for mid in matched:
                moik = conn.execute("SELECT oik_code FROM municipalities WHERE id=?", (mid,)).fetchone()
                if moik and moik[0][2:4] == suffix:
                    step4c_fixes.append((mid, loc_id))
                    break

    if step4c_fixes:
        conn.executemany("UPDATE locations SET municipality_id = ? WHERE id = ?", step4c_fixes)
        conn.commit()
        print(f"  {len(step4c_fixes):,} locations fixed")

    n = conn.execute("SELECT COUNT(*) FROM locations WHERE municipality_id IS NOT NULL").fetchone()[0]
    remaining = conn.execute("""
        SELECT COUNT(*) FROM locations l
        WHERE l.municipality_id IS NULL
          AND l.id IN (SELECT location_id FROM sections WHERE rik_code != '32')
    """).fetchone()[0]
    print(f"  {n:,}/{total:,} total linked ({remaining} domestic still missing)")

    # -----------------------------------------------------------------------
    # Step 5 — district_id via municipality_id → municipalities.district_id
    # -----------------------------------------------------------------------
    print("\nStep 5: district_id")
    conn.execute("""
        UPDATE locations
        SET district_id = (
            SELECT district_id FROM municipalities WHERE id = locations.municipality_id
        )
        WHERE municipality_id IS NOT NULL
    """)
    conn.commit()

    n = conn.execute("SELECT COUNT(*) FROM locations WHERE district_id IS NOT NULL").fetchone()[0]
    print(f"  {n:,}/{total:,} locations linked to district")

    # -----------------------------------------------------------------------
    # Step 6 — rik_id via section_code prefix → riks.oik_prefix
    # -----------------------------------------------------------------------
    print("\nStep 6: rik_id")
    # riks.oik_prefix is "01", "02", ...; section_code prefix is "01", "02", ...
    rik_map: dict[str, int] = {
        row[0]: row[1]
        for row in conn.execute("SELECT oik_prefix, id FROM riks").fetchall()
    }

    rik_updates = []
    for loc_id, rik_prefix in loc_rik_prefix.items():
        rik_id = rik_map.get(rik_prefix)
        if rik_id:
            rik_updates.append((rik_id, loc_id))

    conn.executemany("UPDATE locations SET rik_id = ? WHERE id = ?", rik_updates)
    conn.commit()

    n = conn.execute("SELECT COUNT(*) FROM locations WHERE rik_id IS NOT NULL").fetchone()[0]
    print(f"  {n:,}/{total:,} locations linked to rik (МИР)")

    # -----------------------------------------------------------------------
    # Step 7 — local_region_id via settlement_name "р-н <name>"
    # -----------------------------------------------------------------------
    print("\nStep 7: local_region_id")
    lr_rows = conn.execute("SELECT id, name, municipality_id FROM local_regions").fetchall()
    lr_by_municipality: dict[int, list[tuple[int, str]]] = {}
    for lr_id, lr_name, muni_id in lr_rows:
        lr_by_municipality.setdefault(muni_id, []).append((lr_id, lr_name))
    lr_all = [(lr_id, lr_name) for lr_id, lr_name, _ in lr_rows]

    lr_by_rik_prefix: dict[str, list[tuple[int, str]]] = {}
    for lr_id, lr_name, muni_id in lr_rows:
        muni = conn.execute("SELECT oik_code FROM municipalities WHERE id=?", (muni_id,)).fetchone()
        if muni:
            prefix = muni[0][:2]
            lr_by_rik_prefix.setdefault(prefix, []).append((lr_id, lr_name))

    lr_locs = conn.execute("""
        SELECT id, settlement_name, municipality_id
        FROM locations
        WHERE settlement_name IS NOT NULL
          AND INSTR(LOWER(settlement_name), 'р-н') > 0
    """).fetchall()

    lr_updates = []
    lr_matched = 0

    for loc_id, sname, muni_id in lr_locs:
        region_name = extract_local_region_name(sname)
        if not region_name:
            continue
        lr_id = match_local_region(region_name, muni_id, lr_by_municipality, lr_all)
        if lr_id is None:
            rik_pref = loc_rik_prefix.get(loc_id, "")
            effective = "22" if rik_pref in ("23", "24", "25") else rik_pref
            rik_regions = lr_by_rik_prefix.get(effective, [])
            lr_id = match_local_region(region_name, None, {}, rik_regions)
        if lr_id is not None:
            lr_updates.append((lr_id, loc_id))
            lr_matched += 1

    conn.executemany("UPDATE locations SET local_region_id = ? WHERE id = ?", lr_updates)
    conn.commit()

    print(f"  {lr_matched:,} locations linked to local_region")

    # Indexes
    for col in ("municipality_id", "kmetstvo_id", "district_id", "rik_id", "local_region_id"):
        conn.execute(f"CREATE INDEX IF NOT EXISTS idx_loc_{col} ON locations({col})")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_kmetstva_ekatte ON kmetstva(ekatte)")
    conn.commit()

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
