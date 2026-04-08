"""Property-based tests for protocol parsing.

# Feature: election-data-validator, Property 1: Protocol parsing preserves field values
"""

import os
import sqlite3
import tempfile

from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from loader import DataLoader, PAPER_ONLY_FORMS, MACHINE_FORMS


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

form_number_st = st.sampled_from([24, 26, 28, 30])
section_code_st = st.from_regex(r"[0-9]{9}", fullmatch=True)
rik_code_st = st.integers(min_value=1, max_value=99)
page_numbers_st = st.text(
    alphabet=st.sampled_from("ABCDEFG0123456789|"),
    min_size=1,
    max_size=20,
)
nonneg_int_st = st.integers(min_value=0, max_value=100_000)


@st.composite
def protocol_row_st(draw):
    """Generate a random protocol row as (form_number, field_dict, raw_line)."""
    form = draw(form_number_st)
    section = draw(section_code_st)
    rik = draw(rik_code_st)
    pages = draw(page_numbers_st)

    received_ballots = draw(nonneg_int_st)
    voters_in_list = draw(nonneg_int_st)
    voters_supplementary = draw(nonneg_int_st)
    voters_voted = draw(nonneg_int_st)
    unused_ballots = draw(nonneg_int_st)
    spoiled_ballots = draw(nonneg_int_st)
    ballots_in_box = draw(nonneg_int_st)
    invalid_votes = draw(nonneg_int_st)
    valid_no_support = draw(nonneg_int_st)
    total_valid_party_votes = draw(nonneg_int_st)

    expected = {
        "form_number": form,
        "section_code": section,
        "rik_code": rik,
        "page_numbers": pages,
        "received_ballots": received_ballots,
        "voters_in_list": voters_in_list,
        "voters_supplementary": voters_supplementary,
        "voters_voted": voters_voted,
        "unused_ballots": unused_ballots,
        "spoiled_ballots": spoiled_ballots,
        "ballots_in_box": ballots_in_box,
        "invalid_votes": invalid_votes,
        "valid_no_support": valid_no_support,
        "total_valid_party_votes": total_valid_party_votes,
    }

    # Build semicolon-delimited line: positions 4,5,8,9 are empty
    parts = [
        str(form),              # 0
        section,                # 1
        str(rik),               # 2
        pages,                  # 3
        "",                     # 4 (empty)
        "",                     # 5 (empty)
        str(received_ballots),  # 6
        str(voters_in_list),    # 7
        "",                     # 8 (empty)
        "",                     # 9 (empty)
        str(voters_supplementary),    # 10
        str(voters_voted),            # 11
        str(unused_ballots),          # 12
        str(spoiled_ballots),         # 13
        str(ballots_in_box),          # 14
        str(invalid_votes),           # 15
        str(valid_no_support),        # 16
        str(total_valid_party_votes), # 17
    ]

    if form in MACHINE_FORMS:
        machine_ballots = draw(nonneg_int_st)
        machine_no_support = draw(nonneg_int_st)
        machine_valid = draw(nonneg_int_st)
        parts.extend([
            str(machine_ballots),     # 18
            str(machine_no_support),  # 19
            str(machine_valid),       # 20
        ])
        expected["machine_ballots_in_box"] = machine_ballots
        expected["machine_no_support"] = machine_no_support
        expected["machine_valid_party_votes"] = machine_valid
    else:
        expected["machine_ballots_in_box"] = None
        expected["machine_no_support"] = None
        expected["machine_valid_party_votes"] = None

    line = ";".join(parts)
    return expected, line


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_loader_with_protocol(line: str):
    """Create a DataLoader with a single protocol line in a temp directory."""
    tmpdir = tempfile.mkdtemp()
    data_dir = os.path.join(tmpdir, "data")
    os.makedirs(data_dir)

    # Create all required stub files
    stub_files = [
        "cik_parties_27.10.2024.txt",
        "local_parties_27.10.2024.txt",
        "local_candidates_27.10.2024.txt",
        "sections_27.10.2024.txt",
        "votes_27.10.2024.txt",
        "preferences_27.10.2024.txt",
    ]
    for fname in stub_files:
        with open(os.path.join(data_dir, fname), "w", encoding="utf-8") as f:
            f.write("")

    # Write protocol file
    with open(
        os.path.join(data_dir, "protocols_27.10.2024.txt"), "w", encoding="utf-8"
    ) as f:
        f.write(line + "\n")

    db_path = os.path.join(tmpdir, "test.db")
    loader = DataLoader(db_path, data_dir)
    return loader, tmpdir


# ---------------------------------------------------------------------------
# Property 1: Protocol parsing preserves field values
# **Validates: Requirements 1.4**
# ---------------------------------------------------------------------------

@given(data=protocol_row_st())
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_protocol_parsing_preserves_field_values(data):
    """For any valid protocol row, parsing and reading back each named field
    should yield the same values as the original positional columns."""
    expected, line = data

    loader, tmpdir = _make_loader_with_protocol(line)
    try:
        count = loader._load_protocols()
        assert count == 1, f"Expected 1 row loaded, got {count}"

        row = loader.conn.execute(
            "SELECT form_number, section_code, rik_code, page_numbers, "
            "received_ballots, voters_in_list, voters_supplementary, voters_voted, "
            "unused_ballots, spoiled_ballots, ballots_in_box, "
            "invalid_votes, valid_no_support, total_valid_party_votes, "
            "machine_ballots_in_box, machine_no_support, machine_valid_party_votes "
            "FROM protocols"
        ).fetchone()

        assert row is not None, "No protocol row found in database"

        col_names = [
            "form_number", "section_code", "rik_code", "page_numbers",
            "received_ballots", "voters_in_list", "voters_supplementary",
            "voters_voted", "unused_ballots", "spoiled_ballots", "ballots_in_box",
            "invalid_votes", "valid_no_support", "total_valid_party_votes",
            "machine_ballots_in_box", "machine_no_support",
            "machine_valid_party_votes",
        ]

        for i, col in enumerate(col_names):
            assert row[i] == expected[col], (
                f"Field {col}: expected {expected[col]!r}, got {row[i]!r}"
            )
    finally:
        loader.conn.close()
