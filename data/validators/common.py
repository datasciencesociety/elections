"""
Shared data loading and violation storage for protocol validators.

Each per-election validator calls load_validation_data() to get protocols,
votes, and preferences, then runs its own checks and calls save_violations().
"""

import sqlite3
from collections import defaultdict


def load_protocols(cur, election_id):
    """Load protocol data: section -> {received, actual, invalid, null, form_num}."""
    protos = {}
    for sc, received, actual, invalid, null_v, form_num in cur.execute("""
        SELECT section_code, received_ballots, actual_voters,
               invalid_votes, null_votes, form_num
        FROM protocols WHERE election_id = ?
    """, (election_id,)):
        protos[sc] = {
            'received': received or 0,
            'actual': actual or 0,
            'invalid': invalid or 0,
            'null': null_v or 0,
            'form_num': form_num,
        }
    return protos


def load_votes(cur, election_id):
    """Load votes: section -> [{party, total, paper, machine}, ...]."""
    votes_by_section = defaultdict(list)
    for sc, party, total, paper, machine in cur.execute("""
        SELECT section_code, party_number, total, paper, machine
        FROM votes WHERE election_id = ?
    """, (election_id,)):
        votes_by_section[sc].append({
            'party': party,
            'total': total or 0,
            'paper': paper or 0,
            'machine': machine or 0,
        })
    return votes_by_section


def load_preferences(cur, election_id):
    """Load preference sums: section -> party -> {total, paper, machine}.
    Returns (pref_sums dict, has_prefs bool)."""
    has_prefs = cur.execute(
        "SELECT COUNT(*) FROM preferences WHERE election_id = ? LIMIT 1",
        (election_id,)
    ).fetchone()[0] > 0

    pref_sums = defaultdict(lambda: defaultdict(lambda: {'total': 0, 'paper': 0, 'machine': 0}))
    if has_prefs:
        for sc, party, total, paper, machine in cur.execute("""
            SELECT section_code, party_number, SUM(total), SUM(paper), SUM(machine)
            FROM preferences WHERE election_id = ?
            GROUP BY section_code, party_number
        """, (election_id,)):
            pref_sums[sc][party] = {
                'total': total or 0,
                'paper': paper or 0,
                'machine': machine or 0,
            }

    return pref_sums, has_prefs


def save_violations(conn, cur, election_id, violations):
    """Insert violations and update violation counts in section_scores."""
    if violations:
        cur.executemany("""
            INSERT INTO protocol_violations
                (election_id, section_code, rule_id, description,
                 expected_value, actual_value, severity)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, violations)

    cur.execute("""
        UPDATE section_scores SET protocol_violation_count = (
            SELECT COUNT(*) FROM protocol_violations pv
            WHERE pv.election_id = section_scores.election_id
              AND pv.section_code = section_scores.section_code
        ) WHERE election_id = ?
    """, (election_id,))

    conn.commit()
    return len(violations)
