# Feature: ocr-protocol-parser, Property 5: Numeric extraction strips whitespace and non-numeric characters
"""Property-based tests for numeric extraction utilities.

**Validates: Requirements 13.4, 4.4, 5.1–5.8**

Property 5: For any string containing a numeric value surrounded by whitespace,
parentheses, or label text (e.g., '(с цифри)'), the extract_cifri_value function
SHALL return the correct integer. For any string composed entirely of non-numeric
characters, it SHALL return None.
"""

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from html_utils import extract_cifri_value, extract_numeric_value, strip_to_digits


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Positive integers (avoid huge numbers that could cause issues)
positive_ints = st.integers(min_value=0, max_value=999_999_999)

# Strings with no digit characters at all
non_digit_text = st.text(
    alphabet=st.characters(blacklist_categories=("Nd",)),
    min_size=1,
    max_size=50,
)


# ---------------------------------------------------------------------------
# Property tests
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(n=positive_ints)
def test_extract_cifri_value_roundtrip(n: int) -> None:
    """For any non-negative integer n, formatting it as '{n} (с цифри)'
    and calling extract_cifri_value should return n."""
    text = f"{n} (с цифри)"
    assert extract_cifri_value(text) == n


@settings(max_examples=100)
@given(n=positive_ints)
def test_strip_to_digits_preserves_digit_string(n: int) -> None:
    """For any non-negative integer n, strip_to_digits(str(n)) should
    return str(n) — digits pass through unchanged."""
    assert strip_to_digits(str(n)) == str(n)


@settings(max_examples=100)
@given(text=non_digit_text)
def test_strip_to_digits_no_digits_returns_empty(text: str) -> None:
    """For any string with no digit characters, strip_to_digits should
    return an empty string."""
    assert strip_to_digits(text) == ""


@settings(max_examples=100)
@given(text=st.text(min_size=0, max_size=100))
def test_strip_to_digits_returns_only_digits(text: str) -> None:
    """For any string, strip_to_digits should return a string composed
    entirely of digit characters (or empty)."""
    result = strip_to_digits(text)
    assert result == "" or result.isdigit()


@settings(max_examples=100)
@given(n=st.integers(min_value=1, max_value=999_999_999))
def test_extract_numeric_value_from_digit_string(n: int) -> None:
    """For any positive integer n, extract_numeric_value on a string
    containing those digits should return an integer composed of those
    digits."""
    text = f"abc {n} xyz"
    result = extract_numeric_value(text)
    # The result should equal the integer formed by all digits in text
    assert result is not None
    assert result == int(strip_to_digits(text))
