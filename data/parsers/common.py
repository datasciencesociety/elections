#!/usr/bin/env python3
"""
common.py — Shared utilities for per-election parsers.

Contains:
  - DB schema (identical across all temp DBs and the final elections.db)
  - File I/O helpers: safe_int, read_lines, find_file
  - Binary decoding: decode_cik_dos (for 1991-2001 elections)
  - Temp DB creation: create_temp_db
  - Election insertion: insert_election
  - Format-stable parsers: sections, parties, candidates, preferences
    (these formats have NOT diverged across election years)

Each per-election parser imports from here and adds its own protocol/vote
parsing with explicit column mappings documented from the CIK readme.
"""

import os
import sqlite3
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# data/ directory (one level up from parsers/)
DATA_DIR = str(Path(__file__).resolve().parent.parent)

# Repo root (two levels up from parsers/)
PROJECT_DIR = str(Path(__file__).resolve().parent.parent.parent)

# Raw CIK data exports (extracted zips)
RESULTS_DIR = os.path.join(DATA_DIR, "cik-exports")

# Temp directory for per-parser SQLite files
TEMP_DIR = os.path.join(tempfile.gettempdir(), "elections_build")


# ---------------------------------------------------------------------------
# DB Schema — identical in every temp DB and the final elections.db
# ---------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS elections (
    id      INTEGER PRIMARY KEY,
    slug    TEXT UNIQUE NOT NULL,
    name    TEXT NOT NULL,
    type    TEXT NOT NULL,
    date    TEXT NOT NULL,
    round   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sections (
    id              INTEGER PRIMARY KEY,
    election_id     INTEGER NOT NULL,
    section_code    TEXT NOT NULL,
    rik_code        TEXT,
    rik_name        TEXT,
    ekatte          TEXT,
    settlement_name TEXT,
    address         TEXT,
    is_mobile       INTEGER DEFAULT 0,
    is_ship         INTEGER DEFAULT 0,
    machine_count   INTEGER DEFAULT 0,
    FOREIGN KEY (election_id) REFERENCES elections(id)
);

CREATE TABLE IF NOT EXISTS parties (
    id          INTEGER PRIMARY KEY,
    election_id INTEGER NOT NULL,
    number      INTEGER NOT NULL,
    name        TEXT,
    rik_code    TEXT,
    FOREIGN KEY (election_id) REFERENCES elections(id)
);

CREATE TABLE IF NOT EXISTS candidates (
    id            INTEGER PRIMARY KEY,
    election_id   INTEGER NOT NULL,
    rik_code      TEXT,
    party_number  INTEGER,
    list_position TEXT,
    name          TEXT,
    FOREIGN KEY (election_id) REFERENCES elections(id)
);

CREATE TABLE IF NOT EXISTS protocols (
    id                   INTEGER PRIMARY KEY,
    election_id          INTEGER NOT NULL,
    section_code         TEXT NOT NULL,
    form_num             INTEGER,
    received_ballots     INTEGER,
    registered_voters    INTEGER,
    added_voters         INTEGER,
    actual_voters        INTEGER,
    invalid_votes        INTEGER,
    null_votes           INTEGER,
    FOREIGN KEY (election_id) REFERENCES elections(id)
);

CREATE TABLE IF NOT EXISTS votes (
    id           INTEGER PRIMARY KEY,
    election_id  INTEGER NOT NULL,
    section_code TEXT NOT NULL,
    party_number INTEGER NOT NULL,
    total        INTEGER DEFAULT 0,
    paper        INTEGER DEFAULT 0,
    machine      INTEGER DEFAULT 0,
    FOREIGN KEY (election_id) REFERENCES elections(id)
);

CREATE TABLE IF NOT EXISTS preferences (
    id               INTEGER PRIMARY KEY,
    election_id      INTEGER NOT NULL,
    section_code     TEXT NOT NULL,
    party_number     INTEGER NOT NULL,
    candidate_number TEXT,
    total            INTEGER DEFAULT 0,
    paper            INTEGER DEFAULT 0,
    machine          INTEGER DEFAULT 0,
    FOREIGN KEY (election_id) REFERENCES elections(id)
);

CREATE INDEX IF NOT EXISTS idx_sections_election   ON sections(election_id);
CREATE INDEX IF NOT EXISTS idx_sections_code       ON sections(section_code);
CREATE INDEX IF NOT EXISTS idx_sections_ekatte     ON sections(ekatte);
CREATE INDEX IF NOT EXISTS idx_parties_election    ON parties(election_id);
CREATE INDEX IF NOT EXISTS idx_candidates_election ON candidates(election_id);
CREATE INDEX IF NOT EXISTS idx_protocols_election  ON protocols(election_id);
CREATE INDEX IF NOT EXISTS idx_protocols_section   ON protocols(section_code);
CREATE INDEX IF NOT EXISTS idx_votes_election      ON votes(election_id);
CREATE INDEX IF NOT EXISTS idx_votes_section       ON votes(section_code);
CREATE INDEX IF NOT EXISTS idx_votes_party         ON votes(party_number);
CREATE INDEX IF NOT EXISTS idx_pref_election       ON preferences(election_id);
CREATE INDEX IF NOT EXISTS idx_pref_section        ON preferences(section_code);
"""


# ---------------------------------------------------------------------------
# Temp DB creation
# ---------------------------------------------------------------------------

def create_temp_db(name: str, db_path: str | None = None) -> tuple[sqlite3.Connection, str]:
    """
    Create a temp SQLite database with the elections schema.

    Args:
        name: identifier for the temp file (e.g. "pe202410")
        db_path: explicit path override; if None, uses TEMP_DIR/elections_{name}.db

    Returns:
        (connection, path) — caller is responsible for conn.commit() and conn.close()
    """
    if db_path is None:
        os.makedirs(TEMP_DIR, exist_ok=True)
        db_path = os.path.join(TEMP_DIR, f"elections_{name}.db")

    # Remove stale file from a previous run
    if os.path.exists(db_path):
        os.remove(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-64000")
    conn.executescript(SCHEMA)
    return conn, db_path


def insert_election(cur: sqlite3.Cursor, slug: str, name: str,
                    etype: str, date: str, round_: int = 1) -> int:
    """Insert an election row and return its id."""
    cur.execute(
        "INSERT INTO elections (slug, name, type, date, round) VALUES (?,?,?,?,?)",
        (slug, name, etype, date, round_),
    )
    return cur.lastrowid


# ---------------------------------------------------------------------------
# File I/O helpers
# ---------------------------------------------------------------------------

def find_file(directory: str, *keywords) -> str | None:
    """
    Find a .txt file in directory whose name contains any of the keywords.
    Keywords are tried in priority order — first keyword wins if multiple files match.
    """
    files = [f for f in sorted(os.listdir(directory)) if f.endswith(".txt")]
    for kw in keywords:
        for fname in files:
            if kw.lower() in fname.lower():
                return os.path.join(directory, fname)
    return None


def read_lines(filepath: str, encoding: str = "utf-8"):
    """Read non-empty stripped lines from a text file. Falls back to cp1251 on decode error."""
    try:
        with open(filepath, encoding=encoding, errors="strict") as f:
            lines = f.readlines()
    except UnicodeDecodeError:
        with open(filepath, encoding="cp1251") as f:
            lines = f.readlines()
    for line in lines:
        line = line.strip()
        if line:
            yield line


def safe_int(val) -> int | None:
    """Convert value to int, returning None for empty/invalid input."""
    if val is None:
        return None
    try:
        s = str(val).strip()
        return int(s) if s else None
    except (ValueError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# Binary decoding (for 1991-2001 elections from ZIP archives)
# ---------------------------------------------------------------------------

def decode_cik_dos(data: bytes) -> str:
    """Decode CIK binary encoding: cp866 with 0xB0-0xBF bytes shifted +0x30."""
    result = bytearray()
    for b in data:
        if 0xB0 <= b <= 0xBF:
            result.append(b + 0x30)
        else:
            result.append(b)
    return bytes(result).decode('cp866', errors='replace')


# ---------------------------------------------------------------------------
# Sections parsing — format-stable across election years
# ---------------------------------------------------------------------------

def parse_sections(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Standard sections file format (used by most elections 2015+).

    Two known layouts:
      New (ns2022+):  section;rik_id;rik_name;ekatte;settlement;address;mobile[;ship[;machines]]
      Old (pre-2022): section;rik_id;rik_name;ekatte;settlement;mobile[;ship[;machines]]

    Detection: if p[5] is a short integer flag (0/1), no address field is present.
    """
    count = 0
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 5:
            continue
        section_code = p[0].strip()
        rik_code     = p[1].strip() if len(p) > 1 else ""
        rik_name     = p[2].strip() if len(p) > 2 else ""
        ekatte       = p[3].strip() if len(p) > 3 else ""
        settlement   = p[4].strip() if len(p) > 4 else ""

        # Detect whether p[5] is the address (long string) or a flag (short int)
        has_address = len(p) > 5 and not (p[5].strip() in ("0", "1", ""))
        if has_address:
            address    = p[5].strip()
            flag_base  = 6
        else:
            address    = ""
            flag_base  = 5

        is_mobile = safe_int(p[flag_base]) or 0 if len(p) > flag_base else 0
        if len(p) == flag_base + 2:
            # mobile + machines (no ship flag)
            is_ship   = 0
            machines  = safe_int(p[flag_base + 1]) or 0
        elif len(p) >= flag_base + 3:
            is_ship   = safe_int(p[flag_base + 1]) or 0
            machines  = safe_int(p[flag_base + 2]) or 0
        else:
            is_ship   = 0
            machines  = 0

        cur.execute(
            "INSERT INTO sections (election_id, section_code, rik_code, rik_name, ekatte, "
            "settlement_name, address, is_mobile, is_ship, machine_count) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (election_id, section_code, rik_code, rik_name, ekatte, settlement,
             address, is_mobile, is_ship, machines),
        )
        count += 1
    return count


def parse_sections_ep2014(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Sections format for ep2014, pi2014, ep2009_eu, ep2007, pe2009:
      section;settlement;ekatte[;...]
    """
    count = 0
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 3:
            continue
        section_code = p[0].strip()
        settlement   = p[1].strip()
        ekatte       = p[2].strip()
        cur.execute(
            "INSERT INTO sections (election_id, section_code, ekatte, settlement_name) VALUES (?,?,?,?)",
            (election_id, section_code, ekatte, settlement),
        )
        count += 1
    return count


def parse_sections_pi2013(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Sections format for pi2013 and el2011:
      ;section;rik_name;municipality;settlement;ekatte
    (leading semicolon — p[0] is the sign/empty field)
    """
    count = 0
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 5:
            continue
        section_code = p[1].strip()
        if not section_code:
            continue
        rik_name   = p[2].strip()
        settlement = p[4].strip()
        ekatte     = p[5].strip() if len(p) > 5 else ""
        cur.execute(
            "INSERT INTO sections (election_id, section_code, rik_name, ekatte, settlement_name) "
            "VALUES (?,?,?,?,?)",
            (election_id, section_code, rik_name, ekatte, settlement),
        )
        count += 1
    return count


# ---------------------------------------------------------------------------
# Parties — format-stable across election years
# ---------------------------------------------------------------------------

def parse_cik_parties(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Parse CIK parties file. Two known formats:
      Standard:        number;name
      Leading-semicol: ;rik_code;number;name  (pi2013 style)

    Returns the number of parties inserted.
    """
    count = 0
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 2:
            continue
        number = safe_int(p[0])
        if number is None and len(p) >= 3:
            # Leading-semicolon format: p[0]='' or rik_code, p[1]=number, p[2]=name
            number = safe_int(p[1])
            name   = p[2].strip() if len(p) > 2 else ""
        else:
            name = p[1].strip()
        if number is None:
            continue
        cur.execute(
            "INSERT INTO parties (election_id, number, name) VALUES (?,?,?)",
            (election_id, number, name),
        )
        count += 1
    return count


def parse_local_parties(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Parse local_parties file (per-municipality party/coalition registrations).
    Format: rik_code;rik_name;party_number;party_name

    Only inserts entries whose ballot number does NOT already exist in the
    parties table for this election (i.e., local coalitions not in cik_parties).
    """
    # Collect existing ballot numbers for this election
    existing = set(
        row[0] for row in cur.execute(
            "SELECT number FROM parties WHERE election_id = ?", (election_id,)
        ).fetchall()
    )

    count = 0
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 4:
            continue
        rik_code = p[0].strip()
        number = safe_int(p[2])
        name = p[3].strip()
        if number is None or not name:
            continue
        if number in existing:
            continue
        cur.execute(
            "INSERT INTO parties (election_id, number, name, rik_code) VALUES (?,?,?,?)",
            (election_id, number, name, rik_code),
        )
        existing.add(number)
        count += 1
    return count


def parse_cik_parties_ordered(filepath: str, election_id: int, cur: sqlite3.Cursor) -> list[int]:
    """
    Parse parties and return the ordered list of party numbers (file order).
    Needed by positional vote formats (ep2014_v, pi2014_v) where vote columns
    correspond to parties in the order they appear in the parties file.
    """
    ordered = []
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 2:
            continue
        number = safe_int(p[0])
        if number is None and len(p) >= 3:
            number = safe_int(p[1])
            name   = p[2].strip() if len(p) > 2 else ""
        else:
            name = p[1].strip()
        if number is None:
            continue
        cur.execute(
            "INSERT INTO parties (election_id, number, name) VALUES (?,?,?)",
            (election_id, number, name),
        )
        ordered.append(number)
    return ordered


# ---------------------------------------------------------------------------
# Candidates — format-stable across election years
# ---------------------------------------------------------------------------

def parse_local_candidates(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Parse candidates file. Handles multiple format variants:
      standard (6+):   rik_code;rik_name;party_num;party_name;list_pos;name
      council-2011(4): rik_code;party_num;list_pos;name
      mayor-2011 (3):  rik_code;party_num;name
      kmetstvo-2011(5): rik_code;settle_code;settle_name;party_num;name
    """
    count = 0
    rows = []
    for line in read_lines(filepath):
        p = line.split(";")
        n = len(p)
        if n < 3:
            continue

        rik_code  = p[0].strip()
        party_num = None
        list_pos  = ""
        cand_name = ""

        if n == 3:
            # mayor-2011: rik_code;party_num;name
            party_num = safe_int(p[1])
            cand_name = p[2].strip()
        elif n == 4:
            # council-2011: rik_code;party_num;list_pos;name
            party_num = safe_int(p[1])
            list_pos  = p[2].strip()
            cand_name = p[3].strip()
        elif n == 5 and safe_int(p[1]) is not None:
            # kmetstvo-2011: rik_code;settle_code;settle_name;party_num;name
            party_num = safe_int(p[3])
            cand_name = p[4].strip()
        else:
            # standard 6+ field format: rik_code;rik_name;party_num;party_name;list_pos;name
            party_num = safe_int(p[2])
            list_pos  = p[4].strip() if n > 4 else ""
            cand_name = p[5].strip() if n > 5 else ""

        rows.append((election_id, rik_code, party_num, list_pos, cand_name))
        count += 1

    cur.executemany(
        "INSERT INTO candidates (election_id, rik_code, party_number, list_position, name) "
        "VALUES (?,?,?,?,?)",
        rows,
    )
    return count


# ---------------------------------------------------------------------------
# Preferences — standard format across all elections that have them
# ---------------------------------------------------------------------------

def parse_preferences(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Standard preferences format (used by all elections with preference voting):
      form;section;party;candidate;total;paper;machine
    """
    count = 0
    rows = []
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 7:
            continue
        section   = p[1].strip()
        party_num = safe_int(p[2])
        candidate = p[3].strip()
        total     = safe_int(p[4]) or 0
        paper     = safe_int(p[5]) or 0
        machine   = safe_int(p[6]) or 0
        if party_num is not None:
            rows.append((election_id, section, party_num, candidate, total, paper, machine))
            count += 1
    cur.executemany(
        "INSERT INTO preferences (election_id, section_code, party_number, candidate_number, "
        "total, paper, machine) VALUES (?,?,?,?,?,?,?)",
        rows,
    )
    return count
