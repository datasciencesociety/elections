"""Property-based tests for votes normalization.

# Feature: election-data-validator, Property 2: Votes normalization round-trip
"""

import os
import tempfile

from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from loader import DataLoader


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

form_number_st = st.sampled_from([24, 26, 28, 30])
section_code_st = st.from_regex(r"[0-9]{9}", fullmatch=True)
admin_unit_id_st = st.integers(min_value=1, max_value=9999)
nonneg_int_st = st.integers(min_value=0, max_value=100_000)


@st.composite
def party_group_st(draw, used_party_numbers):
    """Generate a single party group with a unique party_number."""
    # Pick a party number not yet used
    party_number = draw(
        st.integers(min_value=1, max_value=999).filter(
            lambda x: x not in used_party_numbers
        )
    )
    used_party_numbers.add(party_number)
    total_votes = draw(nonneg_int_st)
    paper_votes = draw(nonneg_int_st)
    machine_votes = draw(nonneg_int_st)
    return (party_number, total_votes, paper_votes, machine_votes)


@st.composite
def votes_row_st(draw):
    """Generate a random votes row as (expected_groups, raw_line).

    Returns a list of (party_number, total_votes, paper_votes, machine_votes)
    tuples and the semicolon-delimited line string.
    """
    form = draw(form_number_st)
    section = draw(section_code_st)
    admin_unit = draw(admin_unit_id_st)
    n_parties = draw(st.integers(min_value=1, max_value=28))

    used = set()
    groups = []
    for _ in range(n_parties):
        g = draw(party_group_st(used))
        groups.append(g)

    # Build the semicolon-delimited line
    parts = [str(form), section, str(admin_unit)]
    for party_num, total, paper, machine in groups:
        parts.extend([str(party_num), str(total), str(paper), str(machine)])

    line = ";".join(parts)

    header = {
        "form_number": form,
        "section_code": section,
        "admin_unit_id": admin_unit,
    }
    return header, groups, line


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_loader_with_votes(line: str):
    """Create a DataLoader with a single votes line in a temp directory."""
    tmpdir = tempfile.mkdtemp()
    data_dir = os.path.join(tmpdir, "data")
    os.makedirs(data_dir)

    # Create all required stub files
    stub_files = [
        "cik_parties_27.10.2024.txt",
        "local_parties_27.10.2024.txt",
        "local_candidates_27.10.2024.txt",
        "sections_27.10.2024.txt",
        "protocols_27.10.2024.txt",
        "preferences_27.10.2024.txt",
    ]
    for fname in stub_files:
        with open(os.path.join(data_dir, fname), "w", encoding="utf-8") as f:
            f.write("")

    # Write votes file
    with open(
        os.path.join(data_dir, "votes_27.10.2024.txt"), "w", encoding="utf-8"
    ) as f:
        f.write(line + "\n")

    db_path = os.path.join(tmpdir, "test.db")
    loader = DataLoader(db_path, data_dir)
    return loader, tmpdir


# ---------------------------------------------------------------------------
# Property 2: Votes normalization round-trip
# **Validates: Requirements 1.5**
# ---------------------------------------------------------------------------

@given(data=votes_row_st())
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_votes_normalization_round_trip(data):
    """For any valid votes row with N party groups, normalizing and reading
    back should produce exactly N rows with matching field values."""
    header, groups, line = data

    loader, tmpdir = _make_loader_with_votes(line)
    try:
        count = loader._load_votes()
        assert count == len(groups), (
            f"Expected {len(groups)} rows loaded, got {count}"
        )

        rows = loader.conn.execute(
            "SELECT form_number, section_code, admin_unit_id, "
            "party_number, total_votes, paper_votes, machine_votes "
            "FROM votes ORDER BY party_number"
        ).fetchall()

        assert len(rows) == len(groups), (
            f"Expected {len(groups)} rows in DB, got {len(rows)}"
        )

        # Sort groups by party_number to match ORDER BY
        sorted_groups = sorted(groups, key=lambda g: g[0])

        for i, (row, group) in enumerate(zip(rows, sorted_groups)):
            db_form, db_section, db_admin, db_party, db_total, db_paper, db_machine = row
            exp_party, exp_total, exp_paper, exp_machine = group

            assert db_form == header["form_number"], (
                f"Row {i}: form_number expected {header['form_number']}, got {db_form}"
            )
            assert db_section == header["section_code"], (
                f"Row {i}: section_code expected {header['section_code']}, got {db_section}"
            )
            assert db_admin == header["admin_unit_id"], (
                f"Row {i}: admin_unit_id expected {header['admin_unit_id']}, got {db_admin}"
            )
            assert db_party == exp_party, (
                f"Row {i}: party_number expected {exp_party}, got {db_party}"
            )
            assert db_total == exp_total, (
                f"Row {i}: total_votes expected {exp_total}, got {db_total}"
            )
            assert db_paper == exp_paper, (
                f"Row {i}: paper_votes expected {exp_paper}, got {db_paper}"
            )
            assert db_machine == exp_machine, (
                f"Row {i}: machine_votes expected {exp_machine}, got {db_machine}"
            )
    finally:
        loader.conn.close()
