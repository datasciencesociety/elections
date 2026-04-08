"""Property-based tests for vote-protocol cross-reference validation rules.

# Feature: election-data-validator, Property 8: Cross-reference — votes sum matches protocol total
# Feature: election-data-validator, Property 9: Cross-reference — paper votes sum matches protocol (machine forms)
# Feature: election-data-validator, Property 10: Cross-reference — machine votes sum matches protocol (machine forms)
# Feature: election-data-validator, Property 11: Vote/preference decomposition — total equals paper plus machine
# Feature: election-data-validator, Property 12: Paper-only sections have zero machine votes
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
paper_form_st = st.sampled_from([24, 28])
machine_form_st = st.sampled_from([26, 30])
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


# ---------------------------------------------------------------------------
# Property 8: Votes sum matches protocol total
# **Validates: Requirements 3.1**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=any_form_st,
    total_valid_party_votes=nonneg_int_st,
    vote_totals=st.lists(small_nonneg_st, min_size=1, max_size=5),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_votes_sum_matches_protocol_total(
    section, form, total_valid_party_votes, vote_totals
):
    """R3.1: violation iff sum(total_votes) != total_valid_party_votes."""
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
        total_valid_party_votes=total_valid_party_votes,
        **machine_fields,
    )

    for i, tv in enumerate(vote_totals, start=1):
        _insert_vote(
            conn, section_code=section, form_number=form,
            party_number=i, total_votes=tv, paper_votes=tv, machine_votes=0,
        )

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r3_1()
        vote_sum = sum(vote_totals)
        if vote_sum != total_valid_party_votes:
            assert len(violations) == 1, (
                f"Expected 1 violation: sum={vote_sum}, protocol={total_valid_party_votes}, "
                f"got {len(violations)}"
            )
            assert violations[0].rule_id == "R3.1"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations: sum={vote_sum}, protocol={total_valid_party_votes}, "
                f"got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 9: Paper votes sum matches protocol (machine forms)
# **Validates: Requirements 3.2**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=machine_form_st,
    total_valid_party_votes=nonneg_int_st,
    paper_votes_list=st.lists(small_nonneg_st, min_size=1, max_size=5),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_paper_votes_sum_matches_protocol_machine_forms(
    section, form, total_valid_party_votes, paper_votes_list
):
    """R3.2: For machine forms, violation iff sum(paper_votes) != total_valid_party_votes."""
    db_path, conn = _create_db()

    _insert_protocol(
        conn, section_code=section, form_number=form,
        total_valid_party_votes=total_valid_party_votes,
        machine_ballots_in_box=10,
        machine_no_support=2,
        machine_valid_party_votes=8,
    )

    for i, pv in enumerate(paper_votes_list, start=1):
        _insert_vote(
            conn, section_code=section, form_number=form,
            party_number=i, total_votes=pv + 5, paper_votes=pv, machine_votes=5,
        )

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r3_2()
        paper_sum = sum(paper_votes_list)
        if paper_sum != total_valid_party_votes:
            assert len(violations) == 1, (
                f"Expected 1 violation: paper_sum={paper_sum}, protocol={total_valid_party_votes}, "
                f"got {len(violations)}"
            )
            assert violations[0].rule_id == "R3.2"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations: paper_sum={paper_sum}, protocol={total_valid_party_votes}, "
                f"got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 10: Machine votes sum matches protocol (machine forms)
# **Validates: Requirements 3.3**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=machine_form_st,
    machine_valid_party_votes=nonneg_int_st,
    machine_votes_list=st.lists(small_nonneg_st, min_size=1, max_size=5),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_machine_votes_sum_matches_protocol_machine_forms(
    section, form, machine_valid_party_votes, machine_votes_list
):
    """R3.3: For machine forms, violation iff sum(machine_votes) != machine_valid_party_votes."""
    db_path, conn = _create_db()

    _insert_protocol(
        conn, section_code=section, form_number=form,
        total_valid_party_votes=75,
        machine_ballots_in_box=10,
        machine_no_support=2,
        machine_valid_party_votes=machine_valid_party_votes,
    )

    for i, mv in enumerate(machine_votes_list, start=1):
        _insert_vote(
            conn, section_code=section, form_number=form,
            party_number=i, total_votes=mv + 5, paper_votes=5, machine_votes=mv,
        )

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r3_3()
        machine_sum = sum(machine_votes_list)
        if machine_sum != machine_valid_party_votes:
            assert len(violations) == 1, (
                f"Expected 1 violation: machine_sum={machine_sum}, "
                f"protocol={machine_valid_party_votes}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R3.3"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations: machine_sum={machine_sum}, "
                f"protocol={machine_valid_party_votes}, got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 11: Vote decomposition — total equals paper plus machine
# **Validates: Requirements 3.4, 4.2**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=any_form_st,
    paper_votes=small_nonneg_st,
    machine_votes=small_nonneg_st,
    total_votes=small_nonneg_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_vote_decomposition_total_equals_paper_plus_machine(
    section, form, paper_votes, machine_votes, total_votes
):
    """R3.4: violation iff total_votes != paper_votes + machine_votes."""
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
        party_number=1, total_votes=total_votes,
        paper_votes=paper_votes, machine_votes=machine_votes,
    )

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r3_4()
        expected_sum = paper_votes + machine_votes
        if total_votes != expected_sum:
            assert len(violations) == 1, (
                f"Expected 1 violation: total={total_votes}, paper+machine={expected_sum}, "
                f"got {len(violations)}"
            )
            assert violations[0].rule_id == "R3.4"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations: total={total_votes}, paper+machine={expected_sum}, "
                f"got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 12: Paper-only sections have zero machine votes
# **Validates: Requirements 3.5, 4.3**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=paper_form_st,
    num_parties=st.integers(min_value=1, max_value=5),
    machine_votes_val=st.integers(min_value=0, max_value=1000),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_paper_only_sections_zero_machine_votes(
    section, form, num_parties, machine_votes_val
):
    """R3.5: For paper-only sections, violation iff any machine_votes != 0."""
    db_path, conn = _create_db()

    _insert_protocol(
        conn, section_code=section, form_number=form,
    )

    for i in range(1, num_parties + 1):
        _insert_vote(
            conn, section_code=section, form_number=form,
            party_number=i, total_votes=10 + machine_votes_val,
            paper_votes=10, machine_votes=machine_votes_val,
        )

    conn.commit()
    conn.close()

    engine = ValidationEngine(db_path)
    try:
        violations = engine._rule_r3_5()
        if machine_votes_val != 0:
            assert len(violations) == num_parties, (
                f"Expected {num_parties} violations for machine_votes={machine_votes_val}, "
                f"got {len(violations)}"
            )
            for v in violations:
                assert v.rule_id == "R3.5"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations for machine_votes=0, got {len(violations)}"
            )
    finally:
        engine.conn.close()
