"""Property-based tests for form type consistency validation rules.

# Feature: election-data-validator, Property 20: Form type matches machine count
# Feature: election-data-validator, Property 21: Abroad form type consistency
# Feature: election-data-validator, Property 22: Form number consistency protocol ↔ votes
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
valid_form_st = st.sampled_from([24, 26, 28, 30])
paper_form_st = st.sampled_from([24, 28])
machine_form_st = st.sampled_from([26, 30])
abroad_form_st = st.sampled_from([28, 30])
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


def _insert_section(conn, section_code="010100001", num_machines=0):
    """Insert a section row."""
    conn.execute(
        "INSERT INTO sections (section_code, admin_unit_id, admin_unit_name, "
        "ekatte, settlement_name, address, is_mobile, is_ship, num_machines) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (section_code, 1, "Test", "00000", "TestCity", "TestAddr", 0, 0, num_machines),
    )


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


# ---------------------------------------------------------------------------
# Property 20: Form type matches machine count
# **Validates: Requirements 6.1, 6.2**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    num_machines=st.integers(min_value=0, max_value=10),
    form=valid_form_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_form_type_matches_machine_count(section, num_machines, form):
    """R6.1/R6.2: violation iff (machines=0 and form not in 24/28) or
    (machines>0 and form not in 26/30)."""
    db_path, conn = _create_db()

    _insert_section(conn, section_code=section, num_machines=num_machines)
    _insert_protocol(conn, section_code=section, form_number=form)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations_r6_1 = engine._rule_r6_1()
        violations_r6_2 = engine._rule_r6_2()

        # R6.1: machines=0 → form must be paper-only (24/28)
        expect_r6_1 = num_machines == 0 and form not in (24, 28)
        # R6.2: machines>0 → form must be machine (26/30)
        expect_r6_2 = num_machines > 0 and form not in (26, 30)

        if expect_r6_1:
            assert len(violations_r6_1) == 1, (
                f"Expected R6.1 violation: machines={num_machines}, form={form}, "
                f"got {len(violations_r6_1)}"
            )
            assert violations_r6_1[0].rule_id == "R6.1"
            assert violations_r6_1[0].section_code == section
        else:
            assert len(violations_r6_1) == 0, (
                f"Expected no R6.1 violation: machines={num_machines}, form={form}, "
                f"got {len(violations_r6_1)}"
            )

        if expect_r6_2:
            assert len(violations_r6_2) == 1, (
                f"Expected R6.2 violation: machines={num_machines}, form={form}, "
                f"got {len(violations_r6_2)}"
            )
            assert violations_r6_2[0].rule_id == "R6.2"
            assert violations_r6_2[0].section_code == section
        else:
            assert len(violations_r6_2) == 0, (
                f"Expected no R6.2 violation: machines={num_machines}, form={form}, "
                f"got {len(violations_r6_2)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 21: Abroad form type consistency
# **Validates: Requirements 6.3**
# ---------------------------------------------------------------------------

@given(
    # Generate section codes where first 2 digits are either 32 (abroad) or not
    is_abroad=st.booleans(),
    abroad_suffix=st.from_regex(r"[0-9]{7}", fullmatch=True),
    domestic_prefix=st.integers(min_value=1, max_value=31),
    form=abroad_form_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_abroad_form_type_consistency(is_abroad, abroad_suffix, domestic_prefix, form):
    """R6.3: For form 28 or 30, violation iff first 2 digits of section_code != 32."""
    if is_abroad:
        section_code = f"32{abroad_suffix}"
    else:
        section_code = f"{domestic_prefix:02d}{abroad_suffix}"

    db_path, conn = _create_db()

    _insert_protocol(conn, section_code=section_code, form_number=form)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r6_3()

        expect_violation = not is_abroad  # violation when NOT abroad

        if expect_violation:
            assert len(violations) == 1, (
                f"Expected R6.3 violation: section={section_code}, form={form}, "
                f"got {len(violations)}"
            )
            assert violations[0].rule_id == "R6.3"
            assert violations[0].section_code == section_code
        else:
            assert len(violations) == 0, (
                f"Expected no R6.3 violation: section={section_code}, form={form}, "
                f"got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 22: Form number consistency between protocol and votes
# **Validates: Requirements 6.4**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    protocol_form=valid_form_st,
    vote_form=valid_form_st,
    party=party_number_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_form_number_consistency_protocol_votes(section, protocol_form, vote_form, party):
    """R6.4: violation iff form_number in protocol differs from form_number in votes."""
    db_path, conn = _create_db()

    _insert_protocol(conn, section_code=section, form_number=protocol_form)
    _insert_vote(conn, section_code=section, form_number=vote_form, party_number=party)

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r6_4()

        expect_violation = protocol_form != vote_form

        if expect_violation:
            assert len(violations) == 1, (
                f"Expected R6.4 violation: protocol_form={protocol_form}, "
                f"vote_form={vote_form}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R6.4"
            assert violations[0].section_code == section
        else:
            assert len(violations) == 0, (
                f"Expected no R6.4 violation: protocol_form={protocol_form}, "
                f"vote_form={vote_form}, got {len(violations)}"
            )
    finally:
        engine.conn.close()
