#!/usr/bin/env python3
"""
fix_orphan_ballots.py

Create synthetic parties + election_parties rows for ballot numbers that
have votes recorded but no entry in normalize_parties' output. These come
from CIK's raw vote files where a ballot appears in section results but
never makes it to the published `cik_parties` index — they're independents
or "ghost" entries CIK uses internally without naming.

Without this fix, the API joins (votes → election_parties → parties) drop
those rows silently, hiding 100s–1000s of votes per election from the
results page even though `validate_cik.py` (which sums votes directly) sees
the totals as correct.

Behavior:
  - Use the CIK reference name when present (e.g. "+ независим")
  - Fall back to "Независим (бюлетина N)" for ghosts and missing entries
  - One synthetic party per (election, ballot) pair so they don't merge
  - Color: neutral grey (#999999)
  - Idempotent — safe to re-run (orphans are detected by NOT EXISTS join)

Run after normalize_parties.py and before validate_cik.py / score_sections.py.
"""

import json
import os
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DB_PATH = Path(os.environ.get("ELECTIONS_DB", REPO_ROOT / "elections.db"))
REF_PATH = Path(__file__).parent / "cik_reference.json"

GREY = "#999999"


def load_reference_names() -> dict[tuple[str, int], str]:
    """Return {(slug, ballot): name} for every named CIK party."""
    if not REF_PATH.exists():
        return {}
    with open(REF_PATH) as f:
        ref = json.load(f)
    out: dict[tuple[str, int], str] = {}
    for slug, data in ref.items():
        if slug.startswith("_"):
            continue
        for ballot_str, party in data.get("parties", {}).items():
            try:
                ballot = int(ballot_str)
            except (TypeError, ValueError):
                continue
            name = (party.get("name") or "").strip()
            if name:
                out[(slug, ballot)] = name
    return out


def find_orphans(cur: sqlite3.Cursor) -> list[tuple[int, str, int, int]]:
    """Return [(election_id, slug, ballot_number, total_votes), ...]."""
    rows = cur.execute(
        """
        SELECT v.election_id, e.slug, v.party_number, SUM(v.total) AS total
        FROM votes v
        JOIN elections e ON e.id = v.election_id
        WHERE NOT EXISTS (
            SELECT 1 FROM election_parties ep
            WHERE ep.election_id = v.election_id
              AND ep.ballot_number = v.party_number
        )
        GROUP BY v.election_id, v.party_number
        ORDER BY v.election_id, v.party_number
        """
    ).fetchall()
    return [(int(r[0]), r[1], int(r[2]), int(r[3])) for r in rows]


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"DB not found: {DB_PATH}")

    ref_names = load_reference_names()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    orphans = find_orphans(cur)
    if not orphans:
        print("No orphan ballots — nothing to fix.")
        conn.close()
        return

    next_party_id = (cur.execute("SELECT COALESCE(MAX(id), 0) FROM parties").fetchone()[0]) + 1

    created_parties = 0
    created_links = 0
    skipped_empty = 0

    print(f"Found {len(orphans)} orphan ballot(s):")
    for election_id, slug, ballot, votes in orphans:
        ref_name = ref_names.get((slug, ballot))
        if ref_name is None:
            # CIK reference has no name (or no entry at all) — emit a placeholder
            # so the votes are still surfaced in the API.
            display_name = f"Независим (бюлетина {ballot})"
            source_label = "no cik name"
        elif not ref_name:
            # Explicit empty string in CIK reference — treat as ghost, skip.
            skipped_empty += 1
            print(f"  SKIP   {slug} ballot {ballot} ({votes:,} votes) — empty cik name")
            continue
        else:
            display_name = ref_name
            source_label = "from cik"

        cur.execute(
            "INSERT INTO parties (id, canonical_name, short_name, party_type, color) "
            "VALUES (?, ?, ?, 'independent', ?)",
            (next_party_id, display_name, display_name, GREY),
        )
        created_parties += 1

        cur.execute(
            "INSERT INTO election_parties (election_id, ballot_number, party_id, name_on_ballot) "
            "VALUES (?, ?, ?, ?)",
            (election_id, ballot, next_party_id, display_name),
        )
        created_links += 1

        print(
            f"  CREATE {slug:18s} ballot {ballot:>3} → party_id {next_party_id} "
            f"({votes:,} votes, {source_label}) — {display_name}"
        )
        next_party_id += 1

    conn.commit()
    conn.close()

    print(
        f"\nDone. {created_parties} parties + {created_links} election_parties created. "
        f"{skipped_empty} skipped (empty cik names)."
    )


if __name__ == "__main__":
    main()
