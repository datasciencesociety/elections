#!/usr/bin/env python3
"""
mi2023.py — Parser for October/November 2023 local elections.

Five elections:
  mi2023_council              — Общ.съветници 29.10.2023
  mi2023_mayor_r1             — Кмет 29.10.2023
  mi2023_kmetstvo_r1          — Кмет кметство 29.10.2023
  mi2023_neighbourhood_r1     — Кмет район 29.10.2023
  mi2023_neighbourhood_r2     — Кмет район 05.11.2023

Protocol format: local_new (same layout as ns2024 — added at p[10], actual at p[11])
Votes format:    new4 — stride 4: party;total;paper;machine
"""

import os
import sqlite3

from parsers.common import (
    RESULTS_DIR, create_temp_db, insert_election,
    find_file, read_lines, safe_int,
    parse_sections, parse_cik_parties, parse_local_parties,
    parse_local_candidates, parse_preferences,
)


ELECTIONS = [
    {"slug": "mi2023_council",          "name": "Общ.съветници 29.10.2023",  "type": "local_council",             "date": "2023-10-29", "round": 1, "rel_path": "mi2023_tur1/data_04"},
    {"slug": "mi2023_mayor_r1",         "name": "Кмет 29.10.2023",           "type": "local_mayor",               "date": "2023-10-29", "round": 1, "rel_path": "mi2023_tur1/data_02"},
    {"slug": "mi2023_kmetstvo_r1",      "name": "Кмет кметство 29.10.2023",  "type": "local_mayor_kmetstvo",      "date": "2023-10-29", "round": 1, "rel_path": "mi2023_tur1/data_01"},
    {"slug": "mi2023_neighbourhood_r1", "name": "Кмет район 29.10.2023",     "type": "local_mayor_neighbourhood", "date": "2023-10-29", "round": 1, "rel_path": "mi2023_tur1/data_03"},
    {"slug": "mi2023_mayor_r2",         "name": "Кмет 05.11.2023",           "type": "local_mayor",               "date": "2023-11-05", "round": 2, "rel_path": "mi2023_tur2/data_02"},
    {"slug": "mi2023_kmetstvo_r2",     "name": "Кмет кметство 05.11.2023",  "type": "local_mayor_kmetstvo",      "date": "2023-11-05", "round": 2, "rel_path": "mi2023_tur2/data_01"},
    {"slug": "mi2023_neighbourhood_r2", "name": "Кмет район 05.11.2023",     "type": "local_mayor_neighbourhood", "date": "2023-11-05", "round": 2, "rel_path": "mi2023_tur2/data_03"},
]


# Protocol and votes use identical format to europe2024 (local_new + new4).
# Duplicated here per the architecture: each parser owns its own parsing logic.

def _extract_machine_data(p: list[str]) -> tuple[str, int | None, int | None] | None:
    form = safe_int(p[0])
    if form not in (27, 31, 32, 41):
        return None
    section = p[1].strip()
    if not section:
        return None
    ncols = len(p)
    null_v      = safe_int(p[18]) if ncols > 18 else None
    total_voted = safe_int(p[16]) if ncols > 16 else None
    if null_v is not None or total_voted is not None:
        return (section, null_v, total_voted)
    return None


def parse_protocols(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Parse protocols in local_new format (same layout as ns2024):
      p[6]  = received, p[7] = registered, p[10] = added, p[11] = actual
      p[15] = invalid, p[16] = null_paper, p[19] = null_machine
    """
    count = 0
    rows = []
    machine_null = {}

    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 12:
            continue
        try:
            md = _extract_machine_data(p)
            if md is not None:
                sec, nv, tv = md
                if nv is not None:
                    machine_null[sec] = machine_null.get(sec, 0) + nv
        except (IndexError, ValueError):
            pass

        form = safe_int(p[0])
        if form in (27, 31, 32, 41):
            continue
        section = p[1].strip()
        if not section:
            continue

        received   = safe_int(p[6])
        registered = safe_int(p[7])
        added      = safe_int(p[10]) if len(p) > 10 else None
        actual     = safe_int(p[11]) if len(p) > 11 else None
        invalid    = safe_int(p[15]) if len(p) > 15 else None
        null_paper   = safe_int(p[16]) if len(p) > 16 else None
        null_machine = safe_int(p[19]) if len(p) > 19 else None
        null = (
            (null_paper or 0) + (null_machine or 0)
            if (null_paper is not None or null_machine is not None)
            else None
        )

        rows.append((election_id, section, form, received, registered, added, actual, invalid, null))
        count += 1

    cur.executemany(
        "INSERT INTO protocols (election_id, section_code, form_num, received_ballots, "
        "registered_voters, added_voters, actual_voters, invalid_votes, null_votes) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        rows,
    )
    if machine_null:
        cur.executemany(
            "UPDATE protocols SET null_votes = ? WHERE election_id = ? AND section_code = ? AND null_votes IS NULL",
            [(nv, election_id, sec) for sec, nv in machine_null.items()],
        )
    # Form 25/29 (machine-confirm) sections have no invalid field.
    # CIK counts invalid_votes = 0 for these — machines don't produce invalid ballots.
    cur.execute(
        "UPDATE protocols SET invalid_votes = 0 "
        "WHERE election_id = ? AND invalid_votes IS NULL",
        (election_id,),
    )
    return count


def parse_votes(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    count = 0
    rows = []
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 7:
            continue
        section = p[1].strip()
        i = 3
        while i + 3 < len(p):
            party   = safe_int(p[i])
            total   = safe_int(p[i + 1]) or 0
            paper   = safe_int(p[i + 2]) or 0
            machine = safe_int(p[i + 3]) or 0
            if party is not None:
                rows.append((election_id, section, party, total, paper, machine))
                count += 1
            i += 4
    cur.executemany(
        "INSERT INTO votes (election_id, section_code, party_number, total, paper, machine) VALUES (?,?,?,?,?,?)",
        rows,
    )
    return count


def _find_election_file(data_dir: str, keyword: str, date_str: str) -> str | None:
    """Find file matching keyword + election date. Date 2023-10-29 → 29.10.2023.
    Falls back to any file matching keyword if date-specific file not found."""
    y, m, d = date_str.split("-")
    date_suffix = f"{d}.{m}.{y}"
    return find_file(data_dir, f"{keyword}_{date_suffix}") or find_file(data_dir, keyword)


def process_election(e: dict, cur: sqlite3.Cursor) -> dict:
    data_dir = os.path.join(RESULTS_DIR, e["rel_path"])
    if not os.path.isdir(data_dir):
        return {"error": f"directory not found: {data_dir}"}
    election_id = insert_election(cur, e["slug"], e["name"], e["type"], e["date"], e["round"])
    date = e["date"]
    stats = {}
    f = _find_election_file(data_dir, "sections", date)
    if f: stats["sections"] = parse_sections(f, election_id, cur)
    f = _find_election_file(data_dir, "cik_parties", date)
    if f: stats["parties"] = parse_cik_parties(f, election_id, cur)
    f = _find_election_file(data_dir, "local_parties", date)
    if f: stats["local_parties"] = parse_local_parties(f, election_id, cur)
    f = _find_election_file(data_dir, "local_candidates", date)
    if f: stats["candidates"] = parse_local_candidates(f, election_id, cur)
    f = _find_election_file(data_dir, "protocols", date)
    if f: stats["protocols"] = parse_protocols(f, election_id, cur)
    f = _find_election_file(data_dir, "votes", date)
    if f: stats["votes"] = parse_votes(f, election_id, cur)
    f = _find_election_file(data_dir, "preferences", date)
    if f: stats["preferences"] = parse_preferences(f, election_id, cur)
    return stats


def parse(db_path: str | None = None) -> dict:
    conn, db_path = create_temp_db("mi2023", db_path)
    cur = conn.cursor()
    slugs = []
    for e in ELECTIONS:
        print(f"  → {e['slug']}: {e['name']}")
        stats = process_election(e, cur)
        if "error" in stats:
            print(f"    SKIP: {stats['error']}")
        else:
            for k, v in stats.items():
                print(f"    {k}: {v:,}")
            slugs.append(e["slug"])
    conn.commit()
    conn.close()
    return {"db_path": db_path, "elections": slugs}


if __name__ == "__main__":
    result = parse()
    print(f"\nTemp DB: {result['db_path']}")
    print(f"Elections: {result['elections']}")
