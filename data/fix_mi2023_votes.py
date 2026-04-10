#!/usr/bin/env python3
"""
fix_mi2023_votes.py — one-shot repair for the mi2023 votes table.

Background: mi2023 polling stations can serve more than one kmetstvo or
neighbourhood. CIK's votes file therefore contains multiple rows per
(section_code, party_number) — one per protocol. The parser writes each row
to a temp table, then `migrate_schema.py` previously folded them with
`INSERT OR IGNORE`, which kept only the first occurrence per
(election, section, party) and silently dropped the rest.

After fixing the migrator (SUM instead of OR IGNORE), this script repairs
the live DB without a full rebuild: it re-reads each mi2023 votes file,
re-aggregates with SUM, and rewrites the votes rows for the seven mi2023
elections.

Idempotent and safe to re-run.
"""

import os
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DB_PATH = Path(os.environ.get("ELECTIONS_DB", REPO_ROOT / "elections.db"))
EXPORTS = REPO_ROOT / ".internal/cik-exports"

# Each mi2023 election → (votes filepath relative to EXPORTS)
# data dirs identified by line counts in the parser:
#   data_01 = kmetstvo, data_02 = mayor, data_03 = neighbourhood, data_04 = council (tur1)
#   data_01 = kmetstvo, data_02 = mayor, data_03 = neighbourhood       (tur2)
ELECTION_FILES = {
    "mi2023_kmetstvo_r1":      "mi2023_tur1/data_01/votes_29.10.2023.txt",
    "mi2023_mayor_r1":         "mi2023_tur1/data_02/votes_29.10.2023.txt",
    "mi2023_neighbourhood_r1": "mi2023_tur1/data_03/votes_29.10.2023.txt",
    "mi2023_council":          "mi2023_tur1/data_04/votes_29.10.2023.txt",
    "mi2023_kmetstvo_r2":      "mi2023_tur2/data_01/votes_29.10.2023.txt",
    "mi2023_mayor_r2":         "mi2023_tur2/data_02/votes_29.10.2023.txt",
    "mi2023_neighbourhood_r2": "mi2023_tur2/data_03/votes_29.10.2023.txt",
}


def aggregate_file(path: Path) -> dict[tuple[str, int], tuple[int, int, int]]:
    """Parse a CIK votes file and SUM (total, paper, machine) per (section, party_number)."""
    out: dict[tuple[str, int], tuple[int, int, int]] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split(";")
            if len(parts) < 7:
                continue
            section = parts[1].strip()
            i = 3
            while i + 3 < len(parts):
                try:
                    party = int(parts[i])
                    total = int(parts[i + 1] or 0)
                    paper = int(parts[i + 2] or 0)
                    machine = int(parts[i + 3] or 0)
                except ValueError:
                    i += 4
                    continue
                key = (section, party)
                if key in out:
                    t, p, m = out[key]
                    out[key] = (t + total, p + paper, m + machine)
                else:
                    out[key] = (total, paper, machine)
                i += 4
    return out


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"DB not found: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    for slug, rel in ELECTION_FILES.items():
        row = cur.execute("SELECT id FROM elections WHERE slug = ?", (slug,)).fetchone()
        if not row:
            print(f"SKIP {slug}: no such election in DB")
            continue
        election_id = row[0]

        path = EXPORTS / rel
        if not path.exists():
            print(f"SKIP {slug}: source file missing at {path}")
            continue

        agg = aggregate_file(path)
        if not agg:
            print(f"SKIP {slug}: empty aggregate from {path}")
            continue

        before_total = cur.execute(
            "SELECT COALESCE(SUM(total), 0) FROM votes WHERE election_id = ?",
            (election_id,),
        ).fetchone()[0]

        # Replace votes for this election with the correctly summed values.
        cur.execute("DELETE FROM votes WHERE election_id = ?", (election_id,))
        cur.executemany(
            "INSERT INTO votes (election_id, section_code, party_number, total, paper, machine) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                (election_id, section, party, total, paper, machine)
                for (section, party), (total, paper, machine) in agg.items()
            ],
        )

        after_total = cur.execute(
            "SELECT SUM(total) FROM votes WHERE election_id = ?",
            (election_id,),
        ).fetchone()[0]

        diff = after_total - before_total
        print(
            f"  {slug:30s} rows={len(agg):>6,}  total={after_total:>9,} "
            f"(was {before_total:>9,}, +{diff:,})"
        )

    conn.commit()
    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
