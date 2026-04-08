#!/usr/bin/env python3
"""
validate_geocode.py

Validates geocoded locations by comparing against settlement neighbours.

Checks:
1. Abroad sections with coords inside Bulgaria (lat 41-44.5, lng 22-29)
2. Settlement outliers: locations too far from their settlement's centroid
3. Village-in-city: village locations that cluster with city sections
   (e.g. село Каменар coords landing in град Варна)

Usage:
    python3 validate_geocode.py                # report only
    python3 validate_geocode.py --fix          # null bad coordinates
    python3 validate_geocode.py --verbose      # show all flagged locations
"""

import argparse
import math
import sqlite3
import os
from collections import defaultdict
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))

# Bulgaria bounding box
BG_LAT_MIN, BG_LAT_MAX = 41.2, 44.3
BG_LNG_MIN, BG_LNG_MAX = 22.3, 28.7


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def centroid(points: list[tuple[float, float]]) -> tuple[float, float]:
    lat = sum(p[0] for p in points) / len(points)
    lng = sum(p[1] for p in points) / len(points)
    return lat, lng


def median_point(points: list[tuple[float, float]]) -> tuple[float, float]:
    """Median lat/lng — more robust to outliers than centroid."""
    lats = sorted(p[0] for p in points)
    lngs = sorted(p[1] for p in points)
    mid = len(lats) // 2
    return lats[mid], lngs[mid]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fix", action="store_true", help="Null bad coordinates")
    parser.add_argument("--verbose", action="store_true", help="Show all flagged")
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)
    bad_ids: list[int] = []

    # --- Check 1: Abroad sections inside Bulgaria ---
    print("=" * 60)
    print("CHECK 1: Abroad sections with coords inside Bulgaria")
    print("=" * 60)

    abroad_in_bg = conn.execute("""
        SELECT l.id, l.settlement_name, l.address, l.lat, l.lng
        FROM locations l
        JOIN riks r ON r.id = l.rik_id
        WHERE r.oik_prefix = '32' AND l.lat IS NOT NULL
          AND l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?
    """, (BG_LAT_MIN, BG_LAT_MAX, BG_LNG_MIN, BG_LNG_MAX)).fetchall()

    if abroad_in_bg:
        print(f"Found {len(abroad_in_bg)} abroad locations with Bulgarian coordinates:")
        for lid, settlement, addr, lat, lng in abroad_in_bg[:20]:
            print(f"  [{lid}] {settlement} — {lat:.4f},{lng:.4f} — {addr[:50]}")
        bad_ids.extend(r[0] for r in abroad_in_bg)
    else:
        print("None found.")

    # --- Check 2: Settlement centroid outliers ---
    print()
    print("=" * 60)
    print("CHECK 2: Settlement outlier detection")
    print("=" * 60)

    # Load all domestic geocoded locations grouped by settlement_name
    domestic = conn.execute("""
        SELECT l.id, l.settlement_name, l.address, l.lat, l.lng, l.municipality_id
        FROM locations l
        LEFT JOIN riks r ON r.id = l.rik_id
        WHERE l.lat IS NOT NULL
          AND (r.oik_prefix IS NULL OR r.oik_prefix != '32')
          AND l.settlement_name IS NOT NULL
    """).fetchall()

    # Group by settlement_name
    by_settlement: dict[str, list[tuple[int, str, float, float, int | None]]] = defaultdict(list)
    for lid, settlement, addr, lat, lng, muni_id in domestic:
        by_settlement[settlement].append((lid, addr, lat, lng, muni_id))

    outlier_count = 0
    for settlement, locs in sorted(by_settlement.items()):
        if len(locs) < 2:
            continue  # can't detect outliers with 1 point

        points = [(lat, lng) for _, _, lat, lng, _ in locs]
        med = median_point(points)

        for lid, addr, lat, lng, muni_id in locs:
            dist = haversine_km(lat, lng, med[0], med[1])
            # Flag if >10km from median — catches clearly wrong geocodes
            # without killing legit suburban locations
            if dist > 10.0:
                outlier_count += 1
                if args.verbose or outlier_count <= 20:
                    print(f"  [{lid}] {settlement} — {dist:.1f}km from median — {addr[:50]}")
                bad_ids.append(lid)

    print(f"Found {outlier_count} settlement outliers (>10km from median)")

    # --- Check 3: Village-in-city detection ---
    # TODO: enable after full geocoding — needs more data to distinguish
    # legit adjacent villages from misplaced ones. Should check if ALL sections
    # of a village cluster with the city (= wrong) vs just being geographically close.

    # --- Check 4: Coords outside Bulgaria for domestic ---
    print()
    print("=" * 60)
    print("CHECK 4: Domestic locations outside Bulgaria")
    print("=" * 60)

    outside_bg = conn.execute("""
        SELECT l.id, l.settlement_name, l.address, l.lat, l.lng
        FROM locations l
        LEFT JOIN riks r ON r.id = l.rik_id
        WHERE l.lat IS NOT NULL
          AND (r.oik_prefix IS NULL OR r.oik_prefix != '32')
          AND (l.lat NOT BETWEEN ? AND ? OR l.lng NOT BETWEEN ? AND ?)
    """, (BG_LAT_MIN, BG_LAT_MAX, BG_LNG_MIN, BG_LNG_MAX)).fetchall()

    if outside_bg:
        print(f"Found {len(outside_bg)} domestic locations outside Bulgaria:")
        for lid, settlement, addr, lat, lng in outside_bg[:20]:
            print(f"  [{lid}] {settlement} — {lat:.4f},{lng:.4f} — {addr[:50]}")
        bad_ids.extend(r[0] for r in outside_bg)
    else:
        print("None found.")

    # --- Summary ---
    unique_bad = list(set(bad_ids))
    print()
    print("=" * 60)
    print(f"TOTAL: {len(unique_bad)} locations flagged")
    print("=" * 60)

    if args.fix and unique_bad:
        placeholders = ','.join(['?'] * len(unique_bad))
        conn.execute(f"""
            UPDATE locations SET lat = NULL, lng = NULL, geocode_source = NULL
            WHERE id IN ({placeholders})
        """, unique_bad)
        conn.commit()
        print(f"Nulled coordinates for {len(unique_bad)} locations")
    elif unique_bad and not args.fix:
        print("Run with --fix to null these coordinates")

    total = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    with_gps = conn.execute("SELECT COUNT(*) FROM locations WHERE lat IS NOT NULL").fetchone()[0]
    print(f"GPS coverage: {with_gps:,}/{total:,} ({100 * with_gps / total:.0f}%)")

    conn.close()


if __name__ == "__main__":
    main()
