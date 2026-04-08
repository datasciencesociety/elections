#!/usr/bin/env python3
"""
import_gps.py

Imports GPS coordinates from voting_locations.json into the locations table.
Uses multiple matching strategies (exact normalized, aggressive, street key,
institution name, token overlap) to handle format differences between
VL entries and the freshly-built locations table.

Run after: normalize_sections.py, link_geography.py
Run before: migrate_schema.py

Safe to re-run: adds lat/lng columns if missing, updates only NULL entries.
"""

import json
import os
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))
VL_PATH = Path(__file__).parent.parent.parent / "map-dashboard" / "public" / "voting_locations.json"


def strip_norm(s: str) -> str:
    s = s.upper().strip()
    s = re.sub(r'^(ГР\.?\s+|С\.?\s+|МИН\.?\s+С\.?\s+)[А-ЯA-Z\-]+[\s,]*', '', s).strip()
    s = re.sub(r'["""\'\u201c\u201d\u201e\(\)]', '', s)
    s = re.sub(r'[\u2013\u2014\u2012\-]', ' ', s)
    s = re.sub(r'№\s*', '', s)
    s = re.sub(r'([А-ЯA-Z])(\d)', r'\1 \2', s)
    s = re.sub(r'(\d)([А-ЯA-Z])', r'\1 \2', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def aggressive_norm(s: str) -> str:
    s = s.upper().strip()
    s = re.sub(r'^(ГР\.?\s*|С\.?\s*|МИН\.?\s*С\.?\s*)[А-ЯA-Z\-\s]+[,\s]+', '', s).strip()
    s = re.sub(r'[^\wА-ЯЁ ]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def extract_street_key(addr: str, settlement: str | None = None) -> str | None:
    upper = addr.upper().strip()
    m = re.search(r'(УЛ\.?|БУЛ\.?|ПЛ\.?)\s*["""\u201c\u201d\u201e]*\s*([^,\d]+?)\s*(?:№\s*)?(\d+)', upper)
    if not m:
        return None
    street_type = m.group(1).rstrip('.')
    street_name = re.sub(r'[^\wА-ЯЁ ]', '', m.group(2)).strip()
    street_name = re.sub(r'\s+', ' ', street_name).strip()
    number = str(int(m.group(3)))
    town = ''
    if settlement:
        town = re.sub(r'^(гр\.?\s*|с\.?\s*)', '', settlement, flags=re.IGNORECASE).strip().upper()
    if not town:
        tm = re.match(r'(?:ГР\.?\s*|С\.?\s*)([А-ЯA-Z\-]+)', upper)
        if tm:
            town = tm.group(1).strip()
    return f'{town}|{street_type}|{street_name}|{number}'


def extract_institution(addr: str) -> str | None:
    upper = addr.upper()
    m = re.search(
        r'((?:УЧИЛИЩЕ|ОСН\.\s*УЧИЛИЩЕ|СОУ|СУИЧЕ|ОУ|НУ|ГИМНАЗИЯ|ДЕТСКА\s+ГРАДИНА|ДГ|'
        r'ЧИТАЛИЩЕ|КЛУБ|ЦЕНТЪР|КМЕТСТВО|БИБЛИОТЕКА|БОЛНИЦА|МБАЛ|ОБШИНА|СГРАДА)'
        r'\s*(?:№?\s*\d+\s*)?(?:["""\u201c\u201d\u201e]*\s*[А-ЯA-Z\s\.]+["""\u201c\u201d\u201e]*)?)',
        upper,
    )
    if m:
        inst = m.group(1).strip()
        inst = re.sub(r'["""\u201c\u201d\u201e]', '', inst).strip()
        inst = re.sub(r'\s+', ' ', inst).strip()
        return inst
    return None


def extract_town(addr_or_sname: str) -> str:
    upper = addr_or_sname.upper().strip()
    tm = re.match(r'(?:ГР\.?\s*|С\.?\s*)([А-ЯA-Z\-]+)', upper)
    return tm.group(1).strip() if tm else ''


def tokenize(s: str) -> set[str]:
    s = s.upper()
    s = re.sub(r'[^\wА-ЯЁ]', ' ', s)
    stop = {'ГР', 'С', 'УЛ', 'БУЛ', 'ПЛ', 'НА', 'И', 'В', 'ОТ', 'ЗА', 'ПО', 'СЕ', 'СА', 'ДА', 'НЕ', 'ПРИ'}
    return set(t for t in s.split() if len(t) > 1 and t not in stop)


def main() -> None:
    if not VL_PATH.exists():
        print(f"  Skipped: {VL_PATH} not found")
        return

    conn = sqlite3.connect(DB_PATH)

    # Add lat/lng columns if missing
    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(locations)").fetchall()}
    for col in ['lat', 'lng']:
        if col not in existing_cols:
            conn.execute(f'ALTER TABLE locations ADD COLUMN {col} REAL')
    conn.commit()

    with open(VL_PATH) as f:
        vl = json.load(f)

    # Build indexes for each matching strategy
    vl_by_norm: dict[str, tuple[float, float]] = {}
    vl_by_agg: dict[str, tuple[float, float]] = {}
    vl_by_street: dict[str, tuple[float, float]] = {}
    vl_by_inst: dict[str, tuple[float, float]] = {}
    vl_by_town: dict[str, list] = defaultdict(list)

    for v in vl:
        if not v.get('lat') or not v.get('name'):
            continue
        coords = (v['lat'], v['lng'])
        name = v['name']

        # Strategy 1: strip_norm
        vl_by_norm[strip_norm(name)] = coords

        # Strategy 2: aggressive_norm
        n = aggressive_norm(name)
        if n and len(n) > 5:
            vl_by_agg[n] = coords

        # Strategy 3: street key
        key = extract_street_key(name)
        if key:
            vl_by_street[key] = coords

        # Strategy 4: institution + town
        town = extract_town(name)
        inst = extract_institution(name)
        if inst and town:
            vl_by_inst[f'{town}|{inst}'] = coords

        # Strategy 5: token overlap (grouped by town)
        if town:
            vl_by_town[town].append(v)

    # Match locations
    locs = conn.execute('SELECT id, address, settlement_name FROM locations WHERE lat IS NULL').fetchall()

    stats = {'norm': 0, 'agg': 0, 'street': 0, 'inst': 0, 'token': 0, 'miss': 0}

    # Also index VL by raw name (lowercase) and by address/query field
    vl_by_name_lc: dict[str, tuple[float, float]] = {}
    vl_by_query_lc: dict[str, tuple[float, float]] = {}
    for v in vl:
        if not v.get('lat'):
            continue
        if v.get('name'):
            vl_by_name_lc[v['name'].strip().lower()] = (v['lat'], v['lng'])
        if v.get('address'):
            vl_by_query_lc[v['address'].strip().lower()] = (v['lat'], v['lng'])

    for lid, addr, sname in locs:
        if not addr:
            # No address — try settlement_name as VL key (abroad, ПСИК, village locations)
            if sname:
                key = sname.strip().lower()
                if key in vl_by_name_lc:
                    conn.execute('UPDATE locations SET lat=?, lng=? WHERE id=?', (*vl_by_name_lc[key], lid))
                    stats['norm'] += 1
                    continue
                if key in vl_by_query_lc:
                    conn.execute('UPDATE locations SET lat=?, lng=? WHERE id=?', (*vl_by_query_lc[key], lid))
                    stats['norm'] += 1
                    continue
            stats['miss'] += 1
            continue

        # 1: strip_norm
        n = strip_norm(addr)
        if n in vl_by_norm:
            conn.execute('UPDATE locations SET lat=?, lng=? WHERE id=?', (*vl_by_norm[n], lid))
            stats['norm'] += 1
            continue

        # 2: aggressive_norm
        n = aggressive_norm(addr)
        if n and len(n) > 5 and n in vl_by_agg:
            conn.execute('UPDATE locations SET lat=?, lng=? WHERE id=?', (*vl_by_agg[n], lid))
            stats['agg'] += 1
            continue

        # 3: street key
        key = extract_street_key(addr, sname)
        if key and key in vl_by_street:
            conn.execute('UPDATE locations SET lat=?, lng=? WHERE id=?', (*vl_by_street[key], lid))
            stats['street'] += 1
            continue

        # 4: institution + town
        town = extract_town(addr)
        if not town and sname:
            town = re.sub(r'^(гр\.?\s*|с\.?\s*)', '', sname, flags=re.IGNORECASE).strip().upper()
        inst = extract_institution(addr)
        if inst and town and f'{town}|{inst}' in vl_by_inst:
            conn.execute('UPDATE locations SET lat=?, lng=? WHERE id=?', (*vl_by_inst[f'{town}|{inst}'], lid))
            stats['inst'] += 1
            continue

        # 5: token overlap (60% threshold)
        if town and town in vl_by_town:
            db_tokens = tokenize(addr)
            if len(db_tokens) >= 3:
                best_score = 0
                best = None
                for v in vl_by_town[town]:
                    vl_tokens = tokenize(v['name'])
                    if not vl_tokens:
                        continue
                    score = len(db_tokens & vl_tokens) / max(len(db_tokens), len(vl_tokens))
                    if score > best_score:
                        best_score = score
                        best = v
                if best_score >= 0.6 and best:
                    conn.execute('UPDATE locations SET lat=?, lng=? WHERE id=?', (best['lat'], best['lng'], lid))
                    stats['token'] += 1
                    continue

        # 6: fallback — try raw address or settlement_name as VL key
        matched_fallback = False
        for candidate in [addr, sname]:
            if candidate:
                key = candidate.strip().lower()
                if key in vl_by_name_lc:
                    conn.execute('UPDATE locations SET lat=?, lng=? WHERE id=?', (*vl_by_name_lc[key], lid))
                    stats['token'] += 1
                    matched_fallback = True
                    break
                if key in vl_by_query_lc:
                    conn.execute('UPDATE locations SET lat=?, lng=? WHERE id=?', (*vl_by_query_lc[key], lid))
                    stats['token'] += 1
                    matched_fallback = True
                    break
        if not matched_fallback:
            stats['miss'] += 1

    conn.commit()

    total = conn.execute('SELECT COUNT(*) FROM locations').fetchone()[0]
    with_gps = conn.execute('SELECT COUNT(*) FROM locations WHERE lat IS NOT NULL').fetchone()[0]

    matched = sum(v for k, v in stats.items() if k != 'miss')
    print(f"  Matched {matched:,} locations from voting_locations.json")
    print(f"    norm={stats['norm']} agg={stats['agg']} street={stats['street']} "
          f"inst={stats['inst']} token={stats['token']}")
    print(f"  GPS coverage: {with_gps:,}/{total:,} ({100*with_gps/total:.0f}%)")
    if stats['miss']:
        print(f"  Missing: {stats['miss']} (run geocode_locations.py to fill via Nominatim)")

    conn.close()


if __name__ == "__main__":
    main()
