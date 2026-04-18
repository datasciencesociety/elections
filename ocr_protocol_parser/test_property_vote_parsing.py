# Feature: ocr-protocol-parser, Property 6: Vote table parsing extracts all party entries
"""Property-based tests for vote table parsing.

**Validates: Requirements 6.1, 6.2, 6.3, 8.1**

Property 6: For any HTML table containing vote rows with party numbers in the
first column and numeric vote counts in "(с цифри)" format, the parser SHALL
extract a list of (party_number, vote_count) tuples matching all rows in the
table, preserving order.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from html_utils import HtmlDiv
from models import VoteEntry
from page_parsers import parse_vote_pages


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Party numbers: realistic range 1–99
party_number_st = st.integers(min_value=1, max_value=99)

# Vote counts: non-negative integers up to a realistic max
vote_count_st = st.integers(min_value=0, max_value=999_999)

# A single (party_number, vote_count) pair with unique party numbers
vote_entry_st = st.tuples(party_number_st, vote_count_st)

# A list of vote entries with unique party numbers (1–20 entries)
vote_entries_st = st.lists(
    vote_entry_st,
    min_size=1,
    max_size=20,
    unique_by=lambda x: x[0],
)

# Control number for the page
control_number_st = st.from_regex(r"[1-9][0-9]{4,9}", fullmatch=True)


# ---------------------------------------------------------------------------
# Helpers — build synthetic div lists for parse_vote_pages
# ---------------------------------------------------------------------------

def _build_vote_table_rows(
    entries: list[tuple[int, int]],
) -> list[list[str]]:
    """Build table rows from (party_number, vote_count) pairs.

    Each row has: ["{party_num}. Party Name", "...", "{vote_count} (с цифри)"]
    """
    rows: list[list[str]] = []
    for party_num, vote_count in entries:
        rows.append([
            f"{party_num}. Партия {party_num}",
            f"{vote_count} (с цифри)",
        ])
    return rows


def _build_page_divs(
    control_number: str,
    table_rows: list[list[str]],
) -> list[HtmlDiv]:
    """Build a minimal page div list with a control number and a Table div."""
    return [
        # Control number at the top
        HtmlDiv(
            bbox=(100, 5, 200, 25),
            label="Text",
            content=control_number,
        ),
        # Table div with vote rows
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
    entries=vote_entries_st,
    control_number=control_number_st,
)
def test_vote_table_extracts_all_party_entries(
    entries: list[tuple[int, int]],
    control_number: str,
) -> None:
    """For any list of (party_number, vote_count) pairs, constructing a
    synthetic Table div with those values in '(с цифри)' format and parsing
    with parse_vote_pages should extract all entries correctly."""
    table_rows = _build_vote_table_rows(entries)
    page_divs = _build_page_divs(control_number, table_rows)

    result = parse_vote_pages([page_divs])

    extracted = [(v.party_number, v.vote_count) for v in result.votes]
    assert extracted == entries


@settings(max_examples=100)
@given(
    entries=vote_entries_st,
    control_number=control_number_st,
)
def test_vote_table_preserves_order(
    entries: list[tuple[int, int]],
    control_number: str,
) -> None:
    """The order of extracted entries must match the order of rows in the
    input table."""
    table_rows = _build_vote_table_rows(entries)
    page_divs = _build_page_divs(control_number, table_rows)

    result = parse_vote_pages([page_divs])

    extracted_party_numbers = [v.party_number for v in result.votes]
    expected_party_numbers = [pn for pn, _ in entries]
    assert extracted_party_numbers == expected_party_numbers


@settings(max_examples=100)
@given(
    entries=vote_entries_st,
    control_number=control_number_st,
)
def test_vote_table_entry_count_matches_input(
    entries: list[tuple[int, int]],
    control_number: str,
) -> None:
    """The number of extracted entries must match the number of input rows."""
    table_rows = _build_vote_table_rows(entries)
    page_divs = _build_page_divs(control_number, table_rows)

    result = parse_vote_pages([page_divs])

    assert len(result.votes) == len(entries)
