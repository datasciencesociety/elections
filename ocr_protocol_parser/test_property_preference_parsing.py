# Feature: ocr-protocol-parser, Property 7: Preference table parsing extracts all candidate entries
"""Property-based tests for preference table parsing.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 9.1**

Property 7: For any HTML preference table containing party blocks with candidate
numbers (101–122) and corresponding vote counts, the parser SHALL extract a list
of (party_number, candidate_number, vote_count) tuples for all candidates,
excluding "Без преференции" entries from individual candidate records.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from html_utils import HtmlDiv
from page_parsers import parse_preference_pages


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Party numbers: realistic range 1–99
party_number_st = st.integers(min_value=1, max_value=99)

# Vote counts: non-negative integers up to a realistic max
vote_count_st = st.integers(min_value=0, max_value=999_999)

# 22 vote counts for candidates 101–122
votes_22_st = st.lists(vote_count_st, min_size=22, max_size=22)

# "Без преференции" value (non-negative)
bez_pref_st = vote_count_st

# Control number for the page
control_number_st = st.from_regex(r"[1-9][0-9]{4,9}", fullmatch=True)


# ---------------------------------------------------------------------------
# Helpers — build synthetic div lists in Pattern A format
# ---------------------------------------------------------------------------

def _build_preference_table_pattern_a(
    party_num: int,
    votes: list[int],
    bez_pref: int,
) -> list[list[str]]:
    """Build a preference table in Pattern A format for one party block.

    Pattern A (14-cell data row):
      Row 0 (14 cells): [party_num "N.", party_name, vote_101, ..., vote_112]
      Row 1 (11 cells): ["113", "114", ..., "122", "Без преференции"]  (header)
      Row 2 (11 cells): [vote_113, ..., vote_122, bez_pref_value]       (data)
    """
    # Row 0: party number + name + votes for candidates 101-112
    row0 = [f"{party_num}. Партия {party_num}", f"Партия {party_num}"]
    row0.extend(str(v) for v in votes[:12])  # votes for 101-112

    # Row 1: header for candidates 113-122 + "Без преференции"
    row1 = [str(113 + i) for i in range(10)]
    row1.append("Без преференции")

    # Row 2: votes for candidates 113-122 + bez_pref value
    row2 = [str(v) for v in votes[12:22]]
    row2.append(str(bez_pref))

    return [row0, row1, row2]


def _build_page_divs(
    control_number: str,
    table_rows: list[list[str]],
) -> list[HtmlDiv]:
    """Build a minimal page div list with a control number and a Table div."""
    return [
        HtmlDiv(
            bbox=(100, 5, 200, 25),
            label="Text",
            content=control_number,
        ),
        HtmlDiv(
            bbox=(50, 100, 700, 800),
            label="Table",
            content="",
            tables=[table_rows],
        ),
    ]


# ---------------------------------------------------------------------------
# Property tests
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    party_num=party_number_st,
    votes=votes_22_st,
    bez_pref=bez_pref_st,
    control_number=control_number_st,
)
def test_preference_table_extracts_all_22_candidates(
    party_num: int,
    votes: list[int],
    bez_pref: int,
    control_number: str,
) -> None:
    """For any party block with 22 candidate vote counts in Pattern A format,
    parse_preference_pages should extract exactly 22 PreferenceEntry items
    with the correct party_number, candidate_number (101-122), and vote_count."""
    table_rows = _build_preference_table_pattern_a(party_num, votes, bez_pref)
    page_divs = _build_page_divs(control_number, table_rows)

    result = parse_preference_pages([page_divs])

    extracted = [
        (e.party_number, e.candidate_number, e.vote_count)
        for e in result.preferences
    ]
    expected = [
        (party_num, 101 + i, votes[i])
        for i in range(22)
    ]
    assert extracted == expected


@settings(max_examples=100)
@given(
    party_num=party_number_st,
    votes=votes_22_st,
    bez_pref=bez_pref_st,
    control_number=control_number_st,
)
def test_bez_preferencii_excluded_from_candidate_records(
    party_num: int,
    votes: list[int],
    bez_pref: int,
    control_number: str,
) -> None:
    """The 'Без преференции' value must not appear as a candidate record.
    All extracted candidate numbers must be in range 101-122."""
    table_rows = _build_preference_table_pattern_a(party_num, votes, bez_pref)
    page_divs = _build_page_divs(control_number, table_rows)

    result = parse_preference_pages([page_divs])

    candidate_numbers = [e.candidate_number for e in result.preferences]
    # No candidate number outside 101-122
    assert all(101 <= cn <= 122 for cn in candidate_numbers)
    # Exactly 22 entries (no extra "Без преференции" entry)
    assert len(result.preferences) == 22


@settings(max_examples=100)
@given(
    party_num=party_number_st,
    votes=votes_22_st,
    bez_pref=bez_pref_st,
    control_number=control_number_st,
)
def test_candidate_numbers_always_in_range_101_122(
    party_num: int,
    votes: list[int],
    bez_pref: int,
    control_number: str,
) -> None:
    """Every extracted candidate number must be in the range 101-122."""
    table_rows = _build_preference_table_pattern_a(party_num, votes, bez_pref)
    page_divs = _build_page_divs(control_number, table_rows)

    result = parse_preference_pages([page_divs])

    for entry in result.preferences:
        assert 101 <= entry.candidate_number <= 122, (
            f"Candidate number {entry.candidate_number} out of range for party {entry.party_number}"
        )
