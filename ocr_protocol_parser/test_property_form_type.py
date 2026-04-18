# Feature: ocr-protocol-parser, Property 2: Form type detection from page 1 text
"""Property-based tests for form type detection from page 1 text.

**Validates: Requirements 2.1**

Property 2: For any page 1 HTML containing one of the four valid form type strings
("Приложение № 75-НС-х", "Приложение № 76-НС-хм", "Приложение № 77-НС-чх",
"Приложение № 78-НС-чхм"), the parser SHALL return the corresponding form type
(24, 26, 28, 30). The mapping is case-insensitive for the suffix.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from html_utils import HtmlDiv
from models import FormTypeError
from page_parsers import parse_page1


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Mapping: (приложение number, suffix, expected form_type)
_FORM_VARIANTS: list[tuple[str, str, int]] = [
    ("75", "НС-х", 24),
    ("76", "НС-хм", 26),
    ("77", "НС-чх", 28),
    ("78", "НС-чхм", 30),
]


# ---------------------------------------------------------------------------
# Helpers — build minimal page 1 div lists
# ---------------------------------------------------------------------------

def _make_page1_divs(form_type_text: str) -> list[HtmlDiv]:
    """Build a minimal list of HtmlDiv elements for a valid page 1.

    Includes:
    - A numeric-only Text div at the top (control number)
    - A div containing the form type text (Приложение №)
    - A div with a spaced-digit section code
    - A div with "изборен район" text
    """
    return [
        HtmlDiv(bbox=(100, 10, 200, 30), label="Text", content="0110151"),
        HtmlDiv(bbox=(50, 50, 400, 80), label="Text", content=form_type_text),
        HtmlDiv(bbox=(50, 100, 400, 130), label="Text", content="0 1 0 1 0 0 0 0 1"),
        HtmlDiv(bbox=(50, 150, 400, 180), label="Text", content="изборен район 01"),
    ]


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Strategy that picks one of the 4 valid form variants
form_variant_st = st.sampled_from(_FORM_VARIANTS)

# Strategy for random case variations of Cyrillic suffix characters
# We generate case-mixed versions of the suffix by randomly upper/lowering each char
def _case_vary(suffix: str) -> st.SearchStrategy[str]:
    """Generate random case variations of a Cyrillic suffix string."""
    return st.tuples(
        *[st.sampled_from([c.lower(), c.upper()]) for c in suffix]
    ).map(lambda chars: "".join(chars))


# Strategy for text that does NOT contain "Приложение" or "приложение"
non_form_text = st.text(
    alphabet=st.characters(
        blacklist_categories=("Cs",),  # exclude surrogates
    ),
    min_size=0,
    max_size=60,
).filter(lambda t: "приложение" not in t.lower())


# ---------------------------------------------------------------------------
# Property tests
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(variant=form_variant_st)
def test_form_type_detected_for_valid_strings(
    variant: tuple[str, str, int],
) -> None:
    """For each of the 4 form type strings, parse_page1 returns the correct
    form_type value."""
    num, suffix, expected_type = variant
    form_text = f"Приложение № {num}-{suffix}"
    divs = _make_page1_divs(form_text)
    result = parse_page1(divs)
    assert result.form_type == expected_type


@settings(max_examples=100)
@given(
    variant=form_variant_st,
    data=st.data(),
)
def test_form_type_case_insensitive_suffix(
    variant: tuple[str, str, int],
    data: st.DataObject,
) -> None:
    """For random case variations of the suffix (e.g. хм, ХМ, Хм),
    parse_page1 still detects the correct form_type."""
    num, suffix, expected_type = variant
    varied_suffix = data.draw(_case_vary(suffix))
    form_text = f"Приложение № {num}-{varied_suffix}"
    divs = _make_page1_divs(form_text)
    result = parse_page1(divs)
    assert result.form_type == expected_type


@settings(max_examples=100)
@given(text=non_form_text)
def test_form_type_error_when_no_prilozhenie(text: str) -> None:
    """For any div list without 'Приложение №' text, parse_page1 raises
    FormTypeError."""
    divs = [
        HtmlDiv(bbox=(100, 10, 200, 30), label="Text", content="0110151"),
        HtmlDiv(bbox=(50, 50, 400, 80), label="Text", content=text),
        HtmlDiv(bbox=(50, 100, 400, 130), label="Text", content="0 1 0 1 0 0 0 0 1"),
        HtmlDiv(bbox=(50, 150, 400, 180), label="Text", content="изборен район 01"),
    ]
    with pytest.raises(FormTypeError):
        parse_page1(divs)
