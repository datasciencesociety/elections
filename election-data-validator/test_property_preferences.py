"""Property-based tests for preference cross-reference validation rules.

# Feature: election-data-validator, Property 13: Preference totals match vote totals
"""

import sqlite3
import tempfile
import os

from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from validator import ValidationEngine, SQLITE_SCHEMA


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

nonneg_int_st = st.integers(min_value=0, max_value=100_000)
small_nonneg_st = st.integers(min_value=0, max_value=10_000)
section_code_st = st.from_regex(r"[0-9]{9}", fullmatch=True)
any_form_st = st.sampled_from([24, 26, 28, 30])
party_number_st = st.integers(min_value=1, max_value=99)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_db():
    """Create a temp SQLite DB with schema, return (db_path, connection)."""
    tmpdir = tempfile.mkdtemp()
    db_path = os.path.join(tmpdir, "test.db")
    conn = sqlite3.connect(db_path)
    conn.executescript(SQLITE_SCHEMA)
    return db_path, conn


def _insert_protocol(conn, section_code="010100001", form_number=24, **fields):
    """Insert a protocol row with defaults."""
    defaults = dict(
        form_number=form_number,
        section_code=section_code,
        rik_code=1,
        page_numbers="",
        received_ballots=100,
        voters_in_list=200,
        voters_supplementary=10,
        voters_voted=90,
        unused_ballots=5,
        spoiled_ballots=5,
        ballots_in_box=90,
        invalid_votes=10,
        valid_no_support=5,
        total_valid_party_votes=75,
        machine_ballots_in_box=None,
        machine_no_support=None,
        machine_valid_party_votes=None,
    )
    defaults.update(fields)
    cols = ", ".join(defaults.keys())
    placeholders = ", ".join("?" for _ in defaults)
    conn.execute(
        f"INSERT INTO protocols ({cols}) VALUES ({placeholders})",
        list(defaults.values()),
    )


def _insert_vote(conn, section_code="010100001", form_number=24,
                 party_number=1, total_votes=10, paper_votes=10, machine_votes=0):
    """Insert a vote row."""
    conn.execute(
        "INSERT INTO votes (form_number, section_code, admin_unit_id, party_number, "
        "total_votes, paper_votes, machine_votes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (form_number, section_code, 1, party_number, total_votes, paper_votes, machine_votes),
    )


def _insert_preference(conn, section_code="010100001", form_number=24,
                       party_number=1, candidate_number="1",
                       total_votes=5, paper_votes=5, machine_votes=0):
    """Insert a preference row."""
    conn.execute(
        "INSERT INTO preferences (form_number, section_code, party_number, "
        "candidate_number, total_votes, paper_votes, machine_votes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (form_number, section_code, party_number, candidate_number,
         total_votes, paper_votes, machine_votes),
    )


# ---------------------------------------------------------------------------
# Property 13: Preference totals match vote totals
# **Validates: Requirements 4.1**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=any_form_st,
    party=party_number_st,
    vote_total=small_nonneg_st,
    pref_totals=st.lists(small_nonneg_st, min_size=1, max_size=6),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_preference_totals_match_vote_totals(
    section, form, party, vote_total, pref_totals
):
    """R4.1: violation iff sum(preference total_votes) != vote total_votes."""
    db_path, conn = _create_db()

    machine_fields = {}
    if form in (26, 30):
        machine_fields = dict(
            machine_ballots_in_box=10,
            machine_no_support=2,
            machine_valid_party_votes=8,
        )

    _insert_protocol(
        conn, section_code=section, form_number=form,
        **machine_fields,
    )

    _insert_vote(
        conn, section_code=section, form_number=form,
        party_number=party, total_votes=vote_total,
        paper_votes=vote_total, machine_votes=0,
    )

    # Insert preference records: first N-1 as numbered candidates, last as "Без"
    for i, pv in enumerate(pref_totals):
        if i < len(pref_totals) - 1:
            cand = str(i + 1)
        else:
            cand = "Без"
        _insert_preference(
            conn, section_code=section, form_number=form,
            party_number=party, candidate_number=cand,
            total_votes=pv, paper_votes=pv, machine_votes=0,
        )

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r4_1()
        pref_sum = sum(pref_totals)
        r41_violations = [v for v in violations if v.rule_id == "R4.1"]

        if pref_sum != vote_total:
            assert len(r41_violations) == 1, (
                f"Expected 1 violation: pref_sum={pref_sum}, vote_total={vote_total}, "
                f"got {len(r41_violations)}"
            )
            assert r41_violations[0].rule_id == "R4.1"
        else:
            assert len(r41_violations) == 0, (
                f"Expected 0 violations: pref_sum={pref_sum}, vote_total={vote_total}, "
                f"got {len(r41_violations)}"
            )
    finally:
        engine.conn.close()
