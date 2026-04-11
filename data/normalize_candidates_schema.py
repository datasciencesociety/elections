#!/usr/bin/env python3
"""
normalize_candidates_schema.py

Post-processing: enriches `candidates` with FK columns and builds lookup tables.

  riks    — geographic units (MIR districts + municipalities)
  persons — deduplicated candidate names

Adds to `candidates`:
  person_id  FK → persons  (NULL when name is absent)
  rik_id     FK → riks     (NULL for president / european — not geographic)

Notes on rik_code semantics:
  parliament  → MIR codes 1-31  (geographic)
  local_*     → municipality codes 101-2826  (geographic)
  european    → party/list number (NOT geographic, rik_id left NULL)
  president   → candidate ordinal (NOT geographic, rik_id left NULL)

Source of truth for rik names: `sections` table (cleaner than candidates).

Safe to re-run: drops/recreates riks + persons, then updates candidates columns.
"""

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))

PARLIAMENT_TYPES = {"parliament"}
LOCAL_TYPES = {
    "local_council", "local_mayor",
    "local_mayor_kmetstvo", "local_mayor_neighbourhood",
}
# Mayor-type elections need their candidate.rik_code rewritten so it lines up
# with sections.rik_code (which is the EKATTE for kmetstvo, the neighbourhood
# code for neighbourhood). The municipality-level mayor already matches.
SUB_RIK_LOCAL_TYPES = {"local_mayor_kmetstvo", "local_mayor_neighbourhood"}


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def create_lookup_tables(cur: sqlite3.Cursor) -> None:
    cur.executescript("""
        DROP TABLE IF EXISTS persons;

        CREATE TABLE persons (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );
    """)

    # Add FK columns to candidates if they don't exist yet
    existing = {row[1] for row in cur.execute("PRAGMA table_info(candidates)").fetchall()}
    if "person_id" not in existing:
        cur.execute("ALTER TABLE candidates ADD COLUMN person_id INTEGER REFERENCES persons(id)")
    if "rik_id" not in existing:
        cur.execute("ALTER TABLE candidates ADD COLUMN rik_id INTEGER REFERENCES riks(id)")

    # Reset FK columns so re-runs start clean
    cur.execute("UPDATE candidates SET person_id = NULL, rik_id = NULL")


# ---------------------------------------------------------------------------
# Riks
# ---------------------------------------------------------------------------

def build_riks(cur: sqlite3.Cursor) -> int:
    """
    Riks table comes from geography.sql (imported by build.py).
    Just return the count — no inserts needed.
    """
    return cur.execute("SELECT COUNT(*) FROM riks").fetchone()[0]


# ---------------------------------------------------------------------------
# Persons + FK columns on candidates
# ---------------------------------------------------------------------------

def build_persons(cur: sqlite3.Cursor) -> int:
    names = cur.execute(
        "SELECT DISTINCT name FROM candidates WHERE name IS NOT NULL AND name != ''"
    ).fetchall()
    cur.executemany("INSERT OR IGNORE INTO persons (name) VALUES (?)", names)
    return len(names)


def update_candidate_fks(cur: sqlite3.Cursor) -> None:
    person_map: dict[str, int] = {
        row[0]: row[1]
        for row in cur.execute("SELECT name, id FROM persons").fetchall()
    }
    # riks table has oik_prefix ("01", "02", ...) — map section rik_code to rik_id
    rik_map: dict[str, int] = {
        row[0]: row[1]
        for row in cur.execute("SELECT oik_prefix, id FROM riks").fetchall()
    }

    rows = cur.execute("""
        SELECT c.id, e.type, c.rik_code, c.name
        FROM   candidates c
        JOIN   elections  e ON e.id = c.election_id
    """).fetchall()

    updates = []
    for cid, etype, rik_code, name in rows:
        person_id = person_map.get(name) if name else None

        rik_id = None
        if rik_code and etype in PARLIAMENT_TYPES:
            rik_id = rik_map.get(rik_code.zfill(2))

        updates.append((person_id, rik_id, cid))

    cur.executemany(
        "UPDATE candidates SET person_id = ?, rik_id = ? WHERE id = ?",
        updates,
    )


# ---------------------------------------------------------------------------
# Sub-RIK normalisation for mayor-type elections
# ---------------------------------------------------------------------------

def normalize_sub_rik_codes(cur: sqlite3.Cursor) -> tuple[int, int]:
    """
    For kmetstvo / neighbourhood mayor elections, the parser stores candidates
    with rik_code = the 3-digit municipality OIK from CIK and list_position =
    the sub-RIK label (settlement name for kmetstvo, "01. Одесос"-style label
    for neighbourhood). Sections, however, are keyed by sections.rik_code which
    is the EKATTE / neighbourhood code, not the municipality.

    Rewrite candidates.rik_code so it points at the same sub-RIK code that
    sections use. The match is (election, sub-RIK label) constrained by the
    section_code's first four digits, which encode the same oblast+municipality
    that the candidate file uses (with a leading zero stripped).

    Without this step, server-side joins between sections and candidates can
    only succeed for municipality-level mayor (where rik_code already matches),
    leaving the kmetstvo and neighbourhood ballots showing party names.
    """
    elections = cur.execute(
        "SELECT id FROM elections WHERE type IN (?, ?)",
        tuple(SUB_RIK_LOCAL_TYPES),
    ).fetchall()
    if not elections:
        return (0, 0)

    rewritten = 0
    unmatched = 0
    skipped_already = 0
    for (election_id,) in elections:
        # Build (sub_rik_label, mun_prefix) → section.rik_code map for this
        # election from sections — uses section_code's first 4 chars as the
        # municipality fingerprint.
        section_map: dict[tuple[str, str], str] = {}
        valid_rik_codes: set[str] = set()
        for rik_code, rik_name, section_code in cur.execute(
            "SELECT rik_code, rik_name, section_code FROM sections WHERE election_id = ?",
            (election_id,),
        ):
            if not rik_name or not rik_code or not section_code or len(section_code) < 4:
                continue
            section_map.setdefault((rik_name, section_code[:4]), rik_code)
            valid_rik_codes.add(rik_code)

        cand_rows = cur.execute(
            "SELECT id, rik_code, list_position FROM candidates "
            "WHERE election_id = ? AND list_position IS NOT NULL AND list_position != ''",
            (election_id,),
        ).fetchall()

        updates: list[tuple[str, int]] = []
        for cid, cand_rik, sub_label in cand_rows:
            # Idempotency: if the candidate already points at a valid section
            # rik_code for this election, leave it alone.
            if cand_rik in valid_rik_codes:
                skipped_already += 1
                continue
            if cand_rik is None:
                unmatched += 1
                continue
            try:
                mun_prefix = f"{int(cand_rik):04d}"
            except (TypeError, ValueError):
                unmatched += 1
                continue
            new_code = section_map.get((sub_label, mun_prefix))
            if new_code is None:
                unmatched += 1
                continue
            updates.append((new_code, cid))

        if updates:
            cur.executemany(
                "UPDATE candidates SET rik_code = ? WHERE id = ?",
                updates,
            )
            rewritten += len(updates)

    if skipped_already:
        print(f"  (already normalised: {skipped_already})")
    return (rewritten, unmatched)


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def print_stats(cur: sqlite3.Cursor) -> None:
    total_cand    = cur.execute("SELECT COUNT(*) FROM candidates").fetchone()[0]
    total_persons = cur.execute("SELECT COUNT(*) FROM persons").fetchone()[0]
    total_riks    = cur.execute("SELECT COUNT(*) FROM riks").fetchone()[0]

    print("\n=== Table sizes ===")
    print(f"  candidates:              {total_cand:>8}")
    print(f"  persons (unique names):  {total_persons:>8}  ({total_cand/total_persons:.1f}x dedup)")
    print(f"  riks:                    {total_riks:>8}")

    print(f"  riks (МИР):              {total_riks:>8}")

    print("\n=== Cross-election name matches ===")
    dist = cur.execute("""
        SELECT election_count, COUNT(*) AS person_count
        FROM (
            SELECT p.id, COUNT(DISTINCT c.election_id) AS election_count
            FROM   persons p
            JOIN   candidates c ON c.person_id = p.id
            GROUP  BY p.id
        )
        GROUP  BY election_count
        ORDER  BY election_count
    """).fetchall()
    multi = sum(cnt for e, cnt in dist if e > 1)
    print(f"  Names in exactly 1 election: {next((c for e,c in dist if e==1), 0):>7}")
    print(f"  Names in 2+ elections:       {multi:>7}  (exact-match, may be different people)")
    print()
    for e_count, p_count in dist:
        print(f"  {e_count:>2} elections: {p_count:>7}  {'█' * min(e_count, 20)}")

    print("\n=== Top repeated names ===")
    top = cur.execute("""
        SELECT p.name, COUNT(DISTINCT c.election_id) AS elections
        FROM   persons p
        JOIN   candidates c ON c.person_id = p.id
        GROUP  BY p.id
        ORDER  BY elections DESC
        LIMIT  10
    """).fetchall()
    for name, elections in top:
        print(f"  {elections:>2}x  {name}")

    avg_name_len = cur.execute("SELECT AVG(LENGTH(name)) FROM persons").fetchone()[0] or 0
    saved = (total_cand - total_persons) * (avg_name_len - 4)
    print(f"\n=== Estimated name dedup saving ===")
    print(f"  Avg name length: {avg_name_len:.0f} chars  →  ~{saved/1024:.0f} KB")


# ---------------------------------------------------------------------------

def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()

    print("Creating lookup tables + adding FK columns to candidates…")
    create_lookup_tables(cur)

    print("Building riks…")
    n = build_riks(cur)
    print(f"  {n} entries")

    print("Building persons…")
    n_p = build_persons(cur)
    print(f"  {n_p} unique names")

    print("Updating candidates FKs…")
    update_candidate_fks(cur)

    print("Normalising sub-RIK codes for kmetstvo / neighbourhood candidates…")
    rewritten, unmatched = normalize_sub_rik_codes(cur)
    print(f"  rewritten: {rewritten}, unmatched: {unmatched}")

    conn.commit()
    print_stats(cur)
    conn.close()


if __name__ == "__main__":
    main()
