"""Page-specific parser functions for OCR protocol HTML pages.

Each function accepts a list of HtmlDiv elements (from parse_html_file)
and returns a typed dataclass with the extracted fields.
"""

from __future__ import annotations

import logging
import re

from .html_utils import HtmlDiv, extract_cifri_value, extract_numeric_value, strip_to_digits
from .models import (
    FormTypeError,
    MachinePreferencesData,
    MachineVotesData,
    Page1Data,
    Page2Data,
    PaperPreferencesData,
    PaperVotesData,
    PreferenceEntry,
    VoteEntry,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Form type mapping: Приложение number → CIK form type
# ---------------------------------------------------------------------------

_FORM_TYPE_MAP: dict[str, int] = {
    "75": 24,
    "76": 26,
    "77": 28,
    "78": 30,
}

# Regex to find "Приложение № NN" where NN is 75/76/77/78
_FORM_TYPE_RE = re.compile(
    r"приложение\s+[№#]\s*(\d{2})",
    re.IGNORECASE,
)

# Regex for spaced-digit section code: exactly 9 single digits separated by spaces
_SPACED_DIGITS_RE = re.compile(r"\b(\d(?:\s+\d){8})\b")

# Regex for "изборен район NN"
_RIK_RE = re.compile(r"изборен\s+район\s+(\d+)", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Page 1 parser
# ---------------------------------------------------------------------------


def parse_page1(divs: list[HtmlDiv]) -> Page1Data:
    """Parse page 1 of a protocol and return header fields.

    Extracts: control_number, form_type, form_number, section_code,
    rik_code, ballots_received.

    Raises ``FormTypeError`` if the form type text is not found.
    """
    control_number = _extract_control_number(divs)
    form_type = _extract_form_type(divs)
    form_number = _extract_form_number(divs, control_number)
    section_code = _extract_section_code(divs)
    rik_code = _extract_rik_code(divs)
    ballots_received = _extract_ballots_received(divs)

    return Page1Data(
        control_number=control_number,
        form_type=form_type,
        form_number=form_number,
        section_code=section_code,
        rik_code=rik_code,
        ballots_received=ballots_received,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_control_number(divs: list[HtmlDiv]) -> str:
    """Extract control number from the topmost 7-digit numeric Text or Page-Header div."""
    # First try: exact 7-digit content
    exact_divs = [
        d for d in divs
        if d.label in ("Text", "Page-Header")
        and strip_to_digits(d.content) == d.content.strip()
        and len(d.content.strip()) == 7
    ]
    if exact_divs:
        exact_divs.sort(key=lambda d: d.bbox[1])
        return exact_divs[0].content.strip()

    # Fallback: find a 7-digit number within top divs (y < 50)
    _7digit_re = re.compile(r"\b(\d{7})\b")
    top_divs = [
        d for d in divs
        if d.label in ("Text", "Page-Header") and d.bbox[1] < 50
    ]
    top_divs.sort(key=lambda d: d.bbox[1])
    for d in top_divs:
        m = _7digit_re.search(d.content)
        if m:
            return m.group(1)

    logger.warning("No 7-digit control number found at top of page")
    return ""


def validate_control_number(divs: list[HtmlDiv], page_label: str = "") -> None:
    """Warn if the control number is not found exactly twice (top and bottom).

    The control number should appear once in a Text/Page-Header div at the
    top of the page and once in a Page-Footer or Text div at the bottom.
    """
    # Top: topmost 7-digit numeric Text/Page-Header div
    _7digit_re = re.compile(r"\b(\d{7})\b")
    top_divs = [
        d for d in divs
        if d.label in ("Text", "Page-Header")
        and strip_to_digits(d.content) == d.content.strip()
        and len(d.content.strip()) == 7
    ]
    top_cn = ""
    if top_divs:
        top_divs.sort(key=lambda d: d.bbox[1])
        top_cn = top_divs[0].content.strip()
    else:
        # Fallback: find 7-digit number in top divs
        fallback = [d for d in divs if d.label in ("Text", "Page-Header") and d.bbox[1] < 50]
        fallback.sort(key=lambda d: d.bbox[1])
        for d in fallback:
            m = _7digit_re.search(d.content)
            if m:
                top_cn = m.group(1)
                break

    # Bottom: numeric-only Page-Footer or Text div with high y-coordinate
    footer_divs = [
        d for d in divs
        if d.label in ("Page-Footer", "Text")
        and strip_to_digits(d.content) == d.content.strip()
        and d.content.strip()
        and d.bbox[1] > 900  # bottom of page
    ]
    bottom_cn = ""
    if footer_divs:
        footer_divs.sort(key=lambda d: d.bbox[1], reverse=True)
        # Pick the one that looks like a control number (not a page number)
        for fd in footer_divs:
            val = fd.content.strip()
            if len(val) >= 5:  # control numbers are 7+ digits, page numbers are 1-2
                bottom_cn = val
                break

    prefix = f"{page_label}: " if page_label else ""

    if not top_cn and not bottom_cn:
        logger.warning("%sControl number not found at top or bottom of page", prefix)
    elif not top_cn:
        logger.warning("%sControl number not found at top of page (bottom=%s)", prefix, bottom_cn)
    elif not bottom_cn:
        logger.warning("%sControl number not found at bottom of page (top=%s)", prefix, top_cn)
    elif top_cn != bottom_cn:
        logger.warning(
            "%sControl number mismatch: top=%s, bottom=%s",
            prefix, top_cn, bottom_cn,
        )


def _extract_form_type(divs: list[HtmlDiv]) -> int:
    """Detect form type from 'Приложение №' text.

    Raises ``FormTypeError`` if not found.
    """
    for d in divs:
        m = _FORM_TYPE_RE.search(d.content)
        if m:
            num = m.group(1)
            if num in _FORM_TYPE_MAP:
                return _FORM_TYPE_MAP[num]
    raise FormTypeError("Form type text 'Приложение №' not found on page 1")


def _extract_form_number(divs: list[HtmlDiv], control_number: str) -> str:
    """Extract form number — a purely numeric Text div near the top,
    distinct from the control number.
    """
    # Filter Text divs near the top (y1 < 100) that are purely numeric
    candidates = []
    for d in divs:
        if d.label != "Text":
            continue
        if d.bbox[1] >= 100:
            continue
        stripped = d.content.strip()
        if not stripped:
            continue
        digits = strip_to_digits(stripped)
        if digits == stripped and digits != control_number:
            candidates.append(d)

    if candidates:
        candidates.sort(key=lambda d: d.bbox[1])
        return candidates[0].content.strip()

    # Fallback: look for an 8-digit number in top divs (form numbers are typically 8 digits)
    _8digit_re = re.compile(r"\b(\d{8})\b")
    for d in divs:
        if d.label != "Text" or d.bbox[1] >= 100:
            continue
        m = _8digit_re.search(d.content)
        if m and m.group(1) != control_number:
            return m.group(1)

    logger.warning("No form number found near top of page 1")
    return ""


def _extract_section_code(divs: list[HtmlDiv]) -> str:
    """Extract section code from spaced-digit format (e.g. '0 1 0 1 0 0 0 0 1')."""
    for d in divs:
        m = _SPACED_DIGITS_RE.search(d.content)
        if m:
            return m.group(1).replace(" ", "")
    logger.warning("No spaced-digit section code found on page 1")
    return ""


def _extract_rik_code(divs: list[HtmlDiv]) -> str:
    """Extract RIK code from 'изборен район NN' text."""
    for d in divs:
        m = _RIK_RE.search(d.content)
        if m:
            return m.group(1)
    logger.warning("No RIK code found on page 1")
    return ""


def _extract_ballots_received(divs: list[HtmlDiv]) -> int | None:
    """Extract ballots received from '(с цифри)' value after 'А. Брой' text.

    Handles two layouts:
    1. Number and "(с цифри)" in the same div: ``"600 (с цифри)"``
    2. Number in one div, "(с цифри)" in the next div (split layout)
    """
    # Strategy: find the div containing "А." and "Брой", then look at
    # subsequent divs for a "(с цифри)" pattern.
    found_a_broy = False
    for i, d in enumerate(divs):
        content = d.content
        if not found_a_broy:
            if "А." in content and "рой" in content:
                found_a_broy = True
                # Check if this same div contains "(с цифри)"
                val = extract_cifri_value(content)
                if val is not None:
                    return val
        else:
            # Check combined number + "(с цифри)" in one div
            val = extract_cifri_value(content)
            if val is not None:
                return val
            # Check if this div is "(с цифри)" alone — the number is in
            # the preceding div
            if "с цифри" in content.lower():
                # Look backwards for a nearby numeric div
                for j in range(i - 1, max(i - 4, -1), -1):
                    prev = divs[j].content.strip()
                    digits = strip_to_digits(prev)
                    if digits and digits == prev:
                        return int(digits)

    logger.warning("Ballots received '(с цифри)' value not found on page 1")
    return None


# ---------------------------------------------------------------------------
# Page 2 parser
# ---------------------------------------------------------------------------

# Label patterns for page 2 fields.
# Each tuple: (regex pattern to match the first cell, field name)
# We use regexes anchored to the start of the text (after stripping) to avoid
# false positives from substring matches (e.g. "кочана)" matching "а)").
_PAGE2_LABEL_REGEXES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^1\.\s"), "voter_list_count"),       # field 8
    (re.compile(r"^2\.\s"), "additional_voters"),       # field 11
    (re.compile(r"^3\.\s"), "voted_count"),             # field 12
    # а) or a) — Cyrillic а (U+0430) or Latin a (U+0061), OCR may produce either
    (re.compile(r"^(?:4\.?\s*)?[аa]\)"), "unused_ballots"),   # field 13
    (re.compile(r"^(?:4\.?\s*)?[бb]\)"), "invalid_ballots"),  # field 14
    (re.compile(r"^5\.\s"), "paper_ballots_in_box"),    # field 15
    (re.compile(r"^6\.\s"), "invalid_votes"),           # field 16
    (re.compile(r"^7\.\s"), "no_support_votes"),        # field 17
]


def _match_page2_field(label_text: str) -> str | None:
    """Return the field name if *label_text* matches a page 2 row pattern.

    Uses regex matching anchored to the start of the stripped label text
    to avoid false positives from substring matches deep inside the text.
    """
    stripped = label_text.strip()
    for pattern, field_name in _PAGE2_LABEL_REGEXES:
        if pattern.search(stripped):
            return field_name
    return None


def parse_page2(divs: list[HtmlDiv]) -> Page2Data:
    """Parse page 2 of a protocol and return voter list / ballot data.

    Extracts: control_number, voter_list_count (field 8),
    additional_voters (field 11), voted_count (field 12),
    unused_ballots (field 13), invalid_ballots (field 14),
    paper_ballots_in_box (field 15), invalid_votes (field 16),
    no_support_votes (field 17).
    """
    control_number = _extract_control_number(divs)

    fields: dict[str, int | None] = {
        "voter_list_count": None,
        "additional_voters": None,
        "voted_count": None,
        "unused_ballots": None,
        "invalid_ballots": None,
        "paper_ballots_in_box": None,
        "invalid_votes": None,
        "no_support_votes": None,
    }

    # Iterate through Form/Table divs and their tables
    for d in divs:
        if d.label not in ("Form", "Table"):
            continue
        for table in d.tables:
            for row in table:
                if not row:
                    continue
                label_cell = row[0]
                field_name = _match_page2_field(label_cell)
                if field_name is None:
                    continue
                # Extract cifri value from the last cell of the row
                if len(row) < 2:
                    logger.warning(
                        "Page 2 field %s: row has only one cell, cannot extract value",
                        field_name,
                    )
                    continue
                value = extract_cifri_value(row[-1])
                if value is None:
                    logger.warning(
                        "Page 2 field %s: could not parse '(с цифри)' value from '%s'",
                        field_name,
                        row[-1][:80],
                    )
                fields[field_name] = value

    # Log warnings for any fields that remain None
    for field_name, value in fields.items():
        if value is None:
            logger.warning("Page 2: field %s is missing or unparseable", field_name)

    return Page2Data(
        control_number=control_number,
        voter_list_count=fields["voter_list_count"],
        additional_voters=fields["additional_voters"],
        voted_count=fields["voted_count"],
        unused_ballots=fields["unused_ballots"],
        invalid_ballots=fields["invalid_ballots"],
        paper_ballots_in_box=fields["paper_ballots_in_box"],
        invalid_votes=fields["invalid_votes"],
        no_support_votes=fields["no_support_votes"],
    )


# ---------------------------------------------------------------------------
# Pages 3–4 parser — paper vote distribution
# ---------------------------------------------------------------------------

# Regex to extract a leading party number like "2.", "18.", "19. АТАКА"
_PARTY_NUM_RE = re.compile(r"^(\d+)\.")


def _extract_party_number(cell_text: str) -> int | None:
    """Extract the party number from a table cell.

    Handles both formats:
    - ``"2."`` → 2
    - ``"19. АТАКА"`` → 19
    """
    m = _PARTY_NUM_RE.match(cell_text.strip())
    if m:
        return int(m.group(1))
    return None


def _is_header_row(row: list[str]) -> bool:
    """Return True if *row* looks like a table header (e.g. '№', 'Наименование')."""
    if not row:
        return True
    first = row[0].strip().lower()
    return first in ("№", "no", "") or "наименование" in first


def _is_preference_row(row: list[str]) -> bool:
    """Return True if *row* looks like preference data (not vote data)."""
    if not row:
        return False
    # Preference header rows have candidate numbers like "101", "113"
    if row[0].strip() in ("101", "113"):
        return True
    # Rows with "Без преференции" in any cell
    if any("без преференци" in c.lower() for c in row):
        return True
    # Rows where most cells are candidate numbers (101-122)
    num_cand = sum(1 for c in row if c.strip().isdigit() and 101 <= int(c.strip()) <= 122)
    if num_cand >= 5:
        return True
    return False


def _parse_vote_table(table: list[list[str]]) -> list[VoteEntry]:
    """Extract VoteEntry items from a single parsed table."""
    entries: list[VoteEntry] = []
    for row in table:
        if not row or _is_header_row(row) or _is_preference_row(row):
            continue

        party_num = _extract_party_number(row[0])
        if party_num is None:
            continue

        # Skip total/summary rows that start with a number (e.g., "9. Общ брой")
        first_cell_lower = row[0].strip().lower()
        if "общ брой" in first_cell_lower or "действителн" in first_cell_lower or "сумирайте" in first_cell_lower:
            continue

        # Extract vote count from cells using cifri pattern
        vote_count: int | None = None
        for cell in reversed(row):
            vote_count = extract_cifri_value(cell)
            if vote_count is not None:
                break

        if vote_count is None:
            # Fallback: try extracting any numeric value from last cell
            vote_count = extract_numeric_value(row[-1])

        if vote_count is None:
            # Check if cells contain known zero patterns (—, -, empty dots)
            last_cell = row[-1].strip()
            if last_cell in ("—", "–", "-", "", "✓", "/") or last_cell == ".....\n(с цифри)":
                vote_count = 0
            elif "с цифри" in last_cell and not strip_to_digits(last_cell):
                # "(с цифри)" present but no digits — treat as 0
                vote_count = 0
            # Check if all data cells are dashes (machine vote table with no votes)
            elif len(row) > 2 and all(c.strip() in ("—", "–", "-", "", "✓", "/") for c in row[1:]):
                vote_count = 0

        if vote_count is None:
            logger.warning(
                "Vote table: could not extract vote count for party %d from row %s",
                party_num,
                row,
            )
            vote_count = 0

        entries.append(VoteEntry(party_number=party_num, vote_count=vote_count))

    return entries


def parse_total_valid_votes(divs: list[HtmlDiv]) -> int | None:
    """Extract field 18 (total valid paper votes) from page 4.

    Looks for "9. Общ брой" text and extracts the "(с цифри)" value,
    handling two layouts:
    1. A Table div containing a row with "9. Общ брой" and cifri in last cell
    2. A Text div with "9. Общ брой" followed by a separate div with cifri
    """
    # Strategy 1: Check Table divs for a row containing "9. Общ брой"
    for d in divs:
        if d.label not in ("Table", "Form"):
            continue
        for table in d.tables:
            for row in table:
                if not row:
                    continue
                first_cell = row[0].strip()
                if "9." in first_cell and "бро" in first_cell.lower():
                    # Found the total row — extract cifri from last cell
                    for cell in reversed(row):
                        val = extract_cifri_value(cell)
                        if val is not None:
                            return val

    # Strategy 2: Look for "9. Общ брой" in Text divs, then find cifri nearby
    found_total_label = False
    for i, d in enumerate(divs):
        content = d.content
        if not found_total_label:
            if "9." in content and "бро" in content.lower():
                found_total_label = True
                # Check if cifri is in this same div
                val = extract_cifri_value(content)
                if val is not None:
                    return val
        else:
            # Look in subsequent divs for cifri value
            val = extract_cifri_value(content)
            if val is not None:
                return val
            # Try standalone numeric value (no cifri label)
            stripped = content.strip()
            digits = strip_to_digits(stripped)
            if digits and digits == stripped:
                return int(digits)
            # Also check if this div is just a number (the cifri value
            # might be in a div before the "(с цифри)" label div)
            if "с цифри" in content.lower():
                # Look backwards for a numeric div
                for j in range(i - 1, max(i - 4, -1), -1):
                    prev = divs[j].content.strip()
                    digits = strip_to_digits(prev)
                    if digits and digits == prev:
                        return int(digits)
            # Stop searching after a few divs past the label
            if "контрол" in content.lower() or d.label == "Page-Footer":
                break

    logger.warning("Total valid paper votes '9. Общ брой' not found")
    return None


def parse_vote_pages(divs_list: list[list[HtmlDiv]]) -> PaperVotesData:
    """Parse vote tables from pages 3–4 and return aggregated paper votes.

    Parameters
    ----------
    divs_list : list[list[HtmlDiv]]
        A list of div lists, one per page (typically pages 3 and 4).

    Returns
    -------
    PaperVotesData
        Aggregated paper votes with control numbers and total.
    """
    all_votes: list[VoteEntry] = []
    control_numbers: list[str] = []

    for divs in divs_list:
        # Extract control number from each page
        cn = _extract_control_number(divs)
        if cn:
            control_numbers.append(cn)

        # Find Table/Form divs and extract vote rows
        for d in divs:
            if d.label not in ("Table", "Form"):
                continue
            for table in d.tables:
                entries = _parse_vote_table(table)
                all_votes.extend(entries)

    # Extract total valid votes from the last page
    total_valid: int | None = None
    if divs_list:
        total_valid = parse_total_valid_votes(divs_list[-1])

    return PaperVotesData(
        control_numbers=control_numbers,
        votes=all_votes,
        total_valid_paper_votes=total_valid,
    )


# ---------------------------------------------------------------------------
# Pages 5–7 parser — paper preference votes
# ---------------------------------------------------------------------------

# Regex to extract a leading party number like "2.", "18.", "21. ПРЯКА ДЕМОКРАЦИЯ"
_PREF_PARTY_NUM_RE = re.compile(r"^(\d+)\.")


def _safe_int(text: str) -> int:
    """Convert *text* to int, returning 0 and logging a warning on failure."""
    stripped = text.strip()
    if not stripped:
        return 0
    # Treat em-dash, en-dash, hyphen-minus as zero (common OCR pattern for empty fields)
    if stripped in ("—", "–", "-", "✓", "/"):
        return 0
    # Common OCR misreads of digits
    if stripped in ("^", "і", "l", "|", "I", "А", "Л"):
        return 1
    if stripped in ("О", "O", "о", "o"):
        return 0
    digits = strip_to_digits(stripped)
    if digits:
        return int(digits)
    # Only warn for truly unexpected non-numeric values (not party names or known patterns)
    if len(stripped) > 1 and not stripped[0].isdigit():
        # Likely a party name leaking into a vote cell — suppress noisy warning
        logger.debug("Non-numeric preference value: %r, recording as 0", stripped)
    else:
        logger.warning("Non-numeric preference value: %r, recording as 0", stripped)
    return 0


def _is_candidate_header_row(row: list[str]) -> bool:
    """Return True if *row* looks like a candidate number header (101–122)."""
    if not row:
        return False
    first = row[0].strip()
    return first in ("101", "113")


def _is_bez_pref_header_row(row: list[str]) -> bool:
    """Return True if *row* contains candidate headers 113–122 + 'Без преференции'."""
    if len(row) < 2:
        return False
    return row[0].strip() == "113" and any("без преференци" in c.lower() for c in row)


def _is_table_header_row(row: list[str]) -> bool:
    """Return True if *row* is the top-level table header (№, Наименование, ...)."""
    if not row:
        return True
    first = row[0].strip().lower()
    return first in ("№", "no", "") or "наименование" in first or "брой отбелязани" in first


def _parse_preference_table(table: list[list[str]], num_candidates: int = 22) -> tuple[list[PreferenceEntry], dict[int, int]]:
    """Extract PreferenceEntry items and "Без преференции" values from a table.

    Dynamically detects the table layout by looking for candidate number
    patterns (101-199) in header rows.
    """
    entries: list[PreferenceEntry] = []
    bez: dict[int, int] = {}
    rows = table
    if not rows:
        return entries, bez

    # --- Detect candidate numbers from any header-like row ---
    # Look for a row where most cells are candidate numbers (101-199) or "Без преференции"
    candidate_numbers: list[int] = []
    for row in rows:
        if not row:
            continue
        cands = []
        has_bez = False
        for c in row:
            s = c.strip()
            if s.isdigit() and 101 <= int(s) <= 199:
                cands.append(int(s))
            if "без преференци" in s.lower():
                has_bez = True
        if cands and has_bez:
            candidate_numbers = cands
            break

    # If no candidate header found, use the region's candidate count
    if not candidate_numbers:
        candidate_numbers = list(range(101, 101 + num_candidates))

    num_cands = len(candidate_numbers)

    # --- Parse party rows ---
    i = 0
    while i < len(rows):
        row = rows[i]
        if not row:
            i += 1
            continue

        # Skip table headers and standalone candidate header rows
        if _is_table_header_row(row):
            i += 1
            continue

        # Skip rows that are purely candidate number headers
        cand_count = sum(1 for c in row if c.strip().isdigit() and 101 <= int(c.strip()) <= 199)
        if cand_count >= 3 and not _PREF_PARTY_NUM_RE.match(row[0].strip()):
            i += 1
            continue

        # Try to match a party number
        m = _PREF_PARTY_NUM_RE.match(row[0].strip())
        if not m:
            i += 1
            continue

        party_num = int(m.group(1))

        # Determine if this row contains votes or candidate headers
        # Check if cells after party name/number are candidate numbers
        has_cand_headers = False
        if len(row) > 2:
            test_cells = [c.strip() for c in row[1:] if c.strip()]
            cand_in_row = sum(1 for c in test_cells if c.isdigit() and 101 <= int(c) <= 199)
            has_cand_headers = cand_in_row >= 3

        if has_cand_headers:
            # This row has [party, (name?), 101, 102, ..., N, ...]
            # Extract candidate numbers from this row
            row_cands = []
            for c in row:
                s = c.strip()
                if s.isdigit() and 101 <= int(s) <= 199:
                    row_cands.append(int(s))

            # Find the vote row — skip any intermediate header/empty rows
            vote_row_idx = i + 1
            while vote_row_idx < len(rows):
                candidate_row = rows[vote_row_idx]
                # Check if this row is another candidate header (113, 114, ...)
                if candidate_row and candidate_row[0].strip().isdigit() and 101 <= int(candidate_row[0].strip()) <= 199:
                    # This is a header for more candidates — extract them
                    for c in candidate_row:
                        s = c.strip()
                        if s.isdigit() and 101 <= int(s) <= 199 and int(s) not in row_cands:
                            row_cands.append(int(s))
                    vote_row_idx += 1
                    continue
                break

            # Read votes from the vote row
            if vote_row_idx < len(rows):
                vote_row = rows[vote_row_idx]
                votes = [_safe_int(vote_row[ci]) for ci in range(min(len(row_cands), len(vote_row)))]
                while len(votes) < len(row_cands):
                    votes.append(0)
                # Bez: check if header had "Без преференции"
                bez_val = 0
                has_bez_in_header = any("без преференци" in c.lower() for c in row) or \
                    any("без преференци" in c.lower() for r in rows[i+1:vote_row_idx] for c in r)
                if has_bez_in_header and len(vote_row) > len(row_cands):
                    bez_val = _safe_int(vote_row[len(row_cands)])
                bez[party_num] = bez.get(party_num, 0) + bez_val
                for ci, vote in enumerate(votes):
                    if ci < len(row_cands):
                        entries.append(PreferenceEntry(party_num, row_cands[ci], vote))
                i = vote_row_idx + 1
            else:
                i += 1

            # After reading first batch of votes, check for 113+ header + votes
            while i < len(rows):
                next_row = rows[i]
                if not next_row:
                    i += 1
                    continue
                # Skip empty rows (all cells empty or X)
                if all(c.strip() == '' or c.strip() == 'X' for c in next_row):
                    i += 1
                    continue
                # Check if this is a 113+ candidate header (not a party row)
                has_party_next = _PREF_PARTY_NUM_RE.match(next_row[0].strip()) if next_row else False
                if not has_party_next and next_row[0].strip() == "113":
                    # This is a 113+ header — extract candidates and read next row for votes
                    extra_cands = [int(c.strip()) for c in next_row
                                   if c.strip().isdigit() and 113 <= int(c.strip()) <= 199]
                    has_bez = any("без преференци" in c.lower() for c in next_row)
                    if i + 1 < len(rows):
                        extra_vote_row = rows[i + 1]
                        for ci in range(len(extra_cands)):
                            if ci < len(extra_vote_row):
                                entries.append(PreferenceEntry(party_num, extra_cands[ci], _safe_int(extra_vote_row[ci])))
                            else:
                                entries.append(PreferenceEntry(party_num, extra_cands[ci], 0))
                        # Bez value
                        if has_bez:
                            bez_pos = len(extra_cands)
                            for hi, hc in enumerate(next_row):
                                if "без преференци" in hc.lower():
                                    bez_pos = hi
                                    break
                            if bez_pos < len(extra_vote_row):
                                bez[party_num] = bez.get(party_num, 0) + _safe_int(extra_vote_row[bez_pos])
                        i += 2
                    else:
                        i += 1
                    continue
                # Skip other candidate-only header rows (101-112 headers between parties)
                if not has_party_next:
                    cand_test = sum(1 for c in next_row if c.strip().isdigit() and 101 <= int(c.strip()) <= 199)
                    if cand_test >= 3:
                        i += 1
                        continue
                break
            continue

        # Pattern A: 14-cell row with party + name + 12 vote values (101-112)
        # This is the standard 22-candidate layout
        if len(row) >= 14 and not has_cand_headers:
            m2 = _PREF_PARTY_NUM_RE.match(row[0].strip())
            if m2:
                votes_101_112 = [_safe_int(row[c]) for c in range(2, 14)]

                # Look for 113+ header within next few rows
                bez_header_offset = -1
                for check in range(i + 1, min(i + 4, len(rows))):
                    if check < len(rows) and rows[check] and rows[check][0].strip() == "113":
                        bez_header_offset = check
                        break

                extra_votes = []
                bez_pref_val = 0
                if bez_header_offset >= 0:
                    header_row = rows[bez_header_offset]
                    extra_cands = [int(c.strip()) for c in header_row
                                   if c.strip().isdigit() and 113 <= int(c.strip()) <= 199]
                    if bez_header_offset + 1 < len(rows):
                        vote_row = rows[bez_header_offset + 1]
                        extra_votes = [_safe_int(vote_row[ci]) for ci in range(min(len(extra_cands), len(vote_row)))]
                        while len(extra_votes) < len(extra_cands):
                            extra_votes.append(0)
                        # Bez value at the position after candidate votes
                        bez_pos = -1
                        for hi, hc in enumerate(header_row):
                            if "без преференци" in hc.lower():
                                bez_pos = hi
                                break
                        if bez_pos >= 0 and bez_pos < len(vote_row):
                            bez_pref_val = _safe_int(vote_row[bez_pos])
                        elif len(extra_cands) < len(vote_row):
                            bez_pref_val = _safe_int(vote_row[len(extra_cands)])
                    i = bez_header_offset + 2
                    # Skip trailing 101-112 header
                    if i < len(rows) and rows[i] and rows[i][0].strip() == "101":
                        i += 1
                else:
                    i += 1

                bez[party_num] = bez.get(party_num, 0) + bez_pref_val
                for ci, vote in enumerate(votes_101_112):
                    entries.append(PreferenceEntry(party_num, 101 + ci, vote))
                for ci, vote in enumerate(extra_votes):
                    entries.append(PreferenceEntry(party_num, extra_cands[ci], vote))
                continue

        # Check if this is a single-row pattern (votes inline with party)
        # Row: [party_num, party_name, vote_1, ..., vote_N, bez]
        if len(row) >= num_cands + 2:
            votes = [_safe_int(row[2 + ci]) for ci in range(num_cands)]
            bez_idx = 2 + num_cands
            bez_val = _safe_int(row[bez_idx]) if bez_idx < len(row) else 0
            bez[party_num] = bez.get(party_num, 0) + bez_val
            for ci, vote in enumerate(votes):
                entries.append(PreferenceEntry(party_num, candidate_numbers[ci], vote))
            i += 1

            # For Pattern A: check for 113+ header + vote rows
            # The bez header might be at i (right after votes) or i+1 (after empty continuation row)
            if num_cands == 12:
                bez_header_offset = -1
                for check in range(i, min(i + 3, len(rows))):
                    if check < len(rows) and _is_bez_pref_header_row(rows[check]):
                        bez_header_offset = check
                        break
                    # Also check for partial bez header (113, 114, ... with fewer candidates)
                    if check < len(rows) and rows[check] and rows[check][0].strip() == "113":
                        bez_header_offset = check
                        break

                if bez_header_offset >= 0:
                    header_row = rows[bez_header_offset]
                    # Extract candidate numbers from header
                    extra_cands = [int(c.strip()) for c in header_row
                                   if c.strip().isdigit() and 113 <= int(c.strip()) <= 199]
                    if bez_header_offset + 1 < len(rows):
                        vote_row = rows[bez_header_offset + 1]
                        for ci in range(len(extra_cands)):
                            if ci < len(vote_row):
                                entries.append(PreferenceEntry(party_num, extra_cands[ci], _safe_int(vote_row[ci])))
                            else:
                                entries.append(PreferenceEntry(party_num, extra_cands[ci], 0))
                        # Bez value: find "Без преференции" position in header
                        bez_pos = -1
                        for hi, hc in enumerate(header_row):
                            if "без преференци" in hc.lower():
                                bez_pos = hi
                                break
                        if bez_pos >= 0 and bez_pos < len(vote_row):
                            bez[party_num] = bez.get(party_num, 0) + _safe_int(vote_row[bez_pos])
                        elif len(extra_cands) < len(vote_row):
                            # Bez is after the candidate votes
                            bez[party_num] = bez.get(party_num, 0) + _safe_int(vote_row[len(extra_cands)])
                    i = bez_header_offset + 2
                    # Skip trailing 101-112 header
                    if i < len(rows) and rows[i] and rows[i][0].strip() == "101":
                        i += 1
            continue

        i += 1

    return entries, bez


def parse_preference_pages(divs_list: list[list[HtmlDiv]], num_candidates: int = 22) -> PaperPreferencesData:
    """Parse preference tables from pages 5-7 and return aggregated paper preferences.

    Parameters
    ----------
    divs_list : list[list[HtmlDiv]]
        A list of div lists, one per page (typically pages 5, 6, and 7).

    Returns
    -------
    PaperPreferencesData
        Aggregated paper preferences with control numbers and preferences list.
    """
    all_preferences: list[PreferenceEntry] = []
    all_bez: dict[int, int] = {}
    control_numbers: list[str] = []

    for divs in divs_list:
        cn = _extract_control_number(divs)
        if cn:
            control_numbers.append(cn)

        for d in divs:
            if d.label not in ("Table", "Form"):
                continue
            for table in d.tables:
                entries, bez = _parse_preference_table(table, num_candidates)
                all_preferences.extend(entries)
                for pn, val in bez.items():
                    all_bez[pn] = all_bez.get(pn, 0) + val

    return PaperPreferencesData(
        control_numbers=control_numbers,
        preferences=all_preferences,
        bez_preferentsii=all_bez,
    )


# ---------------------------------------------------------------------------
# Page 7 bottom — machine fields (Form 26/30 only)
# ---------------------------------------------------------------------------


def parse_machine_fields_page7(divs: list[HtmlDiv]) -> tuple[int | None, int | None]:
    """Extract field 19 (machine ballots in box) and field 20 (machine no-support votes) from page 7.

    Field 19: "11. Брой на намерените в избирателната кутия бюлетини от машинно гласуване"
    Field 20: "12. Брой на действителните гласове от бюлетини от машинно гласуване с отбелязан вот „Не подкрепям никого""

    These fields appear at the bottom of page 7 after the section header
    "ПРЕБРОЯВАНЕ НА ГЛАСОВЕТЕ ОТ БЮЛЕТИНИТЕ ОТ МАШИННО ГЛАСУВАНЕ".
    The page may be truncated, so these fields might not be available.
    """
    machine_ballots: int | None = None
    no_support: int | None = None

    # Find the machine section header to scope our search
    machine_section_idx = -1
    for idx, d in enumerate(divs):
        if d.label == "Section-Header" and "машинно гласуване" in d.content.lower():
            machine_section_idx = idx
            break

    # Look for Form/Table divs AFTER the machine section header
    if machine_section_idx >= 0:
        for d in divs[machine_section_idx + 1:]:
            if d.label in ("Form", "Table"):
                for table in d.tables:
                    rows = table
                    for ri, row in enumerate(rows):
                        if not row:
                            continue

                        # Check for side-by-side layout: [11. ..., 12. ...] in same row
                        col_11 = -1
                        col_12 = -1
                        for ci, cell in enumerate(row):
                            if re.match(r"^11\.\s", cell.strip()):
                                col_11 = ci
                            elif re.match(r"^12\.\s", cell.strip()):
                                col_12 = ci
                        if col_11 >= 0 and col_12 >= 0:
                            # Side-by-side headers: field 11 values in next row, field 12 in row after
                            if ri + 1 < len(rows) and machine_ballots is None:
                                for cell in rows[ri + 1]:
                                    val = extract_cifri_value(cell)
                                    if val is not None:
                                        machine_ballots = val
                                        break
                            if ri + 2 < len(rows) and no_support is None:
                                for cell in rows[ri + 2]:
                                    val = extract_cifri_value(cell)
                                    if val is not None:
                                        no_support = val
                                        break
                            continue

                        # Standard layout: 11. and 12. as row labels
                        label = row[0].strip()
                        if re.match(r"^11\.\s", label) and machine_ballots is None:
                            for cell in reversed(row):
                                val = extract_cifri_value(cell)
                                if val is not None:
                                    machine_ballots = val
                                    break
                            if machine_ballots is None and ri + 1 < len(rows):
                                for cell in reversed(rows[ri + 1]):
                                    val = extract_cifri_value(cell)
                                    if val is not None:
                                        machine_ballots = val
                                        break
                        elif re.match(r"^12\.\s", label) and no_support is None:
                            for cell in reversed(row):
                                val = extract_cifri_value(cell)
                                if val is not None:
                                    no_support = val
                                    break
                            if no_support is None and ri + 1 < len(rows):
                                for cell in reversed(rows[ri + 1]):
                                    val = extract_cifri_value(cell)
                                    if val is not None:
                                        no_support = val
                                        break

    # Also check Text divs after the machine section header
    if machine_ballots is None or no_support is None:
        for i in range(max(machine_section_idx + 1, 0), len(divs)):
            d = divs[i]
            content = d.content

            if machine_ballots is None and "11." in content:
                val = extract_cifri_value(content)
                if val is not None:
                    machine_ballots = val
                    continue
                for j in range(i + 1, min(i + 5, len(divs))):
                    val = extract_cifri_value(divs[j].content)
                    if val is not None:
                        machine_ballots = val
                        break
                    if "с цифри" in divs[j].content.lower():
                        for k in range(j - 1, max(j - 4, -1), -1):
                            prev = divs[k].content.strip()
                            digits = strip_to_digits(prev)
                            if digits and digits == prev:
                                machine_ballots = int(digits)
                                break
                        break

            if no_support is None and "12." in content:
                val = extract_cifri_value(content)
                if val is not None:
                    no_support = val
                    continue
                for j in range(i + 1, min(i + 5, len(divs))):
                    val = extract_cifri_value(divs[j].content)
                    if val is not None:
                        no_support = val
                        break
                    if "с цифри" in divs[j].content.lower():
                        for k in range(j - 1, max(j - 4, -1), -1):
                            prev = divs[k].content.strip()
                            digits = strip_to_digits(prev)
                            if digits and digits == prev:
                                no_support = int(digits)
                                break
                        break

    if machine_ballots is None:
        logger.debug("Machine ballots in box (field 19) not found in provided divs")
    if no_support is None:
        logger.debug("Machine no-support votes (field 20) not found in provided divs")

    return machine_ballots, no_support


# ---------------------------------------------------------------------------
# Pages 8–9 parser — machine vote distribution (Form 26/30 only)
# ---------------------------------------------------------------------------


def _parse_total_valid_machine_votes(divs: list[HtmlDiv]) -> int | None:
    """Extract field 21 (total valid machine votes) from page 9.

    Looks for "14. Общ брой" text and extracts the "(с цифри)" value.
    Same logic as parse_total_valid_votes but looks for "14." instead of "9.".
    """
    # Strategy 1: Check Table/Form divs for a row containing "14. Общ брой"
    for d in divs:
        if d.label not in ("Table", "Form"):
            continue
        for table in d.tables:
            for row in table:
                if not row:
                    continue
                first_cell = row[0].strip()
                if "14." in first_cell and "бро" in first_cell.lower():
                    for cell in reversed(row):
                        val = extract_cifri_value(cell)
                        if val is not None:
                            return val

    # Strategy 2: Look for "14. Общ брой" in Text divs
    found_total_label = False
    for i, d in enumerate(divs):
        content = d.content
        if not found_total_label:
            if "14." in content and "бро" in content.lower():
                found_total_label = True
                val = extract_cifri_value(content)
                if val is not None:
                    return val
        else:
            # Try cifri pattern first
            val = extract_cifri_value(content)
            if val is not None:
                return val
            # Try standalone numeric value (no cifri label)
            stripped = content.strip()
            digits = strip_to_digits(stripped)
            if digits and digits == stripped:
                return int(digits)
            if "с цифри" in content.lower():
                for j in range(i - 1, max(i - 4, -1), -1):
                    prev = divs[j].content.strip()
                    d2 = strip_to_digits(prev)
                    if d2 and d2 == prev:
                        return int(d2)
            if "контрол" in content.lower() or d.label == "Page-Footer":
                break

    logger.debug("Total valid machine votes '14. Общ брой' not found in provided divs")
    return None


def parse_machine_vote_pages(
    divs_list: list[list[HtmlDiv]],
    page7_divs: list[HtmlDiv] | None = None,
) -> MachineVotesData:
    """Parse machine vote tables from pages 8–9 and return machine votes data.

    Parameters
    ----------
    divs_list : list[list[HtmlDiv]]
        A list of div lists, one per page (typically pages 8 and 9).
    page7_divs : list[HtmlDiv] | None
        Optional divs from page 7 to extract machine fields (19, 20).

    Returns
    -------
    MachineVotesData
        Machine votes with control numbers, votes, and machine-specific fields.
    """
    all_votes: list[VoteEntry] = []
    control_numbers: list[str] = []

    # Extract machine fields from page 7 if provided
    machine_ballots: int | None = None
    no_support: int | None = None
    if page7_divs is not None:
        machine_ballots, no_support = parse_machine_fields_page7(page7_divs)

    # If fields not found on page 7, also try page 8 (layout varies by section)
    if (machine_ballots is None or no_support is None) and divs_list:
        mb2, ns2 = parse_machine_fields_page7(divs_list[0])
        if machine_ballots is None and mb2 is not None:
            machine_ballots = mb2
        if no_support is None and ns2 is not None:
            no_support = ns2

    for divs in divs_list:
        cn = _extract_control_number(divs)
        if cn:
            control_numbers.append(cn)

        # Find Table and Form divs and extract vote rows
        for d in divs:
            if d.label not in ("Table", "Form"):
                continue
            for table in d.tables:
                entries = _parse_vote_table(table)
                all_votes.extend(entries)

    # Extract total valid machine votes — search all pages, not just last
    total_valid: int | None = None
    for divs in reversed(divs_list):
        total_valid = _parse_total_valid_machine_votes(divs)
        if total_valid is not None:
            break

    return MachineVotesData(
        control_numbers=control_numbers,
        votes=all_votes,
        machine_ballots_in_box=machine_ballots,
        no_support_votes_machine=no_support,
        total_valid_machine_votes=total_valid,
    )


# ---------------------------------------------------------------------------
# Pages 10–14 parser — machine preference votes (Form 26/30 only)
# ---------------------------------------------------------------------------


def parse_machine_preference_pages(
    divs_list: list[list[HtmlDiv]], num_candidates: int = 22,
) -> MachinePreferencesData:
    """Parse machine preference tables from pages 10–14."""
    paper_result = parse_preference_pages(divs_list, num_candidates)

    return MachinePreferencesData(
        control_numbers=paper_result.control_numbers,
        preferences=paper_result.preferences,
        bez_preferentsii=paper_result.bez_preferentsii,
    )
