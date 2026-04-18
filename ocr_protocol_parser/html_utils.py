"""HTML parsing utilities for OCR protocol pages.

Provides functions to parse OCR-ed HTML pages into structured data,
extract numeric values from "(с цифри)" patterns, and strip text to digits.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class HtmlDiv:
    """A single top-level <div> from an OCR HTML page."""

    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2
    label: str  # Text, Section-Header, Form, Table, Image, Page-Footer
    content: str  # inner text (all tags stripped)
    tables: list[list[list[str]]] = field(default_factory=list)
    # parsed table rows if present; each table is list of rows,
    # each row is list of cell texts


# ---------------------------------------------------------------------------
# HTML parser
# ---------------------------------------------------------------------------


class _DivParser(HTMLParser):
    """Extract top-level divs with data-bbox and data-label attributes."""

    def __init__(self) -> None:
        super().__init__()
        self.divs: list[HtmlDiv] = []

        # Tracking state
        self._in_target_div = False
        self._div_depth = 0  # nesting depth inside target div
        self._bbox: tuple[int, int, int, int] | None = None
        self._label: str | None = None

        # Text accumulation
        self._text_parts: list[str] = []
        self._in_del = False  # inside <del> (strikethrough) — skip content

        # Table parsing state
        self._tables: list[list[list[str]]] = []
        self._in_table = False
        self._table_depth = 0
        self._in_row = False
        self._in_cell = False
        self._current_row: list[str] = []
        self._current_cell_parts: list[str] = []
        self._current_table: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_dict = dict(attrs)

        if tag == "div" and not self._in_target_div:
            bbox_str = attr_dict.get("data-bbox")
            label = attr_dict.get("data-label")
            if bbox_str is not None and label is not None:
                parts = bbox_str.split()
                if len(parts) == 4:
                    self._bbox = (
                        int(parts[0]),
                        int(parts[1]),
                        int(parts[2]),
                        int(parts[3]),
                    )
                    self._label = label
                    self._in_target_div = True
                    self._div_depth = 1
                    self._text_parts = []
                    self._tables = []
                    return

        if self._in_target_div:
            if tag == "div":
                self._div_depth += 1

            if tag == "del":
                self._in_del = True
                self._del_parts: list[str] = []

            if tag == "table":
                if not self._in_table:
                    self._in_table = True
                    self._table_depth = 1
                    self._current_table = []
                else:
                    self._table_depth += 1

            if self._in_table:
                if tag == "tr":
                    self._in_row = True
                    self._current_row = []
                elif tag == "td" or tag == "th":
                    self._in_cell = True
                    self._current_cell_parts = []
                elif tag == "br":
                    # Treat <br/> as newline in cell text and overall text
                    if self._in_cell:
                        self._current_cell_parts.append("\n")
                    self._text_parts.append("\n")
            else:
                if tag == "br":
                    self._text_parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if not self._in_target_div:
            return

        if tag == "div":
            self._div_depth -= 1
            if self._div_depth == 0:
                # Finished the target div — emit HtmlDiv
                content = "".join(self._text_parts).strip()
                self.divs.append(
                    HtmlDiv(
                        bbox=self._bbox,  # type: ignore[arg-type]
                        label=self._label,  # type: ignore[arg-type]
                        content=content,
                        tables=self._tables,
                    )
                )
                self._in_target_div = False
                self._bbox = None
                self._label = None
                self._text_parts = []
                self._tables = []
                self._in_table = False
                self._table_depth = 0
                self._in_del = False
                return

        if tag == "del":
            scratched = "".join(self._del_parts).strip() if hasattr(self, '_del_parts') else ""
            if scratched:
                if not hasattr(self, '_del_count'):
                    self._del_count = 0
                self._del_count += 1
            self._in_del = False

        if self._in_table:
            if tag == "table":
                self._table_depth -= 1
                if self._table_depth == 0:
                    self._tables.append(self._current_table)
                    self._current_table = []
                    self._in_table = False
                    self._in_row = False
                    self._in_cell = False
            elif tag in ("td", "th"):
                if self._in_cell:
                    cell_text = "".join(self._current_cell_parts).strip()
                    self._current_row.append(cell_text)
                    self._in_cell = False
            elif tag == "tr":
                if self._in_row:
                    self._current_table.append(self._current_row)
                    self._current_row = []
                    self._in_row = False

    def handle_data(self, data: str) -> None:
        if not self._in_target_div:
            return
        if self._in_del:
            if hasattr(self, '_del_parts'):
                self._del_parts.append(data)
            return  # skip crossed-out content

        self._text_parts.append(data)

        if self._in_table and self._in_cell:
            self._current_cell_parts.append(data)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_html_file(path: str | Path) -> list[HtmlDiv]:
    """Parse an OCR HTML page file and return a list of HtmlDiv elements."""
    html_content = Path(path).read_text(encoding="utf-8")
    parser = _DivParser()
    parser.feed(html_content)
    _warn_del_once(path, parser)
    return parser.divs


def parse_html_file_flush(path: str | Path) -> list[HtmlDiv]:
    """Like :func:`parse_html_file` but also flushes any unclosed div.

    Some OCR HTML pages are truncated mid-table.  This variant emits the
    in-progress div (with whatever table rows have been accumulated so far)
    so that callers can still extract partial data.
    """
    html_content = Path(path).read_text(encoding="utf-8")
    parser = _DivParser()
    parser.feed(html_content)

    # Flush unclosed div if the parser is still inside one
    if parser._in_target_div and parser._bbox is not None and parser._label is not None:
        tables = list(parser._tables)
        # Include the in-progress table if any rows were accumulated
        if parser._in_table and parser._current_table:
            # Also flush any in-progress row
            current_table = list(parser._current_table)
            if parser._in_row and parser._current_row:
                current_table.append(list(parser._current_row))
            tables.append(current_table)
        content = "".join(parser._text_parts).strip()
        parser.divs.append(
            HtmlDiv(
                bbox=parser._bbox,
                label=parser._label,
                content=content,
                tables=tables,
            )
        )

    _warn_del_once(path, parser)
    return parser.divs


# Track files already warned about scratches to avoid duplicates
_warned_del_files: set[str] = set()


def _warn_del_once(path: str | Path, parser: _DivParser) -> None:
    """Warn about scratched-out content, once per file."""
    import logging
    del_count = getattr(parser, '_del_count', 0)
    fname = Path(path).name
    if del_count > 0 and fname not in _warned_del_files:
        _warned_del_files.add(fname)
        logging.getLogger(__name__).warning(
            "%s: %d scratched-out (del) element(s) found", fname, del_count
        )


# Regex for "(с цифри)" pattern: a number (possibly with dots/spaces)
# appearing before the literal "(с цифри)".
_CIFRI_RE = re.compile(
    r"(?<!\d)"             # not preceded by a digit
    r"(\d[\d ]*\d|\d)"     # one or more digits, possibly with spaces (same line only)
    r"[\s.\n]*"            # whitespace, dots, newlines after the number
    r"(?:\(с\s+думи\)[\s.\n]*)?"  # optional "(с думи)" label
    r"\(с\s+цифри\)",
    re.IGNORECASE,
)


def extract_cifri_value(text: str) -> int | None:
    """Extract the integer from a '(с цифри)' pattern in *text*.

    When multiple numbers appear before '(с цифри)' (e.g., corrections
    where the old value is crossed out), takes the FIRST number that
    appears after '(с думи)' or in the last few lines before '(с цифри)'.
    """
    # Find the position of "(с цифри)"
    cifri_match = re.search(r"\(с\s+цифри\)", text, re.IGNORECASE)
    if not cifri_match:
        return None

    before = text[:cifri_match.start()]

    # Strategy 1: look for numbers between "(с думи)" and "(с цифри)"
    dumi_match = re.search(r"\(с\s+думи\)", before, re.IGNORECASE)
    if dumi_match:
        between = before[dumi_match.end():]
        numbers = re.findall(r"(?<!\d)(\d[\d ]*\d|\d)(?!\d)", between)
        if numbers:
            digits = strip_to_digits(numbers[0])
            if digits:
                return int(digits)

    # Strategy 2: look for numbers in the last 30 chars before "(с цифри)"
    tail = before[-30:] if len(before) > 30 else before
    numbers = re.findall(r"(?<!\d)(\d[\d ]*\d|\d)(?!\d)", tail)
    if numbers:
        # Take the first number in the tail
        digits = strip_to_digits(numbers[0])
        if digits:
            return int(digits)

    # No digits found
    before_stripped = before.strip()
    if before_stripped:
        return 0
    return None


def extract_numeric_value(text: str) -> int | None:
    """Extract the first integer found in *text*.

    Returns ``None`` if *text* contains no digits.
    """
    digits = strip_to_digits(text)
    if digits:
        return int(digits)
    return None


def strip_to_digits(text: str) -> str:
    """Remove all non-digit characters from *text*."""
    return re.sub(r"\D", "", text)
