"""Property-based tests for ballot balance validation rules.

# Feature: election-data-validator, Property 3: Ballot balance detection — received equals components
# Feature: election-data-validator, Property 4: Ballot decomposition detection — box contents equal components (paper-only)
# Feature: election-data-validator, Property 5: Ballot decomposition detection — box contents equal components (machine forms, paper part)
# Feature: election-data-validator, Property 6: Voter count inequality detection
# Feature: election-data-validator, Property 7: Non-negative field detection
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
section_code_st = st.from_regex(r"[0-9]{9}", fullmatch=True)
paper_form_st = st.sampled_from([24, 28])
machine_form_st = st.sampled_from([26, 30])
any_form_st = st.sampled_from([24, 26, 28, 30])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_engine_with_protocol(section_code="010100001", form_number=24, **fields):
    """Create an in-memory SQLite DB, insert one protocol row, return a ValidationEngine."""
    tmpdir = tempfile.mkdtemp()
    db_path = os.path.join(tmpdir, "test.db")
    conn = sqlite3.connect(db_path)
    conn.executescript(SQLITE_SCHEMA)

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
    conn.commit()
    conn.close()

    return ValidationEngine(db_path)


# ---------------------------------------------------------------------------
# Property 3: Ballot balance detection — received equals components
# **Validates: Requirements 2.1**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=any_form_st,
    received=nonneg_int_st,
    unused=nonneg_int_st,
    spoiled=nonneg_int_st,
    ballots_in_box=nonneg_int_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_ballot_balance_received_equals_components(
    section, form, received, unused, spoiled, ballots_in_box
):
    """R2.1: violation iff received_ballots != unused + spoiled + ballots_in_box."""
    machine_fields = {}
    if form in (26, 30):
        machine_fields = dict(
            machine_ballots_in_box=10,
            machine_no_support=2,
            machine_valid_party_votes=8,
        )

    engine = _create_engine_with_protocol(
        section_code=section,
        form_number=form,
        received_ballots=received,
        unused_ballots=unused,
        spoiled_ballots=spoiled,
        ballots_in_box=ballots_in_box,
        **machine_fields,
    )
    try:
        violations = engine._rule_r2_1()
        expected_sum = unused + spoiled + ballots_in_box
        if received != expected_sum:
            assert len(violations) == 1, (
                f"Expected 1 violation: received={received}, sum={expected_sum}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R2.1"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations: received={received}, sum={expected_sum}, got {len(violations)}"
            )
    finally:
        engine.conn.close()



# ---------------------------------------------------------------------------
# Property 4: Ballot decomposition detection — paper-only
# **Validates: Requirements 2.2**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=paper_form_st,
    ballots_in_box=nonneg_int_st,
    invalid_votes=nonneg_int_st,
    valid_no_support=nonneg_int_st,
    total_valid_party_votes=nonneg_int_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_ballot_decomposition_paper_only(
    section, form, ballots_in_box, invalid_votes, valid_no_support, total_valid_party_votes
):
    """R2.2: paper-only violation iff ballots_in_box != invalid + no_support + party_votes."""
    engine = _create_engine_with_protocol(
        section_code=section,
        form_number=form,
        ballots_in_box=ballots_in_box,
        invalid_votes=invalid_votes,
        valid_no_support=valid_no_support,
        total_valid_party_votes=total_valid_party_votes,
    )
    try:
        violations = engine._rule_r2_2()
        expected_sum = invalid_votes + valid_no_support + total_valid_party_votes
        if ballots_in_box != expected_sum:
            assert len(violations) == 1, (
                f"Expected 1 violation: box={ballots_in_box}, sum={expected_sum}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R2.2"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations: box={ballots_in_box}, sum={expected_sum}, got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 5: Ballot decomposition detection — machine forms
# **Validates: Requirements 2.3**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=machine_form_st,
    ballots_in_box=nonneg_int_st,
    invalid_votes=nonneg_int_st,
    valid_no_support=nonneg_int_st,
    total_valid_party_votes=nonneg_int_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_ballot_decomposition_machine_forms(
    section, form, ballots_in_box, invalid_votes, valid_no_support, total_valid_party_votes
):
    """R2.3: machine form violation iff ballots_in_box != invalid + no_support + party_votes (paper part)."""
    engine = _create_engine_with_protocol(
        section_code=section,
        form_number=form,
        ballots_in_box=ballots_in_box,
        invalid_votes=invalid_votes,
        valid_no_support=valid_no_support,
        total_valid_party_votes=total_valid_party_votes,
        machine_ballots_in_box=10,
        machine_no_support=2,
        machine_valid_party_votes=8,
    )
    try:
        violations = engine._rule_r2_3()
        expected_sum = invalid_votes + valid_no_support + total_valid_party_votes
        if ballots_in_box != expected_sum:
            assert len(violations) == 1, (
                f"Expected 1 violation: box={ballots_in_box}, sum={expected_sum}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R2.3"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations: box={ballots_in_box}, sum={expected_sum}, got {len(violations)}"
            )
    finally:
        engine.conn.close()


# ---------------------------------------------------------------------------
# Property 6: Voter count inequality detection
# **Validates: Requirements 2.4**
# ---------------------------------------------------------------------------

@given(
    section=section_code_st,
    form=any_form_st,
    voters_voted=nonneg_int_st,
    voters_in_list=nonneg_int_st,
    voters_supplementary=nonneg_int_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_voter_count_inequality_detection(
    section, form, voters_voted, voters_in_list, voters_supplementary
):
    """R2.4: violation iff voters_voted > voters_in_list + voters_supplementary."""
    machine_fields = {}
    if form in (26, 30):
        machine_fields = dict(
            machine_ballots_in_box=10,
            machine_no_support=2,
            machine_valid_party_votes=8,
        )

    engine = _create_engine_with_protocol(
        section_code=section,
        form_number=form,
        voters_voted=voters_voted,
        voters_in_list=voters_in_list,
        voters_supplementary=voters_supplementary,
        **machine_fields,
    )
    try:
        violations = engine._rule_r2_4()
        max_allowed = voters_in_list + voters_supplementary
        if voters_voted > max_allowed:
            assert len(violations) == 1, (
                f"Expected 1 violation: voted={voters_voted}, max={max_allowed}, got {len(violations)}"
            )
            assert violations[0].rule_id == "R2.4"
        else:
            assert len(violations) == 0, (
                f"Expected 0 violations: voted={voters_voted}, max={max_allowed}, got {len(violations)}"
            )
    finally:
        engine.conn.close()



# ---------------------------------------------------------------------------
# Property 7: Non-negative field detection
# **Validates: Requirements 2.5**
# ---------------------------------------------------------------------------

# All numeric protocol fields that R2.5 checks
_NUMERIC_FIELDS = [
    "received_ballots", "voters_in_list", "voters_supplementary",
    "voters_voted", "unused_ballots", "spoiled_ballots",
    "ballots_in_box", "invalid_votes", "valid_no_support",
    "total_valid_party_votes",
]

_MACHINE_NUMERIC_FIELDS = [
    "machine_ballots_in_box", "machine_no_support", "machine_valid_party_votes",
]


@given(
    section=section_code_st,
    field_index=st.integers(min_value=0, max_value=len(_NUMERIC_FIELDS) - 1),
    negative_value=st.integers(min_value=-100_000, max_value=-1),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_non_negative_field_detection(section, field_index, negative_value):
    """R2.5: violation iff any numeric field < 0.

    We pick one field at random, set it negative, and verify exactly one
    violation is reported for that field. All other fields stay non-negative.
    """
    field_name = _NUMERIC_FIELDS[field_index]

    engine = _create_engine_with_protocol(
        section_code=section,
        form_number=24,
        **{field_name: negative_value},
    )
    try:
        violations = engine._rule_r2_5()
        assert len(violations) >= 1, (
            f"Expected at least 1 violation for negative {field_name}={negative_value}, got 0"
        )
        matched = [v for v in violations if field_name in v.description]
        assert len(matched) == 1, (
            f"Expected exactly 1 violation mentioning {field_name}, got {len(matched)}"
        )
        assert matched[0].rule_id == "R2.5"
        assert matched[0].actual_value == str(negative_value)
    finally:
        engine.conn.close()


@given(
    section=section_code_st,
    form=any_form_st,
    received_ballots=nonneg_int_st,
    voters_in_list=nonneg_int_st,
    voters_supplementary=nonneg_int_st,
    voters_voted=nonneg_int_st,
    unused_ballots=nonneg_int_st,
    spoiled_ballots=nonneg_int_st,
    ballots_in_box=nonneg_int_st,
    invalid_votes=nonneg_int_st,
    valid_no_support=nonneg_int_st,
    total_valid_party_votes=nonneg_int_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_non_negative_no_false_positives(
    section, form,
    received_ballots, voters_in_list, voters_supplementary, voters_voted,
    unused_ballots, spoiled_ballots, ballots_in_box,
    invalid_votes, valid_no_support, total_valid_party_votes,
):
    """R2.5: no violations when all numeric fields are non-negative."""
    machine_fields = {}
    if form in (26, 30):
        machine_fields = dict(
            machine_ballots_in_box=10,
            machine_no_support=2,
            machine_valid_party_votes=8,
        )

    engine = _create_engine_with_protocol(
        section_code=section,
        form_number=form,
        received_ballots=received_ballots,
        voters_in_list=voters_in_list,
        voters_supplementary=voters_supplementary,
        voters_voted=voters_voted,
        unused_ballots=unused_ballots,
        spoiled_ballots=spoiled_ballots,
        ballots_in_box=ballots_in_box,
        invalid_votes=invalid_votes,
        valid_no_support=valid_no_support,
        total_valid_party_votes=total_valid_party_votes,
        **machine_fields,
    )
    try:
        violations = engine._rule_r2_5()
        assert len(violations) == 0, (
            f"Expected 0 violations for all non-negative fields, got {len(violations)}: "
            f"{[(v.description, v.actual_value) for v in violations]}"
        )
    finally:
        engine.conn.close()
