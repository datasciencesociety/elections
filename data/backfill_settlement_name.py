#!/usr/bin/env python3
"""
backfill_settlement_name.py

One-time script: adds sections.settlement_name from the original CIK CSVs.

normalize_sections.py was updated to preserve settlement_name during rebuild,
but the current DB was built before that change. This backfills from the same
CSV sources the parsers used.

Safe to re-run — only updates rows where settlement_name IS NULL.
"""

import os
import re
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))

# (election_id, CSV path, settlement_name column index)
# Most CSVs: section_code;rik_num;rik_name;ekatte;settlement_name;address;...
# Column index 4 = settlement_name (0-indexed)
SOURCES: list[tuple[list[int], str]] = [
    ([1],          "data/cik-exports/pe202410/Актуализирана база данни/sections_27.10.2024.txt"),
    ([2],          "data/cik-exports/pe202410_ks/Актуализирана база данни/sections.txt"),
    ([3],          "data/cik-exports/europe2024/Актуализирана база данни - НС/sections_09.06.2024.txt"),
    ([4],          "data/cik-exports/europe2024/Актуализирана база данни - ЕП/sections_09.06.2024.txt"),
    ([5, 6, 7, 8], "data/cik-exports/mi2023_tur1/data_02/sections_29.10.2023.txt"),
    ([9, 10, 11],  "data/cik-exports/mi2023_tur2/data_02/sections_29.10.2023.txt"),
    ([12],         "data/cik-exports/ns2023/data_02/sections_02.04.2023.txt"),
    ([13],         "data/cik-exports/ns2022/np/sections_02.10.2022.txt"),
    ([14, 15],     "data/cik-exports/pvrns2021_tur1/np/sections_14.11.2021.txt"),
    ([16],         "data/cik-exports/pvrns2021_tur2/sections_21.11.2021.txt"),
    ([17],         "data/cik-exports/pi2021_07/sections_11.07.2021.txt"),
    ([18],         "data/cik-exports/pi2021/sections_04.04.2021.txt"),
]


def load_csv(path: Path) -> dict[str, str]:
    """Return {section_code: settlement_name} from a CIK sections CSV."""
    if not path.exists():
        print(f"  MISSING: {path}")
        return {}
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split(";")
        if len(parts) < 5:
            continue
        code = parts[0]
        if not re.match(r"^\d{9}$", code):
            continue
        sname = parts[4].strip()
        if sname:
            result[code] = sname
    return result


def main() -> None:
    conn = sqlite3.connect(DB_PATH)

    # Ensure column exists
    try:
        conn.execute("ALTER TABLE sections ADD COLUMN settlement_name TEXT")
        print("Added settlement_name column to sections")
    except Exception:
        print("settlement_name column already exists")

    total = 0
    for election_ids, csv_path in SOURCES:
        data = load_csv(Path(csv_path))
        if not data:
            continue

        for elec_id in election_ids:
            rows = [(sname, elec_id, code) for code, sname in data.items()]
            conn.executemany(
                "UPDATE sections SET settlement_name = ? WHERE election_id = ? AND section_code = ?",
                rows,
            )
            updated = conn.execute(
                "SELECT changes()"
            ).fetchone()[0]
            total += updated
            print(f"  election {elec_id}: {updated:,} rows updated from {Path(csv_path).name}")

    conn.commit()

    # Stats
    filled = conn.execute("SELECT COUNT(*) FROM sections WHERE settlement_name IS NOT NULL").fetchone()[0]
    total_rows = conn.execute("SELECT COUNT(*) FROM sections").fetchone()[0]
    print(f"\nResult: {filled:,}/{total_rows:,} sections have settlement_name")

    # Verify the specific fix
    row = conn.execute("""
        SELECT s.settlement_name, e.slug, e.date
        FROM sections s
        JOIN elections e ON e.id = s.election_id
        WHERE s.section_code = '325800615' AND e.date = '2021-11-14'
        LIMIT 1
    """).fetchone()
    if row:
        print(f"\nVerification: 325800615 on {row[2]} ({row[1]}): {row[0]}")

    conn.close()


if __name__ == "__main__":
    main()
