"""Property-based tests for sanity check validation rules.

# Feature: election-data-validator, Property 23: Received ballots range check
# Feature: election-data-validator, Property 24: Voters voted does not exceed received ballots
# Feature: election-data-validator, Property 25: Ballots in box does not exceed voters voted
# Feature: election-data-validator, Property 26: Party votes do not exceed voters voted
# Feature: election-data-validator, Property 27: Candidate preferences do not exceed party votes
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

section_code_st = st.from_regex(r"[0-9]{9}", fullmatch=True)
non_negative_int = st.integers(min_value=0, max_value=500)
positive_int = st.integers(min_value=1, max_value=10)
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
        rik_code=int(section_code[:2]),
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


def _insert_preference(conn, section_code="010100001", party_number=1,
                        candidate_number="1", form_number=24,
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
# Property 23: Received ballots range check
# **Validates: Requirements 7.1**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    received_ballots=st.integers(min_value=-100, max_value=2000),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_received_ballots_range_check(section, received_ballots):
    """R7.1: violation iff received_ballots <= 0 or received_ballots > 1500."""
    db_path, conn = _create_db()

    _insert_protocol(conn, section_code=section, received_ballots=received_ballots)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r7_1()

        expect_violation = received_ballots <= 0 or received_ballots > 1500

        if expect_violation:
            assert len(violations) == 1, (
                f"Expected R7.1 violation: received_ballots={received_ballots}, "
                f"got {len(violations)}"
            )
            assert violations[0].rule_id == "R7.1"
            assert violations[0].section_code == section
        else:
            assert len(violations) == 0, (
                f"Expected no R7.1 violation: received_ballots={received_ballots}, "
                f"got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 24: Voters voted does not exceed received ballots
# **Validates: Requirements 7.2**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    voters_voted=st.integers(min_value=0, max_value=500),
    received_ballots=st.integers(min_value=0, max_value=500),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_voters_voted_does_not_exceed_received_ballots(section, voters_voted, received_ballots):
    """R7.2: violation iff voters_voted > received_ballots."""
    db_path, conn = _create_db()

    _insert_protocol(conn, section_code=section,
                     voters_voted=voters_voted,
                     received_ballots=received_ballots)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r7_2()

        expect_violation = voters_voted > received_ballots

        if expect_violation:
            assert len(violations) == 1, (
                f"Expected R7.2 violation: voters_voted={voters_voted}, "
                f"received_ballots={received_ballots}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R7.2"
            assert violations[0].section_code == section
        else:
            assert len(violations) == 0, (
                f"Expected no R7.2 violation: voters_voted={voters_voted}, "
                f"received_ballots={received_ballots}, got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 25: Ballots in box does not exceed voters voted
# **Validates: Requirements 7.3**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    ballots_in_box=st.integers(min_value=0, max_value=500),
    voters_voted=st.integers(min_value=0, max_value=500),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_ballots_in_box_does_not_exceed_voters_voted(section, ballots_in_box, voters_voted):
    """R7.3: violation iff ballots_in_box > voters_voted."""
    db_path, conn = _create_db()

    _insert_protocol(conn, section_code=section,
                     ballots_in_box=ballots_in_box,
                     voters_voted=voters_voted)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r7_3()

        expect_violation = ballots_in_box > voters_voted

        if expect_violation:
            assert len(violations) == 1, (
                f"Expected R7.3 violation: ballots_in_box={ballots_in_box}, "
                f"voters_voted={voters_voted}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R7.3"
            assert violations[0].section_code == section
        else:
            assert len(violations) == 0, (
                f"Expected no R7.3 violation: ballots_in_box={ballots_in_box}, "
                f"voters_voted={voters_voted}, got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 26: Party votes do not exceed voters voted
# **Validates: Requirements 7.4**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    total_votes=st.integers(min_value=0, max_value=500),
    voters_voted=st.integers(min_value=0, max_value=500),
    party=party_number_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_party_votes_do_not_exceed_voters_voted(section, total_votes, voters_voted, party):
    """R7.4: violation iff total_votes > voters_voted."""
    db_path, conn = _create_db()

    _insert_protocol(conn, section_code=section, voters_voted=voters_voted)
    _insert_vote(conn, section_code=section, party_number=party,
                 total_votes=total_votes, paper_votes=total_votes, machine_votes=0)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r7_4()

        expect_violation = total_votes > voters_voted

        if expect_violation:
            assert len(violations) == 1, (
                f"Expected R7.4 violation: total_votes={total_votes}, "
                f"voters_voted={voters_voted}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R7.4"
            assert violations[0].section_code == section
        else:
            assert len(violations) == 0, (
                f"Expected no R7.4 violation: total_votes={total_votes}, "
                f"voters_voted={voters_voted}, got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 27: Candidate preferences do not exceed party votes
# **Validates: Requirements 7.5**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    pref_votes=st.integers(min_value=0, max_value=500),
    party_votes=st.integers(min_value=0, max_value=500),
    party=party_number_st,
    candidate=st.from_regex(r"[0-9]{1,3}", fullmatch=True),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_candidate_preferences_do_not_exceed_party_votes(
    section, pref_votes, party_votes, party, candidate
):
    """R7.5: violation iff pref total_votes > vote total_votes (and candidate != 'Без')."""
    db_path, conn = _create_db()

    _insert_protocol(conn, section_code=section, voters_voted=500)
    _insert_vote(conn, section_code=section, party_number=party,
                 total_votes=party_votes, paper_votes=party_votes, machine_votes=0)
    _insert_preference(conn, section_code=section, party_number=party,
                       candidate_number=candidate,
                       total_votes=pref_votes, paper_votes=pref_votes, machine_votes=0)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r7_5()

        expect_violation = pref_votes > party_votes

        if expect_violation:
            assert len(violations) == 1, (
                f"Expected R7.5 violation: pref_votes={pref_votes}, "
                f"party_votes={party_votes}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R7.5"
            assert violations[0].section_code == section
        else:
            assert len(violations) == 0, (
                f"Expected no R7.5 violation: pref_votes={pref_votes}, "
                f"party_votes={party_votes}, got {len(violations)}"
            )
    finally:
        engine.conn.close()
