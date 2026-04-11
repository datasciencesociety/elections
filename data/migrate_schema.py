#!/usr/bin/env python3
"""
migrate_schema.py

Final step in the import pipeline. Optimizes the schema for query
performance and disk usage, then rebuilds a cross-election summary view.

  1. votes: drop `id`, switch to WITHOUT ROWID with composite PK
       (election_id, section_code, party_number)
       The PK is the clustered index — separate section/election indexes dropped.

  2. preferences: same treatment
       PK: (election_id, section_code, party_number, candidate_number)

  3. section_scores: WITHOUT ROWID, composite PK replaces UNIQUE + separate indexes
       PK: (election_id, section_code)

  4. Create section_risk_history view — aggregates risk scores per polling
     station across all elections, joined with section_locations for address data.

  5. VACUUM

Estimated saving: ~400-500 MB
Safe to re-run: each migration drops its _old table at the start if it exists.
"""

import os
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))


def step(msg: str) -> None:
    print(f"\n{'='*60}\n{msg}")


def run(conn: sqlite3.Connection, sql: str) -> None:
    t = time.time()
    conn.executescript(sql)
    print(f"  done in {time.time()-t:.1f}s")


def migrate_votes(conn: sqlite3.Connection) -> None:
    step("votes: drop id, WITHOUT ROWID + compound PK")
    run(conn, """
        DROP TABLE IF EXISTS votes_old;

        ALTER TABLE votes RENAME TO votes_old;

        CREATE TABLE votes (
            election_id  INTEGER NOT NULL,
            section_code TEXT    NOT NULL,
            party_number INTEGER NOT NULL,
            total        INTEGER DEFAULT 0,
            paper        INTEGER DEFAULT 0,
            machine      INTEGER DEFAULT 0,
            PRIMARY KEY (election_id, section_code, party_number),
            FOREIGN KEY (election_id) REFERENCES elections(id)
        ) WITHOUT ROWID;

        -- A polling station can host more than one local election protocol
        -- (e.g. one section serving 3 kmetstva produces 3 protocol rows for
        -- mi2023_kmetstvo_r1). The parser writes each row to the temp votes
        -- table; SUM here folds them so the WITHOUT ROWID PK accepts the
        -- merged total. National-level elections only ever have one row per
        -- (section, party) so SUM is a no-op for them.
        INSERT INTO votes (election_id, section_code, party_number, total, paper, machine)
        SELECT election_id, section_code, party_number,
               SUM(total), SUM(paper), SUM(machine)
        FROM votes_old
        GROUP BY election_id, section_code, party_number;

        DROP TABLE votes_old;
    """)
    run(conn, """
        CREATE INDEX idx_votes_section_election ON votes(section_code, election_id);
        CREATE INDEX idx_votes_election ON votes(election_id);
    """)


def migrate_preferences(conn: sqlite3.Connection) -> None:
    step("preferences: drop id, WITHOUT ROWID + compound PK")
    run(conn, """
        DROP TABLE IF EXISTS preferences_old;

        ALTER TABLE preferences RENAME TO preferences_old;

        CREATE TABLE preferences (
            election_id      INTEGER NOT NULL,
            section_code     TEXT    NOT NULL,
            party_number     INTEGER NOT NULL,
            candidate_number TEXT    NOT NULL,
            total            INTEGER DEFAULT 0,
            paper            INTEGER DEFAULT 0,
            machine          INTEGER DEFAULT 0,
            PRIMARY KEY (election_id, section_code, party_number, candidate_number),
            FOREIGN KEY (election_id) REFERENCES elections(id)
        ) WITHOUT ROWID;

        INSERT OR IGNORE INTO preferences
        SELECT election_id, section_code, party_number, candidate_number,
               total, paper, machine
        FROM preferences_old;

        DROP TABLE preferences_old;
    """)
    run(conn, """
        CREATE INDEX idx_pref_section_election ON preferences(section_code, election_id);
    """)


def migrate_section_scores(conn: sqlite3.Connection) -> None:
    step("section_scores: WITHOUT ROWID + composite PK, drop redundant indexes")
    run(conn, """
        DROP TABLE IF EXISTS section_scores_old;

        ALTER TABLE section_scores RENAME TO section_scores_old;

        CREATE TABLE section_scores (
            election_id             INTEGER NOT NULL,
            section_code            TEXT    NOT NULL,
            arithmetic_error        INTEGER DEFAULT 0,
            vote_sum_mismatch       INTEGER DEFAULT 0,
            turnout_rate            REAL,
            turnout_zscore          REAL,
            turnout_zscore_norm     REAL,
            benford_chi2            REAL,
            benford_p               REAL,
            benford_score           REAL,
            ekatte_turnout_zscore       REAL,
            ekatte_turnout_zscore_norm  REAL,
            peer_vote_deviation         REAL,
            peer_vote_deviation_norm    REAL,
            risk_score              REAL,
            PRIMARY KEY (election_id, section_code),
            FOREIGN KEY (election_id) REFERENCES elections(id)
        ) WITHOUT ROWID;

        INSERT OR IGNORE INTO section_scores
        SELECT election_id, section_code,
               arithmetic_error, vote_sum_mismatch,
               turnout_rate, turnout_zscore, turnout_zscore_norm,
               benford_chi2, benford_p, benford_score,
               ekatte_turnout_zscore, ekatte_turnout_zscore_norm,
               peer_vote_deviation, peer_vote_deviation_norm,
               risk_score
        FROM section_scores_old;

        DROP TABLE section_scores_old;

        CREATE INDEX idx_scores_risk ON section_scores(risk_score DESC);
        CREATE INDEX idx_section_scores_election ON section_scores(election_id);
    """)


def create_view(conn: sqlite3.Connection) -> None:
    step("section_risk_history view — risk score aggregates per polling station across all elections")
    run(conn, """
        DROP VIEW IF EXISTS section_risk_history;

        CREATE VIEW section_risk_history AS
        SELECT
            sc.section_code,
            sl.settlement_name,
            sl.address,
            sl.ekatte,
            COUNT(*)                                    AS elections_scored,
            ROUND(AVG(sc.risk_score), 4)                AS avg_risk_score,
            ROUND(MAX(sc.risk_score), 4)                AS max_risk_score,
            SUM(sc.arithmetic_error)                    AS total_arithmetic_errors,
            SUM(sc.vote_sum_mismatch)                   AS total_vote_mismatches,
            ROUND(AVG(sc.ekatte_turnout_zscore_norm),4) AS avg_ekatte_turnout_anomaly,
            ROUND(AVG(sc.peer_vote_deviation_norm), 4)  AS avg_peer_vote_anomaly,
            ROUND(
                AVG(CASE WHEN sc.election_id <= 3 THEN sc.risk_score END) -
                AVG(CASE WHEN sc.election_id > 3  THEN sc.risk_score END),
                4
            )                                           AS risk_trend
        FROM section_scores sc
        LEFT JOIN sections s ON s.section_code = sc.section_code
        LEFT JOIN locations sl ON sl.id = s.location_id
        GROUP BY sc.section_code;
    """)


def ensure_indexes(conn: sqlite3.Connection) -> None:
    """Create all performance indexes. Safe to re-run — uses IF NOT EXISTS."""
    step("performance indexes")
    run(conn, """
        -- sections
        CREATE INDEX IF NOT EXISTS idx_sections_election ON sections(election_id);
        CREATE INDEX IF NOT EXISTS idx_sections_code ON sections(section_code);
        CREATE INDEX IF NOT EXISTS idx_sections_location ON sections(location_id);
        CREATE INDEX IF NOT EXISTS idx_sections_election_location ON sections(election_id, location_id);
        -- powers the section→rik_code lookup used by the mayor candidate join
        CREATE INDEX IF NOT EXISTS idx_sections_election_code ON sections(election_id, section_code);

        -- locations geography
        CREATE INDEX IF NOT EXISTS idx_loc_municipality_id ON locations(municipality_id);
        CREATE INDEX IF NOT EXISTS idx_loc_kmetstvo_id ON locations(kmetstvo_id);
        CREATE INDEX IF NOT EXISTS idx_loc_district_id ON locations(district_id);
        CREATE INDEX IF NOT EXISTS idx_loc_rik_id ON locations(rik_id);
        CREATE INDEX IF NOT EXISTS idx_loc_local_region_id ON locations(local_region_id);
        CREATE INDEX IF NOT EXISTS idx_locations_ekatte ON locations(ekatte);

        -- protocols
        CREATE INDEX IF NOT EXISTS idx_protocols_election ON protocols(election_id);
        CREATE INDEX IF NOT EXISTS idx_protocols_section ON protocols(section_code);
        CREATE INDEX IF NOT EXISTS idx_protocols_election_section ON protocols(election_id, section_code);

        -- votes
        CREATE INDEX IF NOT EXISTS idx_votes_section_election ON votes(section_code, election_id);
        CREATE INDEX IF NOT EXISTS idx_votes_election ON votes(election_id);

        -- preferences
        CREATE INDEX IF NOT EXISTS idx_pref_section_election ON preferences(section_code, election_id);

        -- election_parties
        CREATE INDEX IF NOT EXISTS idx_ep_election ON election_parties(election_id);
        CREATE INDEX IF NOT EXISTS idx_ep_party ON election_parties(party_id);
        CREATE INDEX IF NOT EXISTS idx_election_parties_ballot ON election_parties(election_id, ballot_number);

        -- candidates
        CREATE INDEX IF NOT EXISTS idx_candidates_election ON candidates(election_id);
        -- powers the mayor candidate join: votes → candidates by (election, ballot, sub-rik)
        CREATE INDEX IF NOT EXISTS idx_candidates_join ON candidates(election_id, party_number, rik_code);

        -- section_scores
        CREATE INDEX IF NOT EXISTS idx_scores_risk ON section_scores(risk_score DESC);
        CREATE INDEX IF NOT EXISTS idx_section_scores_election ON section_scores(election_id);
        CREATE INDEX IF NOT EXISTS idx_scores_section ON section_scores(section_code);
        CREATE INDEX IF NOT EXISTS idx_section_scores_code_election ON section_scores(section_code, election_id);
        CREATE INDEX IF NOT EXISTS idx_scores_election_risk ON section_scores(election_id, risk_score DESC);

        -- protocol_violations
        CREATE INDEX IF NOT EXISTS idx_violations_election ON protocol_violations(election_id);
        CREATE INDEX IF NOT EXISTS idx_violations_section ON protocol_violations(section_code);
        CREATE INDEX IF NOT EXISTS idx_violations_election_section ON protocol_violations(election_id, section_code);

        -- geography
        CREATE INDEX IF NOT EXISTS idx_kmetstva_ekatte ON kmetstva(ekatte);

        -- elections
        CREATE INDEX IF NOT EXISTS idx_elections_type_date ON elections(type, date DESC);
    """)


def vacuum(conn: sqlite3.Connection) -> None:
    step("VACUUM")
    t = time.time()
    conn.execute("VACUUM")
    print(f"  done in {time.time()-t:.1f}s")


def print_sizes() -> None:
    step("DB size after migration")
    size = os.path.getsize(DB_PATH)
    if size >= 1024 ** 3:
        print(f"  {size / 1024**3:.2f} GB  {DB_PATH.name}")
    else:
        print(f"  {size / 1024**2:.1f} MB  {DB_PATH.name}")


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    # Drop the view first — SQLite validates views on every table rename
    conn.executescript("DROP VIEW IF EXISTS section_risk_history;")

    migrate_votes(conn)
    migrate_preferences(conn)

    # section_scores: score_sections.py now creates the table WITHOUT ROWID
    # with the full schema (section_type, acf_*, protocol_violation_count,
    # benford_risk, peer_risk, acf_risk). The old migrate_section_scores()
    # downgrades it by dropping those columns — do not call it. Just refresh
    # the history view if the table exists.
    has_scores = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='section_scores'"
    ).fetchone()
    if has_scores:
        create_view(conn)

    ensure_indexes(conn)
    vacuum(conn)
    conn.close()
    print_sizes()


if __name__ == "__main__":
    main()
