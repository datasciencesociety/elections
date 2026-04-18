"""Property test for protocol record CIK format.

Feature: ocr-protocol-parser, Property 10: Protocol record CIK format round-trip.

**Validates: Requirements 10.1, 10.2, 10.3, 10.4, 3.4**
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from models import ProtocolRecord
from output_writer import format_protocol_line


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

form_number_st = st.from_regex(r"\d{8}", fullmatch=True)
section_code_st = st.from_regex(r"\d{9}", fullmatch=True)
rik_code_st = st.from_regex(r"\d{1,2}", fullmatch=True)
optional_int_st = st.one_of(st.none(), st.integers(min_value=0, max_value=10000))

# Generate pipe-separated page numbers like |0110151|0110151|...
page_numbers_st = st.lists(
    st.from_regex(r"\d{5,10}", fullmatch=True),
    min_size=1,
    max_size=14,
).map(lambda nums: "|" + "|".join(nums))

# Form 26/30 protocol record (machine fields present)
form26_record_st = st.builds(
    ProtocolRecord,
    form_number=form_number_st,
    section_code=section_code_st,
    rik_code=rik_code_st,
    page_numbers=page_numbers_st,
    field5=st.just(""),
    field6=st.just(""),
    ballots_received=optional_int_st,
    voter_list_count=optional_int_st,
    additional_voters=optional_int_st,
    voted_count=optional_int_st,
    unused_ballots=optional_int_st,
    invalid_ballots=optional_int_st,
    paper_ballots=optional_int_st,
    invalid_votes=optional_int_st,
    no_support_votes_paper=optional_int_st,
    valid_votes_paper=optional_int_st,
    machine_ballots=optional_int_st,
    no_support_votes_machine=optional_int_st,
    valid_votes_machine=optional_int_st,
)

# Form 24/28 protocol record (machine fields are None)
form24_record_st = st.builds(
    ProtocolRecord,
    form_number=form_number_st,
    section_code=section_code_st,
    rik_code=rik_code_st,
    page_numbers=page_numbers_st,
    field5=st.just(""),
    field6=st.just(""),
    ballots_received=optional_int_st,
    voter_list_count=optional_int_st,
    additional_voters=optional_int_st,
    voted_count=optional_int_st,
    unused_ballots=optional_int_st,
    invalid_ballots=optional_int_st,
    paper_ballots=optional_int_st,
    invalid_votes=optional_int_st,
    no_support_votes_paper=optional_int_st,
    valid_votes_paper=optional_int_st,
    machine_ballots=st.none(),
    no_support_votes_machine=st.none(),
    valid_votes_machine=st.none(),
)


@settings(max_examples=100)
@given(record=form26_record_st)
def test_protocol_format_field_count_form26(record: ProtocolRecord) -> None:
    """Property 10: Form 26/30 protocol line has exactly 19 semicolon-separated fields."""
    line = format_protocol_line(record)
    fields = line.split(";")
    assert len(fields) == 19, f"Expected 19 fields, got {len(fields)}: {line}"


@settings(max_examples=100)
@given(record=form24_record_st)
def test_protocol_format_field_count_form24(record: ProtocolRecord) -> None:
    """Property 10: Form 24/28 protocol line has exactly 19 fields with trailing empties."""
    line = format_protocol_line(record)
    fields = line.split(";")
    assert len(fields) == 19, f"Expected 19 fields, got {len(fields)}: {line}"
    # Fields 17, 18, 19 (0-indexed: 16, 17, 18) should be empty for form 24/28
    assert fields[16] == "", f"Field 17 should be empty, got '{fields[16]}'"
    assert fields[17] == "", f"Field 18 should be empty, got '{fields[17]}'"
    assert fields[18] == "", f"Field 19 should be empty, got '{fields[18]}'"


@settings(max_examples=100)
@given(record=st.one_of(form24_record_st, form26_record_st))
def test_protocol_format_empty_fields_5_6(record: ProtocolRecord) -> None:
    """Property 10: Fields 5 and 6 are always empty (two consecutive semicolons)."""
    line = format_protocol_line(record)
    fields = line.split(";")
    # Fields 5 and 6 are at index 4 and 5 (0-based)
    assert fields[4] == "", f"Field 5 should be empty, got '{fields[4]}'"
    assert fields[5] == "", f"Field 6 should be empty, got '{fields[5]}'"


@settings(max_examples=100)
@given(record=st.one_of(form24_record_st, form26_record_st))
def test_protocol_format_page_numbers_pipe_separated(record: ProtocolRecord) -> None:
    """Property 10: Page numbers field is pipe-separated and starts with |."""
    line = format_protocol_line(record)
    fields = line.split(";")
    page_field = fields[3]
    assert page_field.startswith("|"), (
        f"Page numbers should start with |, got '{page_field}'"
    )
    # Each segment after the leading | should be a digit string
    segments = page_field.split("|")
    # First segment is empty (before the leading |)
    assert segments[0] == "", f"Expected empty first segment, got '{segments[0]}'"
    for seg in segments[1:]:
        assert seg.isdigit(), f"Page number segment should be digits, got '{seg}'"


@settings(max_examples=100)
@given(record=st.one_of(form24_record_st, form26_record_st))
def test_protocol_format_none_becomes_empty(record: ProtocolRecord) -> None:
    """Property 10: None values become empty strings between semicolons."""
    line = format_protocol_line(record)
    fields = line.split(";")
    # Check that numeric fields are either empty or valid integers
    for i in range(6, 19):
        val = fields[i]
        assert val == "" or val.lstrip("-").isdigit(), (
            f"Field {i+1} should be empty or integer, got '{val}'"
        )
