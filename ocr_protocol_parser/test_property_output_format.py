"""Property test for vote and preference record CIK format.

Feature: ocr-protocol-parser, Property 11: Vote and preference record CIK
format structure.

**Validates: Requirements 11.1, 11.2, 12.1, 12.2**
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from models import PreferenceRecord, VoteRecord
from output_writer import format_preference_line, format_vote_line


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

form_number_st = st.from_regex(r"\d{8}", fullmatch=True)
section_code_st = st.from_regex(r"\d{9}", fullmatch=True)
rik_code_st = st.from_regex(r"\d{1,2}", fullmatch=True)

# Party vote tuple: (party_num, total, paper, machine) where total = paper + machine
party_vote_st = st.tuples(
    st.integers(min_value=1, max_value=50),   # party_num
    st.integers(min_value=0, max_value=5000),  # paper
    st.integers(min_value=0, max_value=5000),  # machine
).map(lambda t: (t[0], t[1] + t[2], t[1], t[2]))  # (num, total, paper, machine)

vote_record_st = st.builds(
    VoteRecord,
    form_number=form_number_st,
    section_code=section_code_st,
    rik_code=rik_code_st,
    party_votes=st.lists(party_vote_st, min_size=1, max_size=28),
)

preference_record_st = st.builds(
    PreferenceRecord,
    form_number=form_number_st,
    section_code=section_code_st,
    party_number=st.integers(min_value=1, max_value=50),
    candidate_number=st.integers(min_value=101, max_value=122),
    total_votes=st.integers(min_value=0, max_value=5000),
    paper_votes=st.integers(min_value=0, max_value=5000),
    machine_votes=st.integers(min_value=0, max_value=5000),
)


@settings(max_examples=100)
@given(record=vote_record_st)
def test_vote_format_header_and_groups(record: VoteRecord) -> None:
    """Property 11: Vote line has 3 header fields + 4 fields per party."""
    line = format_vote_line(record)
    fields = line.split(";")

    # Total fields = 3 header + 4 * num_parties
    expected_count = 3 + 4 * len(record.party_votes)
    assert len(fields) == expected_count, (
        f"Expected {expected_count} fields, got {len(fields)}"
    )

    # Header fields
    assert fields[0] == record.form_number
    assert fields[1] == record.section_code
    assert fields[2] == record.rik_code

    # Each group of 4 fields after header
    for i, (party_num, total, paper, machine) in enumerate(record.party_votes):
        base = 3 + i * 4
        assert fields[base] == str(party_num), (
            f"Party {i}: expected num {party_num}, got {fields[base]}"
        )
        assert fields[base + 1] == str(total), (
            f"Party {i}: expected total {total}, got {fields[base + 1]}"
        )
        assert fields[base + 2] == str(paper), (
            f"Party {i}: expected paper {paper}, got {fields[base + 2]}"
        )
        assert fields[base + 3] == str(machine), (
            f"Party {i}: expected machine {machine}, got {fields[base + 3]}"
        )


@settings(max_examples=100)
@given(record=preference_record_st)
def test_preference_format_seven_fields(record: PreferenceRecord) -> None:
    """Property 11: Preference line has exactly 7 semicolon-separated fields."""
    line = format_preference_line(record)
    fields = line.split(";")

    assert len(fields) == 7, f"Expected 7 fields, got {len(fields)}: {line}"

    assert fields[0] == record.form_number
    assert fields[1] == record.section_code
    assert fields[2] == str(record.party_number)
    assert fields[3] == str(record.candidate_number)
    assert fields[4] == str(record.total_votes)
    assert fields[5] == str(record.paper_votes)
    assert fields[6] == str(record.machine_votes)


@settings(max_examples=100)
@given(record=vote_record_st)
def test_vote_format_all_fields_numeric(record: VoteRecord) -> None:
    """Property 11: All vote fields after header are valid integers."""
    line = format_vote_line(record)
    fields = line.split(";")

    # All fields from index 3 onward should be valid integers
    for i in range(3, len(fields)):
        assert fields[i].lstrip("-").isdigit(), (
            f"Field {i} should be numeric, got '{fields[i]}'"
        )
