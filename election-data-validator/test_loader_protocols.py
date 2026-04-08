"""Unit tests for _load_protocols() — form-number-aware protocol parsing."""

import os
import sqlite3
import tempfile

import pytest

from loader import DataLoader, _safe_int, PAPER_ONLY_FORMS, MACHINE_FORMS


# ---------------------------------------------------------------------------
# Helper: create a minimal data directory with all required files
# ---------------------------------------------------------------------------

def _create_data_dir(tmp_path, protocol_lines: list[str]) -> str:
    """Create a temp data dir with stub required files and given protocol content."""
    data_dir = str(tmp_path / "data")
    os.makedirs(data_dir, exist_ok=True)

    # Stub files (empty) for all required files except protocols
    stub_files = [
        "cik_parties_27.10.2024.txt",
        "local_parties_27.10.2024.txt",
        "local_candidates_27.10.2024.txt",
        "sections_27.10.2024.txt",
        "votes_27.10.2024.txt",
        "preferences_27.10.2024.txt",
    ]
    for fname in stub_files:
        (tmp_path / "data" / fname).write_text("", encoding="utf-8")

    # Write protocol file
    content = "\n".join(protocol_lines)
    (tmp_path / "data" / "protocols_27.10.2024.txt").write_text(
        content, encoding="utf-8"
    )
    return data_dir


def _make_loader(tmp_path, protocol_lines: list[str]) -> DataLoader:
    data_dir = _create_data_dir(tmp_path, protocol_lines)
    db_path = str(tmp_path / "test.db")
    return DataLoader(db_path, data_dir)


# ---------------------------------------------------------------------------
# _safe_int tests
# ---------------------------------------------------------------------------

class TestSafeInt:
    def test_normal_int(self):
        assert _safe_int("42") == 42

    def test_empty_string(self):
        assert _safe_int("") is None

    def test_whitespace(self):
        assert _safe_int("  ") is None

    def test_negative(self):
        assert _safe_int("-5") == -5

    def test_zero(self):
        assert _safe_int("0") == 0


# ---------------------------------------------------------------------------
# Paper-only form (24) — 18 columns, no machine fields
# ---------------------------------------------------------------------------

class TestLoadProtocolsPaperOnly:
    def test_form24_basic(self, tmp_path):
        # Columns: 0=form, 1=section, 2=rik, 3=pages, 4="", 5="",
        #          6=received, 7=voters_list, 8="", 9="",
        #          10=voters_supp, 11=voters_voted, 12=unused, 13=spoiled,
        #          14=ballots_box, 15=invalid, 16=no_support, 17=total_valid
        line = "24;010100001;01;FAB001|FAB002;;;" \
               "500;400;;;" \
               "10;350;100;50;" \
               "200;30;20;150"
        loader = _make_loader(tmp_path, [line])
        count = loader._load_protocols()

        assert count == 1
        row = loader.conn.execute("SELECT * FROM protocols").fetchone()
        # form_number, section_code, rik_code, page_numbers
        assert row[0] == 24
        assert row[1] == "010100001"
        assert row[2] == 1
        assert row[3] == "FAB001|FAB002"
        # received_ballots, voters_in_list
        assert row[4] == 500
        assert row[5] == 400
        # voters_supplementary, voters_voted
        assert row[6] == 10
        assert row[7] == 350
        # unused_ballots, spoiled_ballots, ballots_in_box
        assert row[8] == 100
        assert row[9] == 50
        assert row[10] == 200
        # invalid_votes, valid_no_support, total_valid_party_votes
        assert row[11] == 30
        assert row[12] == 20
        assert row[13] == 150
        # Machine columns should be NULL for form 24
        assert row[14] is None
        assert row[15] is None
        assert row[16] is None

    def test_form28_machine_columns_null(self, tmp_path):
        line = "28;320100001;32;FAB003;;;" \
               "300;250;;;" \
               "5;200;80;20;" \
               "100;10;15;75"
        loader = _make_loader(tmp_path, [line])
        count = loader._load_protocols()

        assert count == 1
        row = loader.conn.execute("SELECT * FROM protocols").fetchone()
        assert row[0] == 28
        assert row[14] is None  # machine_ballots_in_box
        assert row[15] is None  # machine_no_support
        assert row[16] is None  # machine_valid_party_votes


# ---------------------------------------------------------------------------
# Machine form (26/30) — 21 columns, includes machine fields
# ---------------------------------------------------------------------------

class TestLoadProtocolsMachineForm:
    def test_form26_with_machine_columns(self, tmp_path):
        # 21 columns: 0-17 same as paper, plus 18-20 machine fields
        line = "26;010100002;01;FAB010;;;" \
               "600;500;;;" \
               "20;450;100;50;" \
               "300;40;30;230;" \
               "150;10;140"
        loader = _make_loader(tmp_path, [line])
        count = loader._load_protocols()

        assert count == 1
        row = loader.conn.execute("SELECT * FROM protocols").fetchone()
        assert row[0] == 26
        assert row[1] == "010100002"
        # Machine columns should be populated
        assert row[14] == 150  # machine_ballots_in_box
        assert row[15] == 10   # machine_no_support
        assert row[16] == 140  # machine_valid_party_votes

    def test_form30_with_machine_columns(self, tmp_path):
        line = "30;320100002;32;FAB020;;;" \
               "400;350;;;" \
               "15;300;70;30;" \
               "200;25;20;155;" \
               "100;5;95"
        loader = _make_loader(tmp_path, [line])
        count = loader._load_protocols()

        assert count == 1
        row = loader.conn.execute("SELECT * FROM protocols").fetchone()
        assert row[0] == 30
        assert row[14] == 100  # machine_ballots_in_box
        assert row[15] == 5    # machine_no_support
        assert row[16] == 95   # machine_valid_party_votes


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestLoadProtocolsEdgeCases:
    def test_empty_page_numbers_stored_as_none(self, tmp_path):
        line = "24;010100003;01;;;;" \
               "100;80;;;" \
               "5;70;20;10;" \
               "40;5;3;32"
        loader = _make_loader(tmp_path, [line])
        loader._load_protocols()
        row = loader.conn.execute("SELECT page_numbers FROM protocols").fetchone()
        assert row[0] is None

    def test_row_with_too_few_columns_skipped(self, tmp_path):
        short_line = "24;010100004;01"  # only 3 columns
        loader = _make_loader(tmp_path, [short_line])
        count = loader._load_protocols()
        assert count == 0

    def test_multiple_rows(self, tmp_path):
        lines = [
            "24;010100010;01;FAB1;;;500;400;;;10;350;100;50;200;30;20;150",
            "26;010100011;01;FAB2;;;600;500;;;20;450;100;50;300;40;30;230;150;10;140",
        ]
        loader = _make_loader(tmp_path, lines)
        count = loader._load_protocols()
        assert count == 2

        rows = loader.conn.execute(
            "SELECT form_number, machine_ballots_in_box FROM protocols ORDER BY section_code"
        ).fetchall()
        # Form 24 — machine NULL
        assert rows[0] == (24, None)
        # Form 26 — machine populated
        assert rows[1] == (26, 150)

    def test_empty_numeric_fields_stored_as_none(self, tmp_path):
        # received_ballots is empty string
        line = "24;010100005;01;FAB;;;;" \
               "80;;;" \
               "5;70;20;10;" \
               "40;5;3;32"
        loader = _make_loader(tmp_path, [line])
        loader._load_protocols()
        row = loader.conn.execute(
            "SELECT received_ballots FROM protocols"
        ).fetchone()
        assert row[0] is None
