# Feature: ocr-protocol-parser, Property 8: Vote aggregation from multiple pages preserves all entries
"""Property-based tests for vote aggregation from multiple pages.

**Validates: Requirements 6.5, 8.5**

Property 8: For any two lists of VoteEntry from consecutive pages, aggregation
SHALL produce a single list containing all entries from both pages in order,
with no entries lost or duplicated.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from html_utils import HtmlDiv
from page_parsers import parse_vote_pages


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Party numbers: realistic range 1–99
party_number_st = st.integers(min_value=1, max_value=99)

# Vote counts: non-negative integers up to a realistic max
vote_count_st = st.integers(min_value=0, max_value=999_999)

# A single (party_number, vote_count) pair
vote_entry_st = st.tuples(party_number_st, vote_count_st)

# Lists of vote entries with unique party numbers per page (1–15 entries)
vote_entries_st = st.lists(
    vote_entry_st,
    min_size=1,
    max_size=15,
    unique_by=lambda x: x[0],
)

# Control number for each page
control_number_st = st.from_regex(r"[1-9][0-9]{4,9}", fullmatch=True)


# ---------------------------------------------------------------------------
# Helpers — build synthetic div lists
# ---------------------------------------------------------------------------

def _build_vote_table_rows(
    entries: list[tuple[int, int]],
) -> list[list[str]]:
    """Build table rows from (party_number, vote_count) pairs."""
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
    entries_page1=vote_entries_st,
    entries_page2=vote_entries_st,
    cn1=control_number_st,
    cn2=control_number_st,
)
def test_aggregation_contains_all_entries_from_both_pages(
    entries_page1: list[tuple[int, int]],
    entries_page2: list[tuple[int, int]],
    cn1: str,
    cn2: str,
) -> None:
    """Aggregating vote entries from two pages must produce a list containing
    all entries from both pages in order, with none lost or duplicated."""
    page1_divs = _build_page_divs(cn1, _build_vote_table_rows(entries_page1))
    page2_divs = _build_page_divs(cn2, _build_vote_table_rows(entries_page2))

    result = parse_vote_pages([page1_divs, page2_divs])

    extracted = [(v.party_number, v.vote_count) for v in result.votes]
    expected = entries_page1 + entries_page2
    assert extracted == expected


@settings(max_examples=100)
@given(
    entries_page1=vote_entries_st,
    entries_page2=vote_entries_st,
    cn1=control_number_st,
    cn2=control_number_st,
)
def test_aggregation_total_count_equals_sum_of_page_counts(
    entries_page1: list[tuple[int, int]],
    entries_page2: list[tuple[int, int]],
    cn1: str,
    cn2: str,
) -> None:
    """The total number of aggregated entries must equal the sum of entries
    from both pages — no entries lost or duplicated."""
    page1_divs = _build_page_divs(cn1, _build_vote_table_rows(entries_page1))
    page2_divs = _build_page_divs(cn2, _build_vote_table_rows(entries_page2))

    result = parse_vote_pages([page1_divs, page2_divs])

    assert len(result.votes) == len(entries_page1) + len(entries_page2)
