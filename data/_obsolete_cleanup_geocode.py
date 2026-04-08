#!/usr/bin/env python3
"""
cleanup_geocode.py

Nulls out lat/lng for locations that are clearly geocoding failures:
  1. Same coordinates shared by locations in different settlements
     (the geocoder returned a regional fallback instead of the actual address)

Usage:
    python3 cleanup_geocode.py               # apply fixes
    python3 cleanup_geocode.py --dry-run     # show what would be nulled
"""

import argparse
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "elections.db"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)

    # Find coordinates shared by multiple distinct settlements
    bad_coords = conn.execute("""
        SELECT lat, lng, count(*) as loc_count, count(DISTINCT settlement_name) as settlements
        FROM locations
        WHERE lat IS NOT NULL
        GROUP BY lat, lng
        HAVING count(DISTINCT settlement_name) > 1
        ORDER BY settlements DESC
    """).fetchall()

    total_locations = 0
    for lat, lng, loc_count, settlements in bad_coords:
        examples = conn.execute("""
            SELECT DISTINCT settlement_name FROM locations
            WHERE lat = ? AND lng = ? LIMIT 5
        """, (lat, lng)).fetchall()
        names = ", ".join(r[0] for r in examples)
        print(f"  ({lat:.6f}, {lng:.6f}): {loc_count} locations, {settlements} settlements — {names}")
        total_locations += loc_count

    print(f"\nTotal: {len(bad_coords)} bad coordinate groups, {total_locations} locations to null")

    if args.dry_run:
        return

    cursor = conn.execute("""
        UPDATE locations SET lat = NULL, lng = NULL
        WHERE (lat, lng) IN (
            SELECT lat, lng FROM locations
            WHERE lat IS NOT NULL
            GROUP BY lat, lng
            HAVING count(DISTINCT settlement_name) > 1
        )
    """)
    conn.commit()

    print(f"Nulled {cursor.rowcount} locations")

    total = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    with_gps = conn.execute("SELECT COUNT(*) FROM locations WHERE lat IS NOT NULL").fetchone()[0]
    print(f"GPS coverage: {with_gps:,}/{total:,} ({100*with_gps/total:.0f}%)")

    conn.close()


if __name__ == "__main__":
    main()
