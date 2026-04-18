# Feature: ocr-protocol-parser, Property 4: Spaced-digit section code round-trip
"""Property-based tests for spaced-digit section code round-trip.

**Validates: Requirements 4.2**

Property 4: For any 9-digit section code string, formatting it as spaced digits
(e.g., "0 1 0 1 0 0 0 0 1") and then parsing it back SHALL produce the original
section code. Conversely, for any spaced-digit string matching the pattern
"D D D D D D D D D", parsing it SHALL produce a valid 9-digit code.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from html_utils import HtmlDiv
from page_parsers import parse_page1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_spaced(code: str) -> str:
    """Format a 9-digit code as space-separated single digits."""
    return " ".join(code)


def _make_page1_divs_with_section(spaced_code: str) -> list[HtmlDiv]:
    """Build a minimal page 1 div list containing the given spaced section code."""
    return [
        HtmlDiv(bbox=(100, 10, 200, 30), label="Text", content="0110151"),
        HtmlDiv(bbox=(50, 50, 400, 80), label="Text", content="Приложение № 75-НС-х"),
        HtmlDiv(bbox=(50, 100, 400, 130), label="Text", content=spaced_code),
        HtmlDiv(bbox=(50, 150, 400, 180), label="Text", content="изборен район 01"),
    ]


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# A 9-digit string where each character is a digit 0-9
nine_digit_code_st = st.text(
    alphabet=st.sampled_from("0123456789"),
    min_size=9,
    max_size=9,
)


# ---------------------------------------------------------------------------
# Property tests
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(code=nine_digit_code_st)
def test_section_code_round_trip(code: str) -> None:
    """For any 9-digit code, formatting as spaced digits and parsing back
    produces the original code."""
    spaced = _format_spaced(code)
    divs = _make_page1_divs_with_section(spaced)
    result = parse_page1(divs)
    assert result.section_code == code


@settings(max_examples=100)
@given(code=nine_digit_code_st)
def test_spaced_digit_parse_produces_valid_9_digit_code(code: str) -> None:
    """For any spaced-digit string 'D D D D D D D D D', parsing produces
    a valid 9-digit numeric code."""
    spaced = _format_spaced(code)
    divs = _make_page1_divs_with_section(spaced)
    result = parse_page1(divs)
    assert len(result.section_code) == 9
    assert result.section_code.isdigit()
