"""Property-based tests for referential integrity validation rules.

# Feature: election-data-validator, Property 14: Protocol section exists
# Feature: election-data-validator, Property 15: RIK code consistency
# Feature: election-data-validator, Property 16: Vote party exists
# Feature: election-data-validator, Property 17: Preference candidate exists
# Feature: election-data-validator, Property 18: Valid form number domain
# Feature: election-data-validator, Property 19: Section completeness
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
rik_code_st = st.integers(min_value=1, max_value=99)
party_number_st = st.integers(min_value=1, max_value=99)
candidate_number_st = st.integers(min_value=1, max_value=50)
valid_form_st = st.sampled_from([24, 26, 28, 30])
# Form numbers outside the valid set for Property 18
invalid_form_st = st.integers(min_value=1, max_value=100).filter(lambda x: x not in (24, 26, 28, 30))


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


def _insert_section(conn, section_code="010100001", num_machines=0):
    """Insert a section row."""
    conn.execute(
        "INSERT INTO sections (section_code, admin_unit_id, admin_unit_name, "
        "ekatte, settlement_name, address, is_mobile, is_ship, num_machines) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (section_code, 1, "Test", "00000", "TestCity", "TestAddr", 0, 0, num_machines),
    )


def _insert_cik_party(conn, party_number=1):
    """Insert a CIK party row."""
    conn.execute(
        "INSERT INTO cik_parties (party_number, party_name) VALUES (?, ?)",
        (party_number, f"Party {party_number}"),
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
                        candidate_number="1", total_votes=5, paper_votes=5, machine_votes=0):
    """Insert a preference row."""
    conn.execute(
        "INSERT INTO preferences (form_number, section_code, party_number, "
        "candidate_number, total_votes, paper_votes, machine_votes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (24, section_code, party_number, candidate_number, total_votes, paper_votes, machine_votes),
    )


def _insert_local_candidate(conn, rik_code=1, party_number=1, candidate_number=1):
    """Insert a local candidate row."""
    conn.execute(
        "INSERT INTO local_candidates (rik_code, admin_unit_name, party_number, "
        "party_name, candidate_number, candidate_name) VALUES (?, ?, ?, ?, ?, ?)",
        (rik_code, "Test", party_number, f"Party {party_number}", candidate_number, f"Candidate {candidate_number}"),
    )


# ---------------------------------------------------------------------------
# Property 14: Protocol section exists
# **Validates: Requirements 5.1**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    section_exists=st.booleans(),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_protocol_section_exists(section, section_exists):
    """R5.1: violation iff protocol's section_code doesn't exist in sections table."""
    db_path, conn = _create_db()

    _insert_protocol(conn, section_code=section)

    if section_exists:
        _insert_section(conn, section_code=section)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r5_1()
        if not section_exists:
            assert len(violations) == 1, (
                f"Expected 1 violation for missing section {section}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R5.1"
            assert violations[0].section_code == section
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations for existing section {section}, got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 15: RIK code consistency
# **Validates: Requirements 5.2**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    rik_matches=st.booleans(),
    wrong_rik=rik_code_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_rik_code_consistency(section, rik_matches, wrong_rik):
    """R5.2: violation iff rik_code != first 2 digits of section_code."""
    db_path, conn = _create_db()

    correct_rik = int(section[:2])
    if rik_matches:
        rik_code = correct_rik
    else:
        # Ensure wrong_rik is actually different from correct_rik
        if wrong_rik == correct_rik:
            wrong_rik = (correct_rik % 99) + 1
        rik_code = wrong_rik

    _insert_protocol(conn, section_code=section, rik_code=rik_code)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r5_2()
        if rik_code != correct_rik:
            assert len(violations) == 1, (
                f"Expected 1 violation: rik_code={rik_code}, expected={correct_rik}, "
                f"got {len(violations)}"
            )
            assert violations[0].rule_id == "R5.2"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations: rik_code={rik_code}, expected={correct_rik}, "
                f"got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 16: Vote party exists
# **Validates: Requirements 5.3**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    party=party_number_st,
    party_exists=st.booleans(),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_vote_party_exists(section, party, party_exists):
    """R5.3: violation iff vote's party_number doesn't exist in cik_parties."""
    db_path, conn = _create_db()

    _insert_protocol(conn, section_code=section)
    _insert_vote(conn, section_code=section, party_number=party)

    if party_exists:
        _insert_cik_party(conn, party_number=party)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r5_3()
        if not party_exists:
            assert len(violations) == 1, (
                f"Expected 1 violation for missing party {party}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R5.3"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations for existing party {party}, got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 17: Preference candidate exists
# **Validates: Requirements 5.4**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    party=party_number_st,
    candidate=candidate_number_st,
    candidate_exists=st.booleans(),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_preference_candidate_exists(section, party, candidate, candidate_exists):
    """R5.4: violation iff preference (rik, party, candidate) doesn't exist in local_candidates
    (and candidate != 'Без')."""
    db_path, conn = _create_db()

    rik_code = int(section[:2])
    _insert_preference(
        conn, section_code=section, party_number=party,
        candidate_number=str(candidate),
    )

    if candidate_exists:
        _insert_local_candidate(
            conn, rik_code=rik_code, party_number=party,
            candidate_number=candidate,
        )

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r5_4()
        if not candidate_exists:
            assert len(violations) == 1, (
                f"Expected 1 violation for missing candidate "
                f"(rik={rik_code}, party={party}, candidate={candidate}), "
                f"got {len(violations)}"
            )
            assert violations[0].rule_id == "R5.4"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations for existing candidate "
                f"(rik={rik_code}, party={party}, candidate={candidate}), "
                f"got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 17 (supplement): "Без" preferences are never violations
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    party=party_number_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_preference_bez_never_violation(section, party):
    """R5.4: 'Без' candidate_number should never produce a violation."""
    db_path, conn = _create_db()

    _insert_preference(
        conn, section_code=section, party_number=party,
        candidate_number="Без",
    )

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r5_4()
        assert len(violations) == 0, (
            f"Expected 0 violations for 'Без' candidate, got {len(violations)}"
        )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 18: Valid form number domain
# **Validates: Requirements 5.5**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=st.integers(min_value=1, max_value=100),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_valid_form_number_domain(section, form):
    """R5.5: violation iff form_number not in {24, 26, 28, 30}."""
    db_path, conn = _create_db()

    _insert_protocol(conn, section_code=section, form_number=form)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r5_5()
        valid_forms = {24, 26, 28, 30}
        if form not in valid_forms:
            assert len(violations) == 1, (
                f"Expected 1 violation for form_number={form}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R5.5"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations for valid form_number={form}, got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 19: Section completeness
# **Validates: Requirements 5.6**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    protocol_exists=st.booleans(),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_section_completeness(section, protocol_exists):
    """R5.6: violation iff section exists but no corresponding protocol row."""
    db_path, conn = _create_db()

    _insert_section(conn, section_code=section)

    if protocol_exists:
        _insert_protocol(conn, section_code=section)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r5_6()
        if not protocol_exists:
            assert len(violations) == 1, (
                f"Expected 1 violation for section {section} without protocol, "
                f"got {len(violations)}"
            )
            assert violations[0].rule_id == "R5.6"
            assert violations[0].section_code == section
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations for section {section} with protocol, "
                f"got {len(violations)}"
            )
    finally:
        engine.conn.close()
