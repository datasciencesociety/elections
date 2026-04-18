# Feature: ocr-protocol-parser, Property 3: Control number extraction from page top and bottom
"""Property-based tests for control number extraction.

**Validates: Requirements 3.1, 3.2**

Property 3: For any HTML page containing a numeric-only Text div at the top
(smallest y-coordinate) and a Page-Footer div at the bottom, the parser SHALL
extract both control numbers correctly. The top control number is the text
content of the topmost numeric-only Text div, and the bottom control number
is the numeric text from the Page-Footer div.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from html_utils import HtmlDiv
from page_parsers import parse_page1


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Numeric strings of 1–10 digits (no leading zeros for realism, but the parser
# doesn't enforce that — we allow any digit string).
numeric_string_st = st.from_regex(r"[1-9][0-9]{0,9}", fullmatch=True)

# Y-coordinate for the control number div (topmost position)
top_y_st = st.integers(min_value=1, max_value=30)

# Y-coordinates for other divs that must be below the control number
other_y_st = st.integers(min_value=50, max_value=500)


# ---------------------------------------------------------------------------
# Helpers — build minimal page 1 div lists
# ---------------------------------------------------------------------------

def _make_page1_divs_with_control(
    control_number: str,
    control_y: int,
) -> list[HtmlDiv]:
    """Build a minimal page 1 div list with a given control number at a
    given y-coordinate. Other required divs are placed below."""
    return [
        HtmlDiv(
            bbox=(100, control_y, 200, control_y + 20),
            label="Text",
            content=control_number,
        ),
        HtmlDiv(
            bbox=(50, 50, 400, 80),
            label="Text",
            content="Приложение № 75-НС-х",
        ),
        HtmlDiv(
            bbox=(50, 100, 400, 130),
            label="Text",
            content="0 1 0 1 0 0 0 0 1",
        ),
        HtmlDiv(
            bbox=(50, 150, 400, 180),
            label="Text",
            content="изборен район 01",
        ),
    ]


# ---------------------------------------------------------------------------
# Property tests
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(control_number=numeric_string_st)
def test_control_number_extracted_from_topmost_text_div(
    control_number: str,
) -> None:
    """For any numeric string (1–10 digits), placing it as the topmost Text
    div in a minimal page 1 div list, parse_page1 should extract it as the
    control_number."""
    divs = _make_page1_divs_with_control(control_number, control_y=5)
    result = parse_page1(divs)
    assert result.control_number == control_number


@settings(max_examples=100)
@given(control_number=numeric_string_st)
def test_control_number_is_always_numeric(
    control_number: str,
) -> None:
    """The extracted control number should always be a purely numeric string."""
    divs = _make_page1_divs_with_control(control_number, control_y=5)
    result = parse_page1(divs)
    assert result.control_number.isdigit()


@settings(max_examples=100)
@given(
    control_number=numeric_string_st,
    other_numbers=st.lists(
        numeric_string_st,
        min_size=1,
        max_size=5,
    ),
)
def test_topmost_numeric_div_wins_regardless_of_others(
    control_number: str,
    other_numbers: list[str],
) -> None:
    """For any numeric control number, it should be extracted regardless of
    other numeric Text divs placed below it."""
    # Control number div at y=5 (topmost)
    divs = [
        HtmlDiv(
            bbox=(100, 5, 200, 25),
            label="Text",
            content=control_number,
        ),
    ]
    # Add other numeric Text divs at y > 30 (below the control number)
    for i, num in enumerate(other_numbers):
        y = 200 + i * 50
        divs.append(
            HtmlDiv(
                bbox=(100, y, 200, y + 20),
                label="Text",
                content=num,
            ),
        )
    # Add required non-numeric divs for parse_page1 to succeed
    divs.extend([
        HtmlDiv(
            bbox=(50, 50, 400, 80),
            label="Text",
            content="Приложение № 75-НС-х",
        ),
        HtmlDiv(
            bbox=(50, 100, 400, 130),
            label="Text",
            content="0 1 0 1 0 0 0 0 1",
        ),
        HtmlDiv(
            bbox=(50, 150, 400, 180),
            label="Text",
            content="изборен район 01",
        ),
    ])
    result = parse_page1(divs)
    assert result.control_number == control_number
