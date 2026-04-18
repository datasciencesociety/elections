"""Unit tests for html_utils module.

Validates: Requirements 13.1, 13.2, 13.3, 13.4
"""

import os
from pathlib import Path

import pytest

from html_utils import (
    HtmlDiv,
    extract_cifri_value,
    extract_numeric_value,
    parse_html_file,
    strip_to_digits,
)

# ---------------------------------------------------------------------------
# Paths to real HTML sample files (relative to workspace root)
# ---------------------------------------------------------------------------

_MODULE_DIR = Path(__file__).resolve().parent  # elections/ocr-protocol-parser/
_ELECTIONS_DIR = _MODULE_DIR.parent           # elections/
_WORKSPACE_ROOT = _ELECTIONS_DIR.parent       # workspace root
_HTML_DIR = _WORKSPACE_ROOT / "election-results-2024" / "2024-html"

_SECTION_001_PAGE1 = _HTML_DIR / "010100001.0" / "010100001.0_page_1.html"
_SECTION_001_PAGE2 = _HTML_DIR / "010100001.0" / "010100001.0_page_2.html"
_SECTION_018_PAGE1 = _HTML_DIR / "010100018.0" / "010100018.0_page_1.html"
_SECTION_018_PAGE2 = _HTML_DIR / "010100018.0" / "010100018.0_page_2.html"


# ---------------------------------------------------------------------------
# strip_to_digits tests
# ---------------------------------------------------------------------------


class TestStripToDigits:
    def test_spaced_section_code(self):
        assert strip_to_digits("0 1 0 1 0 0 0 0 1") == "010100001"

    def test_no_digits(self):
        assert strip_to_digits("abc") == ""

    def test_mixed_digits_and_spaces(self):
        assert strip_to_digits("12 34") == "1234"

    def test_empty_string(self):
        assert strip_to_digits("") == ""

    def test_only_digits(self):
        assert strip_to_digits("42") == "42"

    def test_special_characters(self):
        assert strip_to_digits("a1-b2.c3") == "123"


# ---------------------------------------------------------------------------
# extract_cifri_value tests
# ---------------------------------------------------------------------------


class TestExtractCifriValue:
    def test_simple_cifri(self):
        assert extract_cifri_value("600 (с цифри)") == 600

    def test_cifri_with_dots_and_italic(self):
        # Simulates stripped content: "625\n(с цифри)"
        assert extract_cifri_value("625\n(с цифри)") == 625

    def test_no_cifri_pattern(self):
        assert extract_cifri_value("нула (с думи)") is None

    def test_empty_string(self):
        assert extract_cifri_value("") is None

    def test_no_digits_before_cifri(self):
        assert extract_cifri_value("abc (с цифри)") is None

    def test_cifri_with_surrounding_dots(self):
        # Content as it appears after HTML stripping: "....625.....\n(с цифри)"
        # The regex handles dots between number and pattern
        assert extract_cifri_value("....625.....\n(с цифри)") == 625

    def test_cifri_with_whitespace_around_number(self):
        assert extract_cifri_value("  310  (с цифри)") == 310

    def test_single_digit(self):
        assert extract_cifri_value("4\n(с цифри)") == 4

    def test_zero_value(self):
        assert extract_cifri_value("0\n(с цифри)") == 0

    def test_large_number(self):
        assert extract_cifri_value("12345 (с цифри)") == 12345


# ---------------------------------------------------------------------------
# extract_numeric_value tests
# ---------------------------------------------------------------------------


class TestExtractNumericValue:
    def test_simple_number(self):
        assert extract_numeric_value("42") == 42

    def test_number_with_text(self):
        assert extract_numeric_value("abc 123 def") == 123

    def test_no_digits(self):
        assert extract_numeric_value("no numbers here") is None

    def test_empty_string(self):
        assert extract_numeric_value("") is None


# ---------------------------------------------------------------------------
# parse_html_file tests — section 010100001 (Form 26, 14 pages)
# ---------------------------------------------------------------------------


class TestParseHtmlFileSection001:
    """Tests using real HTML from section 010100001 (Form 26)."""

    @pytest.fixture(autouse=True)
    def _skip_if_missing(self):
        if not _SECTION_001_PAGE1.exists():
            pytest.skip("Sample HTML files not available")

    def test_page1_div_count(self):
        divs = parse_html_file(_SECTION_001_PAGE1)
        # Page 1 has many divs — at least 20 top-level divs with data-bbox/data-label
        assert len(divs) >= 20

    def test_page1_first_div_is_text(self):
        divs = parse_html_file(_SECTION_001_PAGE1)
        assert divs[0].label == "Text"

    def test_page1_bbox_is_tuple_of_ints(self):
        divs = parse_html_file(_SECTION_001_PAGE1)
        for div in divs:
            assert isinstance(div.bbox, tuple)
            assert len(div.bbox) == 4
            assert all(isinstance(v, int) for v in div.bbox)

    def test_page1_labels_are_known_types(self):
        known_labels = {"Text", "Section-Header", "Form", "Table", "Image", "Page-Footer"}
        divs = parse_html_file(_SECTION_001_PAGE1)
        for div in divs:
            assert div.label in known_labels, f"Unknown label: {div.label}"

    def test_page1_section_code_present(self):
        """The spaced section code '0 1 0 1 0 0 0 0 1' should appear in content."""
        divs = parse_html_file(_SECTION_001_PAGE1)
        contents = [d.content for d in divs]
        assert any("0 1 0 1 0 0 0 0 1" in c for c in contents)

    def test_page1_cifri_value_600(self):
        """Page 1 should contain '600 (с цифри)' for ballots received."""
        divs = parse_html_file(_SECTION_001_PAGE1)
        cifri_values = [extract_cifri_value(d.content) for d in divs]
        assert 600 in cifri_values

    def test_page1_page_footer_present(self):
        divs = parse_html_file(_SECTION_001_PAGE1)
        footers = [d for d in divs if d.label == "Page-Footer"]
        assert len(footers) >= 1

    def test_page1_content_strips_html_tags(self):
        """Content should be plain text with no HTML tags."""
        divs = parse_html_file(_SECTION_001_PAGE1)
        for div in divs:
            assert "<p>" not in div.content
            assert "<b>" not in div.content
            assert "<i>" not in div.content
            assert "</p>" not in div.content

    def test_page2_has_form_divs_with_tables(self):
        divs = parse_html_file(_SECTION_001_PAGE2)
        form_divs = [d for d in divs if d.label == "Form"]
        assert len(form_divs) >= 2  # voter list table + ballot data table

    def test_page2_table_structure(self):
        """Form divs should have parsed tables with rows and cells."""
        divs = parse_html_file(_SECTION_001_PAGE2)
        form_divs = [d for d in divs if d.label == "Form"]
        # First form div should have at least one table
        assert len(form_divs[0].tables) >= 1
        table = form_divs[0].tables[0]
        # Table should have rows
        assert len(table) >= 1
        # Each row should have cells
        for row in table:
            assert isinstance(row, list)

    def test_page2_cifri_values_extracted(self):
        """Page 2 should contain cifri values like 625, 4, 310 in table cells."""
        divs = parse_html_file(_SECTION_001_PAGE2)
        form_divs = [d for d in divs if d.label == "Form"]
        # Collect all cifri values from table cells
        cifri_vals = []
        for fd in form_divs:
            for table in fd.tables:
                for row in table:
                    for cell in row:
                        val = extract_cifri_value(cell)
                        if val is not None:
                            cifri_vals.append(val)
        # Known values from the HTML: 625, 4, 310, 445, 1, 154, 6, 6
        assert 625 in cifri_vals
        assert 310 in cifri_vals

    def test_page2_section_header_present(self):
        divs = parse_html_file(_SECTION_001_PAGE2)
        headers = [d for d in divs if d.label == "Section-Header"]
        assert len(headers) >= 1


# ---------------------------------------------------------------------------
# parse_html_file tests — section 010100018 (Form 24, 8 pages)
# ---------------------------------------------------------------------------


class TestParseHtmlFileSection018:
    """Tests using real HTML from section 010100018 (Form 24)."""

    @pytest.fixture(autouse=True)
    def _skip_if_missing(self):
        if not _SECTION_018_PAGE1.exists():
            pytest.skip("Sample HTML files not available")

    def test_page1_div_count(self):
        divs = parse_html_file(_SECTION_018_PAGE1)
        assert len(divs) >= 15

    def test_page1_section_code_present(self):
        divs = parse_html_file(_SECTION_018_PAGE1)
        contents = [d.content for d in divs]
        assert any("0 1 0 1 0 0 0 1 8" in c for c in contents)

    def test_page1_form_type_text_present(self):
        """Should contain 'Приложение № 75-НС-х' for Form 24."""
        divs = parse_html_file(_SECTION_018_PAGE1)
        contents = [d.content for d in divs]
        assert any("75-НС" in c for c in contents)

    def test_page1_cifri_value_100(self):
        """Page 1 of 010100018 has '100' and '(с цифри)' as separate divs.
        extract_cifri_value on individual div content may not match since
        they are in separate divs. We verify the '100' text is present."""
        divs = parse_html_file(_SECTION_018_PAGE1)
        contents = [d.content for d in divs]
        assert any("100" in c for c in contents)

    def test_page2_table_parsing(self):
        divs = parse_html_file(_SECTION_018_PAGE2)
        form_divs = [d for d in divs if d.label == "Form"]
        assert len(form_divs) >= 2
        # First form should have voter list data
        first_form = form_divs[0]
        assert len(first_form.tables) >= 1
        table = first_form.tables[0]
        assert len(table) >= 3  # at least 3 data rows

    def test_page2_cifri_values(self):
        """Page 2 of 010100018 should have cifri values: 24, 5, 20, 89, 0, 20, 2, 0."""
        divs = parse_html_file(_SECTION_018_PAGE2)
        form_divs = [d for d in divs if d.label == "Form"]
        cifri_vals = []
        for fd in form_divs:
            for table in fd.tables:
                for row in table:
                    for cell in row:
                        val = extract_cifri_value(cell)
                        if val is not None:
                            cifri_vals.append(val)
        assert 24 in cifri_vals
        assert 20 in cifri_vals

    def test_page2_content_no_html_tags(self):
        divs = parse_html_file(_SECTION_018_PAGE2)
        for div in divs:
            assert "<p>" not in div.content
            assert "<b>" not in div.content
            assert "<i>" not in div.content


# ---------------------------------------------------------------------------
# HtmlDiv dataclass tests
# ---------------------------------------------------------------------------


class TestHtmlDiv:
    def test_creation(self):
        div = HtmlDiv(
            bbox=(10, 20, 100, 50),
            label="Text",
            content="Hello world",
        )
        assert div.bbox == (10, 20, 100, 50)
        assert div.label == "Text"
        assert div.content == "Hello world"
        assert div.tables == []

    def test_tables_default_empty(self):
        div = HtmlDiv(bbox=(0, 0, 0, 0), label="Form", content="")
        assert div.tables == []

    def test_with_tables(self):
        tables = [[["cell1", "cell2"], ["cell3", "cell4"]]]
        div = HtmlDiv(
            bbox=(0, 0, 100, 100),
            label="Form",
            content="table content",
            tables=tables,
        )
        assert len(div.tables) == 1
        assert div.tables[0][0] == ["cell1", "cell2"]
