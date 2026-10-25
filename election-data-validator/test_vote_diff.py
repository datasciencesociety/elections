"""Property-based and unit/integration tests for vote_diff.py.

# Feature: vote-difference-comparison, Property 1: Year extraction and ordering
# Feature: vote-difference-comparison, Property 2: Cross-year party name resolution
# Feature: vote-difference-comparison, Property 3: Vote difference computation
# Feature: vote-difference-comparison, Property 4: Output sign formatting
# Feature: vote-difference-comparison, Property 5: Output sorting
"""

import os
import sqlite3
import tempfile
import shutil

import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from vote_diff import extract_year, resolve_party, compute_differences, format_difference, main
from validator import SQLITE_SCHEMA


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

year_st = st.integers(min_value=2000, max_value=2099)
party_number_st = st.integers(min_value=1, max_value=999)
section_code_st = st.from_regex(r"[0-9]{9}", fullmatch=True)
vote_count_st = st.integers(min_value=0, max_value=100_000)
diff_st = st.integers(min_value=-100_000, max_value=100_000)
party_name_st = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "Zs"), min_codepoint=65, max_codepoint=1200),
    min_size=1,
    max_size=50,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_db() -> sqlite3.Connection:
    """Create an in-memory SQLite DB with the election schema."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(SQLITE_SCHEMA)
    return conn


def _make_data_folder(year: int, cik_parties: list[tuple[int, str]],
                      votes: list[tuple[str, int, int]]) -> str:
    """Create a minimal data folder with all 7 required files for DataLoader.

    Args:
        year: The election year (used in filenames).
        cik_parties: List of (party_number, party_name).
        votes: List of (section_code, party_number, total_votes).

    Returns:
        Path to the temporary data folder.
    """
    tmpdir = tempfile.mkdtemp()
    date_str = f"01.01.{year}"

    # cik_parties
    lines = [f"{pn};{name}" for pn, name in cik_parties]
    _write_file(tmpdir, f"cik_parties_{date_str}.txt", lines)


    # votes: form_number;section_code;admin_unit_id;party1;votes1;paper1;machine1;...
    vote_lines = []
    # Group votes by section_code
    sections_map: dict[str, list[tuple[int, int]]] = {}
    for sc, pn, tv in votes:
        sections_map.setdefault(sc, []).append((pn, tv))
    for sc, party_votes in sections_map.items():
        parts = ["26", sc, "1"]
        for pn, tv in party_votes:
            parts.extend([str(pn), str(tv), str(tv), "0"])
        vote_lines.append(";".join(parts))
    _write_file(tmpdir, f"votes_{date_str}.txt", vote_lines)

    # sections
    section_codes = set(sc for sc, _, _ in votes)
    section_lines = [
        f"{sc};1;01. TEST;1234;TestCity;Test Address;0;0;1"
        for sc in sorted(section_codes)
    ] if section_codes else ["010100001;1;01. TEST;1234;TestCity;Test Address;0;0;1"]
    _write_file(tmpdir, f"sections_{date_str}.txt", section_lines)

    # protocols
    protocol_lines = [
        f"26;{sc};1;|0000001;;;100;100;0;50;50;0;25;0;0;25;25;0;25"
        for sc in sorted(section_codes)
    ] if section_codes else ["26;010100001;1;|0000001;;;100;100;0;50;50;0;25;0;0;25;25;0;25"]
    _write_file(tmpdir, f"protocols_{date_str}.txt", protocol_lines)

    # local_parties (minimal)
    _write_file(tmpdir, f"local_parties_{date_str}.txt",
                [f"1;01. TEST;{pn};{name}" for pn, name in cik_parties])

    # local_candidates (minimal)
    _write_file(tmpdir, f"local_candidates_{date_str}.txt",
                [f"1;01. TEST;{pn};{name};101;Candidate Name;" for pn, name in cik_parties])

    # preferences (minimal)
    pref_lines = []
    for sc, pn, tv in votes:
        pref_lines.append(f"26;{sc};{pn};101;{tv};{tv};0")
    if not pref_lines:
        pref_lines = ["26;010100001;1;101;0;0;0"]
    _write_file(tmpdir, f"preferences_{date_str}.txt", pref_lines)

    return tmpdir


def _write_file(directory: str, filename: str, lines: list[str]) -> None:
    """Write lines to a file in the given directory."""
    filepath = os.path.join(directory, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n" if lines else "\n")


# ===========================================================================
# Task 7: Property-Based Tests
# ===========================================================================


class TestProperty1YearExtractionAndOrdering:
    """Feature: vote-difference-comparison, Property 1: Year extraction and ordering

    **Validates: Requirements 2.1, 2.2**

    For any two distinct years, ordering is correct regardless of argument order.
    """

    @given(
        year_a=year_st,
        year_b=year_st.filter(lambda y: True),  # will filter in test body
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
    def test_year_extraction_returns_correct_year(self, year_a, year_b):
        """extract_year returns the year embedded in the filename."""
        tmpdir = tempfile.mkdtemp()
        try:
            # Create a file with the year pattern
            filename = f"votes_01.01.{year_a}.txt"
            with open(os.path.join(tmpdir, filename), "w") as f:
                f.write("")
            assert extract_year(tmpdir) == year_a
        finally:
            shutil.rmtree(tmpdir)

    @given(
        data=st.data(),
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
    def test_year_ordering_is_correct(self, data):
        """For any two distinct years, the earlier year is base and later is change."""
        year_a = data.draw(year_st)
        year_b = data.draw(year_st.filter(lambda y: y != year_a))

        dir_a = tempfile.mkdtemp()
        dir_b = tempfile.mkdtemp()
        try:
            with open(os.path.join(dir_a, f"votes_01.01.{year_a}.txt"), "w") as f:
                f.write("")
            with open(os.path.join(dir_b, f"votes_01.01.{year_b}.txt"), "w") as f:
                f.write("")

            ya = extract_year(dir_a)
            yb = extract_year(dir_b)

            # Regardless of argument order, the smaller year should be base
            base_year = min(ya, yb)
            change_year = max(ya, yb)
            assert base_year < change_year
            assert base_year == min(year_a, year_b)
            assert change_year == max(year_a, year_b)
        finally:
            shutil.rmtree(dir_a)
            shutil.rmtree(dir_b)


class TestProperty2CrossYearPartyNameResolution:
    """Feature: vote-difference-comparison, Property 2: Cross-year party name resolution

    **Validates: Requirements 3.1, 3.2**

    For any valid party datasets with overlapping names, resolution chain is correct.
    """

    @given(
        party_num_change=party_number_st,
        party_num_base=party_number_st,
        party_name=party_name_st,
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
    def test_resolve_party_finds_correct_match(self, party_num_change, party_num_base, party_name):
        """resolve_party correctly chains: change party_number → name → base party_number."""
        conn_change = _create_db()
        conn_base = _create_db()
        try:
            conn_change.execute(
                "INSERT INTO cik_parties (party_number, party_name) VALUES (?, ?)",
                (party_num_change, party_name),
            )
            conn_base.execute(
                "INSERT INTO cik_parties (party_number, party_name) VALUES (?, ?)",
                (party_num_base, party_name),
            )

            change_pn, base_pn, resolved_name = resolve_party(conn_change, conn_base, party_num_change)

            assert change_pn == party_num_change
            assert base_pn == party_num_base
            assert resolved_name == party_name
        finally:
            conn_change.close()
            conn_base.close()

    @given(
        parties=st.lists(
            st.tuples(party_number_st, party_name_st),
            min_size=2,
            max_size=10,
            unique_by=(lambda x: x[0], lambda x: x[1]),
        ),
        data=st.data(),
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
    def test_resolve_party_with_multiple_parties(self, parties, data):
        """With multiple parties, resolve_party picks the correct one by name."""
        # Pick a random party to look up
        idx = data.draw(st.integers(min_value=0, max_value=len(parties) - 1))
        target_num_change, target_name = parties[idx]

        # Generate different party numbers for base year (same names)
        base_numbers = data.draw(
            st.lists(
                st.integers(min_value=1, max_value=9999),
                min_size=len(parties),
                max_size=len(parties),
                unique=True,
            )
        )

        conn_change = _create_db()
        conn_base = _create_db()
        try:
            for pn, name in parties:
                conn_change.execute(
                    "INSERT INTO cik_parties (party_number, party_name) VALUES (?, ?)",
                    (pn, name),
                )
            for i, (_, name) in enumerate(parties):
                conn_base.execute(
                    "INSERT INTO cik_parties (party_number, party_name) VALUES (?, ?)",
                    (base_numbers[i], name),
                )

            change_pn, base_pn, resolved_name = resolve_party(conn_change, conn_base, target_num_change)

            assert change_pn == target_num_change
            assert base_pn == base_numbers[idx]
            assert resolved_name == target_name
        finally:
            conn_change.close()
            conn_base.close()


class TestProperty3VoteDifferenceComputation:
    """Feature: vote-difference-comparison, Property 3: Vote difference computation

    **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

    For any two vote dictionaries, difference equals change - base with missing sections treated as 0.
    """

    @given(
        change_votes=st.dictionaries(section_code_st, vote_count_st, min_size=0, max_size=15),
        base_votes=st.dictionaries(section_code_st, vote_count_st, min_size=0, max_size=15),
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
    def test_differences_equal_change_minus_base(self, change_votes, base_votes):
        """For any two vote dicts, difference = change - base, missing = 0."""
        conn_change = _create_db()
        conn_base = _create_db()
        change_party = 1
        base_party = 2
        try:
            for sc, tv in change_votes.items():
                conn_change.execute(
                    "INSERT INTO votes (form_number, section_code, admin_unit_id, "
                    "party_number, total_votes, paper_votes, machine_votes) "
                    "VALUES (26, ?, 1, ?, ?, ?, 0)",
                    (sc, change_party, tv, tv),
                )

            for sc, tv in base_votes.items():
                conn_base.execute(
                    "INSERT INTO votes (form_number, section_code, admin_unit_id, "
                    "party_number, total_votes, paper_votes, machine_votes) "
                    "VALUES (26, ?, 1, ?, ?, ?, 0)",
                    (sc, base_party, tv, tv),
                )

            result = compute_differences(conn_change, conn_base, change_party, base_party)
            result_dict = dict(result)

            # All sections from both dicts must appear
            all_sections = set(change_votes.keys()) | set(base_votes.keys())
            assert set(result_dict.keys()) == all_sections

            # Each difference must be change - base (missing treated as 0)
            for sc in all_sections:
                cv = change_votes.get(sc, 0)
                bv = base_votes.get(sc, 0)
                assert result_dict[sc] == cv - bv
        finally:
            conn_change.close()
            conn_base.close()


class TestProperty4OutputSignFormatting:
    """Feature: vote-difference-comparison, Property 4: Output sign formatting

    **Validates: Requirements 5.2, 5.3, 5.4**

    For any integer, format produces correct sign prefix.
    """

    @given(diff=diff_st)
    @settings(max_examples=100)
    def test_format_difference_sign(self, diff):
        """format_difference produces +N for positive, -N for negative, 0 for zero."""
        result = format_difference(diff)
        if diff > 0:
            assert result == f"+{diff}"
            assert result.startswith("+")
        elif diff < 0:
            assert result == str(diff)
            assert result.startswith("-")
        else:
            assert result == "0"


class TestProperty5OutputSorting:
    """Feature: vote-difference-comparison, Property 5: Output sorting

    **Validates: Requirements 5.5**

    For any results list, output is sorted by section code.
    """

    @given(
        sections=st.lists(
            st.tuples(section_code_st, diff_st),
            min_size=0,
            max_size=20,
            unique_by=lambda x: x[0],
        ),
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
    def test_compute_differences_returns_sorted(self, sections):
        """compute_differences output is sorted by section_code ascending."""
        conn_change = _create_db()
        conn_base = _create_db()
        change_party = 1
        base_party = 2
        try:
            for sc, diff in sections:
                # Set change_votes = max(diff, 0), base_votes = max(-diff, 0)
                # so that change - base = diff
                cv = max(diff, 0)
                bv = max(-diff, 0)
                conn_change.execute(
                    "INSERT INTO votes (form_number, section_code, admin_unit_id, "
                    "party_number, total_votes, paper_votes, machine_votes) "
                    "VALUES (26, ?, 1, ?, ?, ?, 0)",
                    (sc, change_party, cv, cv),
                )
                conn_base.execute(
                    "INSERT INTO votes (form_number, section_code, admin_unit_id, "
                    "party_number, total_votes, paper_votes, machine_votes) "
                    "VALUES (26, ?, 1, ?, ?, ?, 0)",
                    (sc, base_party, bv, bv),
                )

            result = compute_differences(conn_change, conn_base, change_party, base_party)

            # Verify sorted by section_code
            section_codes = [sc for sc, _ in result]
            assert section_codes == sorted(section_codes)
        finally:
            conn_change.close()
            conn_base.close()


# ===========================================================================
# Task 8: Unit and Integration Tests
# ===========================================================================


class TestCLIArgumentParsing:
    """8.1 Unit tests for CLI argument parsing (valid args, missing args, invalid paths)."""

    def test_valid_args(self, tmp_path):
        """main() accepts two valid directories and a party number."""
        dir1 = _make_data_folder(2024, [(1, "PartyA")], [("010100001", 1, 100)])
        dir2 = _make_data_folder(2025, [(1, "PartyA")], [("010100001", 1, 150)])
        try:
            # Should run without error
            main([dir1, dir2, "1"])
        finally:
            shutil.rmtree(dir1)
            shutil.rmtree(dir2)

    def test_missing_args_exits(self):
        """main() exits when required arguments are missing."""
        with pytest.raises(SystemExit):
            main([])

    def test_single_arg_exits(self):
        """main() exits when only one argument is provided."""
        with pytest.raises(SystemExit):
            main(["/some/path"])

    def test_invalid_path_exits(self, tmp_path):
        """main() exits with error when a path doesn't exist."""
        nonexistent = str(tmp_path / "nonexistent")
        other = str(tmp_path / "other")
        with pytest.raises(SystemExit):
            main([nonexistent, other, "1"])

    def test_not_a_directory_exits(self, tmp_path):
        """main() exits when path is a file, not a directory."""
        file_path = tmp_path / "afile.txt"
        file_path.write_text("hello")
        with pytest.raises(SystemExit):
            main([str(file_path), str(tmp_path), "1"])


class TestErrorCases:
    """8.2 Unit tests for error cases (same year, party not found, name not matched)."""

    def test_same_year_exits(self):
        """main() exits when both folders have the same year."""
        dir1 = _make_data_folder(2024, [(1, "PartyA")], [("010100001", 1, 100)])
        dir2 = _make_data_folder(2024, [(1, "PartyA")], [("010100001", 1, 150)])
        try:
            with pytest.raises(SystemExit, match="same year"):
                main([dir1, dir2, "1"])
        finally:
            shutil.rmtree(dir1)
            shutil.rmtree(dir2)

    def test_party_not_found_in_change_year(self):
        """resolve_party exits when party number doesn't exist in change year."""
        conn_change = _create_db()
        conn_base = _create_db()
        try:
            conn_change.execute(
                "INSERT INTO cik_parties (party_number, party_name) VALUES (1, 'PartyA')"
            )
            with pytest.raises(SystemExit, match="not found"):
                resolve_party(conn_change, conn_base, 999)
        finally:
            conn_change.close()
            conn_base.close()

    def test_party_name_not_matched_in_base_year(self):
        """resolve_party exits when party name has no match in base year."""
        conn_change = _create_db()
        conn_base = _create_db()
        try:
            conn_change.execute(
                "INSERT INTO cik_parties (party_number, party_name) VALUES (1, 'PartyA')"
            )
            conn_base.execute(
                "INSERT INTO cik_parties (party_number, party_name) VALUES (1, 'PartyB')"
            )
            with pytest.raises(SystemExit, match="no match"):
                resolve_party(conn_change, conn_base, 1)
        finally:
            conn_change.close()
            conn_base.close()

    def test_extract_year_no_pattern_exits(self, tmp_path):
        """extract_year exits when no date pattern found in filenames."""
        # Create a file without the date pattern
        (tmp_path / "random_file.txt").write_text("data")
        with pytest.raises(SystemExit, match="No date pattern"):
            extract_year(str(tmp_path))


class TestIntegration:
    """8.3 Integration test with sample election data folders verifying end-to-end output."""

    def test_end_to_end_basic(self, capsys):
        """Full pipeline: two years, one party, multiple sections with known differences."""
        # Base year (2023): PartyA has party_number=5
        base_parties = [(5, "PartyA"), (6, "PartyB")]
        base_votes = [
            ("010100001", 5, 100),
            ("010100002", 5, 200),
            ("010100003", 5, 50),
        ]

        # Change year (2024): PartyA has party_number=3 (different number, same name)
        change_parties = [(3, "PartyA"), (4, "PartyB")]
        change_votes = [
            ("010100001", 3, 150),   # +50
            ("010100002", 3, 180),   # -20
            ("010100003", 3, 50),    # 0
        ]

        dir_base = _make_data_folder(2023, base_parties, base_votes)
        dir_change = _make_data_folder(2024, change_parties, change_votes)
        try:
            # Party number 3 is in the change year (2024)
            main([dir_change, dir_base, "3"])
            output = capsys.readouterr().out.strip().split("\n")

            assert len(output) == 3
            assert output[0] == "010100001 +50"
            assert output[1] == "010100002 -20"
            assert output[2] == "010100003 0"
        finally:
            shutil.rmtree(dir_base)
            shutil.rmtree(dir_change)

    def test_end_to_end_sections_only_in_one_year(self, capsys):
        """Sections appearing in only one year are handled correctly."""
        base_parties = [(1, "TestParty")]
        base_votes = [
            ("010100001", 1, 100),
            ("010100002", 1, 200),  # only in base
        ]

        change_parties = [(1, "TestParty")]
        change_votes = [
            ("010100001", 1, 150),  # +50
            ("010100003", 1, 75),   # only in change, base=0 → +75
        ]

        dir_base = _make_data_folder(2022, base_parties, base_votes)
        dir_change = _make_data_folder(2024, change_parties, change_votes)
        try:
            main([dir_base, dir_change, "1"])
            output = capsys.readouterr().out.strip().split("\n")

            result = {line.split()[0]: line.split()[1] for line in output}
            assert result["010100001"] == "+50"
            assert result["010100002"] == "-200"  # only in base → 0 - 200
            assert result["010100003"] == "+75"    # only in change → 75 - 0
        finally:
            shutil.rmtree(dir_base)
            shutil.rmtree(dir_change)

    def test_end_to_end_folder_order_doesnt_matter(self, capsys):
        """Output is the same regardless of which folder is passed first."""
        parties = [(1, "PartyX")]
        base_votes = [("010100001", 1, 100)]
        change_votes = [("010100001", 1, 200)]

        dir_base = _make_data_folder(2020, parties, base_votes)
        dir_change = _make_data_folder(2024, parties, change_votes)
        try:
            # Pass change first, then base
            main([dir_change, dir_base, "1"])
            out1 = capsys.readouterr().out.strip()

            # Pass base first, then change
            main([dir_base, dir_change, "1"])
            out2 = capsys.readouterr().out.strip()

            assert out1 == out2
            assert out1 == "010100001 +100"
        finally:
            shutil.rmtree(dir_base)
            shutil.rmtree(dir_change)
