"""Tests for DataLoader.__init__ and _read_file."""

import os
import sqlite3
import tempfile
from unittest.mock import patch, MagicMock

import pytest

from loader import DataLoader, FILE_TYPE_PREFIXES


def _make_files_for_dir(directory):
    """Create one file per prefix in FILE_TYPE_PREFIXES using generic names."""
    for prefix in FILE_TYPE_PREFIXES:
        (directory / f"{prefix}_test.txt").write_text("", encoding="utf-8")


@pytest.fixture
def data_dir(tmp_path):
    """Create a temp data directory with all required (empty-content) files."""
    _make_files_for_dir(tmp_path)
    return str(tmp_path)


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "test.db")


# ── __init__ tests ──────────────────────────────────────────────────


class TestDataLoaderInit:
    def test_creates_database_and_tables(self, db_path, data_dir):
        loader = DataLoader(db_path, data_dir)
        cur = loader.conn.cursor()
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        tables = sorted(row[0] for row in cur.fetchall())
        expected = sorted([
            "cik_parties", "local_parties", "local_candidates",
            "sections", "protocols", "votes", "preferences",
        ])
        assert tables == expected

    def test_recreates_tables_on_existing_db(self, db_path, data_dir):
        # First run — insert a row
        loader1 = DataLoader(db_path, data_dir)
        loader1.conn.execute(
            "INSERT INTO cik_parties (party_number, party_name) VALUES (1, 'X')"
        )
        loader1.conn.commit()
        loader1.conn.close()

        # Second run — tables should be recreated (empty)
        loader2 = DataLoader(db_path, data_dir)
        count = loader2.conn.execute(
            "SELECT COUNT(*) FROM cik_parties"
        ).fetchone()[0]
        assert count == 0

    def test_missing_file_exits(self, tmp_path):
        # Create only a subset of the required file types
        for prefix in FILE_TYPE_PREFIXES[:3]:
            (tmp_path / f"{prefix}_test.txt").write_text("", encoding="utf-8")
        db = str(tmp_path / "test.db")
        with pytest.raises(SystemExit):
            DataLoader(db, str(tmp_path))

    def test_stores_paths(self, db_path, data_dir):
        loader = DataLoader(db_path, data_dir)
        assert loader.db_path == db_path
        assert loader.data_dir == data_dir

    def test_init_stores_files_dict(self, db_path, data_dir):
        """DataLoader.__init__ stores self._files dict with correct keys."""
        loader = DataLoader(db_path, data_dir)
        assert hasattr(loader, "_files")
        assert isinstance(loader._files, dict)

    def test_files_dict_has_all_seven_keys(self, db_path, data_dir):
        """The _files dict has all 7 file type keys from FILE_TYPE_PREFIXES."""
        loader = DataLoader(db_path, data_dir)
        assert set(loader._files.keys()) == set(FILE_TYPE_PREFIXES)

    def test_files_dict_values_match_discovered_files(self, db_path, data_dir):
        """Each value in _files should be the basename of a discovered file."""
        loader = DataLoader(db_path, data_dir)
        for prefix in FILE_TYPE_PREFIXES:
            filename = loader._files[prefix]
            assert filename == f"{prefix}_test.txt"

    def test_init_calls_validate_folder_and_discover_files(self, tmp_path):
        """DataLoader.__init__ calls validate_folder and discover_files."""
        _make_files_for_dir(tmp_path)
        db = str(tmp_path / "test.db")
        data = str(tmp_path)

        with patch("loader.validate_folder") as mock_vf, \
             patch("loader.discover_files") as mock_df:
            # discover_files must return a valid dict for __init__ to proceed
            mock_df.return_value = {p: f"{p}_test.txt" for p in FILE_TYPE_PREFIXES}
            loader = DataLoader(db, data)
            mock_vf.assert_called_once_with(data)
            mock_df.assert_called_once_with(data)


# ── _read_file tests ───────────────────────────────────────────────


class TestReadFile:
    def test_reads_utf8_semicolon_file(self, db_path, data_dir):
        fpath = os.path.join(data_dir, f"{FILE_TYPE_PREFIXES[0]}_test.txt")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write("a;b;c\n")
            f.write("1;2;3\n")

        loader = DataLoader(db_path, data_dir)
        rows = list(loader._read_file(f"{FILE_TYPE_PREFIXES[0]}_test.txt"))
        assert rows == [["a", "b", "c"], ["1", "2", "3"]]

    def test_reads_windows1251_fallback(self, db_path, data_dir):
        fpath = os.path.join(data_dir, f"{FILE_TYPE_PREFIXES[0]}_test.txt")
        # Write a file that is valid Windows-1251 but NOT valid UTF-8
        with open(fpath, "wb") as f:
            # "Партия" in Windows-1251 bytes
            text = "Партия".encode("windows-1251")
            f.write(text + b";42\n")

        loader = DataLoader(db_path, data_dir)
        rows = list(loader._read_file(f"{FILE_TYPE_PREFIXES[0]}_test.txt"))
        assert len(rows) == 1
        assert rows[0][0] == "Партия"
        assert rows[0][1] == "42"

    def test_skips_empty_lines(self, db_path, data_dir):
        fpath = os.path.join(data_dir, f"{FILE_TYPE_PREFIXES[0]}_test.txt")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write("a;b\n\n\nc;d\n")

        loader = DataLoader(db_path, data_dir)
        rows = list(loader._read_file(f"{FILE_TYPE_PREFIXES[0]}_test.txt"))
        assert rows == [["a", "b"], ["c", "d"]]

    def test_returns_iterator(self, db_path, data_dir):
        """_read_file should return an iterator, not a list."""
        fpath = os.path.join(data_dir, f"{FILE_TYPE_PREFIXES[0]}_test.txt")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write("x;y\n")

        loader = DataLoader(db_path, data_dir)
        result = loader._read_file(f"{FILE_TYPE_PREFIXES[0]}_test.txt")
        # Should be an iterator (generator)
        assert hasattr(result, "__next__")


# ── Reference table loader tests ───────────────────────────────────


class TestLoadCikParties:
    def test_loads_parties(self, db_path, data_dir):
        fpath = os.path.join(data_dir, "cik_parties_test.txt")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write("1;Партия А\n")
            f.write("2;Партия Б\n")
            f.write("99;Коалиция В\n")

        loader = DataLoader(db_path, data_dir)
        count = loader._load_cik_parties()
        assert count == 3

        rows = loader.conn.execute(
            "SELECT party_number, party_name FROM cik_parties ORDER BY party_number"
        ).fetchall()
        assert rows == [(1, "Партия А"), (2, "Партия Б"), (99, "Коалиция В")]

    def test_empty_file_returns_zero(self, db_path, data_dir):
        loader = DataLoader(db_path, data_dir)
        count = loader._load_cik_parties()
        assert count == 0


class TestLoadLocalParties:
    def test_loads_local_parties(self, db_path, data_dir):
        fpath = os.path.join(data_dir, "local_parties_test.txt")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write("01;София-град;5;Партия Х\n")
            f.write("02;Пловдив;10;Коалиция Y\n")

        loader = DataLoader(db_path, data_dir)
        count = loader._load_local_parties()
        assert count == 2

        rows = loader.conn.execute(
            "SELECT rik_code, admin_unit_name, party_number, party_name "
            "FROM local_parties ORDER BY rik_code"
        ).fetchall()
        assert rows == [
            (1, "София-град", 5, "Партия Х"),
            (2, "Пловдив", 10, "Коалиция Y"),
        ]


class TestLoadLocalCandidates:
    def test_loads_candidates(self, db_path, data_dir):
        fpath = os.path.join(data_dir, "local_candidates_test.txt")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write("01;София-град;5;Партия Х;101;Иван Иванов\n")
            f.write("01;София-град;5;Партия Х;102;Мария Петрова\n")

        loader = DataLoader(db_path, data_dir)
        count = loader._load_local_candidates()
        assert count == 2

        rows = loader.conn.execute(
            "SELECT rik_code, admin_unit_name, party_number, party_name, "
            "candidate_number, candidate_name "
            "FROM local_candidates ORDER BY candidate_number"
        ).fetchall()
        assert rows == [
            (1, "София-град", 5, "Партия Х", 101, "Иван Иванов"),
            (1, "София-град", 5, "Партия Х", 102, "Мария Петрова"),
        ]


class TestLoadSections:
    def test_loads_sections(self, db_path, data_dir):
        fpath = os.path.join(data_dir, "sections_test.txt")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write("010100001;101;София-град;12345;София;ул. Витоша 1;0;0;2\n")
            f.write("020200001;202;Пловдив;67890;Пловдив;бул. Марица 5;1;0;0\n")

        loader = DataLoader(db_path, data_dir)
        count = loader._load_sections()
        assert count == 2

        rows = loader.conn.execute(
            "SELECT section_code, admin_unit_id, admin_unit_name, ekatte, "
            "settlement_name, address, is_mobile, is_ship, num_machines "
            "FROM sections ORDER BY section_code"
        ).fetchall()
        assert rows == [
            ("010100001", 101, "София-град", "12345", "София", "ул. Витоша 1", 0, 0, 2),
            ("020200001", 202, "Пловдив", "67890", "Пловдив", "бул. Марица 5", 1, 0, 0),
        ]

    def test_section_code_stored_as_text(self, db_path, data_dir):
        """Section codes with leading zeros must be preserved as TEXT."""
        fpath = os.path.join(data_dir, "sections_test.txt")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write("010100001;101;Test;00000;Town;Addr;0;0;1\n")

        loader = DataLoader(db_path, data_dir)
        loader._load_sections()

        code = loader.conn.execute(
            "SELECT section_code FROM sections"
        ).fetchone()[0]
        assert code == "010100001"
        assert isinstance(code, str)


# ── Votes loader tests ─────────────────────────────────────────────


def _create_data_dir_with_votes(tmp_path, votes_lines: list[str]) -> str:
    """Create a temp data dir with stub required files and given votes content."""
    data_dir = str(tmp_path / "data")
    os.makedirs(data_dir, exist_ok=True)

    # Create stub files for all types except votes
    for prefix in FILE_TYPE_PREFIXES:
        if prefix != "votes":
            (tmp_path / "data" / f"{prefix}_test.txt").write_text("", encoding="utf-8")

    content = "\n".join(votes_lines)
    (tmp_path / "data" / "votes_test.txt").write_text(
        content, encoding="utf-8"
    )
    return data_dir


def _make_votes_loader(tmp_path, votes_lines: list[str]) -> DataLoader:
    data_dir = _create_data_dir_with_votes(tmp_path, votes_lines)
    db = str(tmp_path / "test.db")
    return DataLoader(db, data_dir)


class TestLoadVotes:
    def test_single_party_group(self, tmp_path):
        # form;section;admin_unit;party;total;paper;machine
        line = "24;010100001;101;5;100;80;20"
        loader = _make_votes_loader(tmp_path, [line])
        count = loader._load_votes()

        assert count == 1
        row = loader.conn.execute(
            "SELECT form_number, section_code, admin_unit_id, "
            "party_number, total_votes, paper_votes, machine_votes FROM votes"
        ).fetchone()
        assert row == (24, "010100001", 101, 5, 100, 80, 20)

    def test_multiple_party_groups(self, tmp_path):
        # 3 header fields + 3 groups of 4 = 15 fields total
        line = "26;020200001;202;1;50;30;20;2;40;25;15;3;10;10;0"
        loader = _make_votes_loader(tmp_path, [line])
        count = loader._load_votes()

        assert count == 3
        rows = loader.conn.execute(
            "SELECT party_number, total_votes, paper_votes, machine_votes "
            "FROM votes ORDER BY party_number"
        ).fetchall()
        assert rows == [
            (1, 50, 30, 20),
            (2, 40, 25, 15),
            (3, 10, 10, 0),
        ]

    def test_incomplete_group_skipped_with_warning(self, tmp_path, caplog):
        # 3 header + 1 complete group (4) + 2 leftover fields = 9 fields
        line = "24;010100001;101;5;100;80;20;7;50"
        loader = _make_votes_loader(tmp_path, [line])
        import logging
        with caplog.at_level(logging.WARNING):
            count = loader._load_votes()

        # Only the complete group should be loaded
        assert count == 1
        assert "Непълна група" in caplog.text

    def test_empty_file_returns_zero(self, tmp_path):
        loader = _make_votes_loader(tmp_path, [])
        count = loader._load_votes()
        assert count == 0

    def test_header_only_no_parties(self, tmp_path):
        # Only 3 header fields, no party groups
        line = "24;010100001;101"
        loader = _make_votes_loader(tmp_path, [line])
        count = loader._load_votes()
        assert count == 0

    def test_multiple_rows(self, tmp_path):
        lines = [
            "24;010100001;101;1;50;50;0;2;30;30;0",
            "26;020200001;202;1;100;60;40",
        ]
        loader = _make_votes_loader(tmp_path, lines)
        count = loader._load_votes()

        assert count == 3
        rows = loader.conn.execute(
            "SELECT section_code, party_number FROM votes ORDER BY section_code, party_number"
        ).fetchall()
        assert rows == [
            ("010100001", 1),
            ("010100001", 2),
            ("020200001", 1),
        ]

    def test_section_code_preserved_as_text(self, tmp_path):
        line = "24;010100001;101;5;100;80;20"
        loader = _make_votes_loader(tmp_path, [line])
        loader._load_votes()

        code = loader.conn.execute(
            "SELECT section_code FROM votes"
        ).fetchone()[0]
        assert code == "010100001"
        assert isinstance(code, str)


# ── Preferences loader helpers ──────────────────────────────────────


def _create_data_dir_with_preferences(tmp_path, pref_lines: list[str]) -> str:
    """Create a temp data dir with stub required files and given preferences content."""
    data_dir = str(tmp_path / "pdata")
    os.makedirs(data_dir, exist_ok=True)

    # Create stub files for all types except preferences
    for prefix in FILE_TYPE_PREFIXES:
        if prefix != "preferences":
            (tmp_path / "pdata" / f"{prefix}_test.txt").write_text("", encoding="utf-8")

    content = "\n".join(pref_lines)
    (tmp_path / "pdata" / "preferences_test.txt").write_text(
        content, encoding="utf-8"
    )
    return data_dir


def _make_pref_loader(tmp_path, pref_lines: list[str]) -> DataLoader:
    data_dir = _create_data_dir_with_preferences(tmp_path, pref_lines)
    db = str(tmp_path / "ptest.db")
    return DataLoader(db, data_dir)


class TestLoadPreferences:
    def test_basic_row(self, tmp_path):
        line = "24;010100001;5;1;100;80;20"
        loader = _make_pref_loader(tmp_path, [line])
        count = loader._load_preferences()

        assert count == 1
        row = loader.conn.execute(
            "SELECT form_number, section_code, party_number, candidate_number, "
            "total_votes, paper_votes, machine_votes FROM preferences"
        ).fetchone()
        assert row == (24, "010100001", 5, "1", 100, 80, 20)

    def test_bez_candidate_number(self, tmp_path):
        line = "26;020200001;3;Без;50;30;20"
        loader = _make_pref_loader(tmp_path, [line])
        count = loader._load_preferences()

        assert count == 1
        row = loader.conn.execute(
            "SELECT candidate_number FROM preferences"
        ).fetchone()
        assert row[0] == "Без"

    def test_multiple_rows(self, tmp_path):
        lines = [
            "24;010100001;5;1;100;80;20",
            "24;010100001;5;2;50;40;10",
            "24;010100001;5;Без;30;30;0",
        ]
        loader = _make_pref_loader(tmp_path, lines)
        count = loader._load_preferences()

        assert count == 3
        rows = loader.conn.execute(
            "SELECT candidate_number, total_votes FROM preferences ORDER BY total_votes DESC"
        ).fetchall()
        assert rows == [("1", 100), ("2", 50), ("Без", 30)]

    def test_empty_file_returns_zero(self, tmp_path):
        loader = _make_pref_loader(tmp_path, [])
        count = loader._load_preferences()
        assert count == 0

    def test_short_row_skipped(self, tmp_path, caplog):
        lines = [
            "24;010100001;5;1;100;80",  # only 6 fields, need 7
            "24;010100001;5;2;50;40;10",  # valid
        ]
        loader = _make_pref_loader(tmp_path, lines)
        import logging
        with caplog.at_level(logging.WARNING):
            count = loader._load_preferences()

        assert count == 1
        assert "Пропуснат ред" in caplog.text

    def test_section_code_preserved_as_text(self, tmp_path):
        line = "24;010100001;5;1;100;80;20"
        loader = _make_pref_loader(tmp_path, [line])
        loader._load_preferences()

        code = loader.conn.execute(
            "SELECT section_code FROM preferences"
        ).fetchone()[0]
        assert code == "010100001"

    def test_candidate_number_stored_as_text(self, tmp_path):
        line = "24;010100001;5;3;100;80;20"
        loader = _make_pref_loader(tmp_path, [line])
        loader._load_preferences()

        val = loader.conn.execute(
            "SELECT candidate_number FROM preferences"
        ).fetchone()[0]
        # Should be stored as text "3", not integer 3
        assert isinstance(val, str)
        assert val == "3"


# ── load_all tests ──────────────────────────────────────────────────


def _populate_all_files(data_dir: str) -> None:
    """Write minimal valid content into every required data file."""
    files = {
        "cik_parties_test.txt": "1;Партия А\n2;Партия Б\n",
        "local_parties_test.txt": "01;София-град;1;Партия А\n",
        "local_candidates_test.txt": "01;София-град;1;Партия А;101;Иван Иванов\n",
        "sections_test.txt": "010100001;101;София-град;12345;София;ул. Витоша 1;0;0;2\n",
        "protocols_test.txt": "26;010100001;01;pages;;; 500;400;;;10;350;50;20;280;30;15;235;200;10;190\n",
        "votes_test.txt": "26;010100001;101;1;150;90;60;2;130;80;50\n",
        "preferences_test.txt": "26;010100001;1;101;80;50;30\n26;010100001;1;Без;70;40;30\n",
    }
    for fname, content in files.items():
        with open(os.path.join(data_dir, fname), "w", encoding="utf-8") as f:
            f.write(content)


class TestLoadAll:
    def test_returns_dict_with_all_tables(self, db_path, data_dir):
        _populate_all_files(data_dir)
        loader = DataLoader(db_path, data_dir)
        counts = loader.load_all()

        assert isinstance(counts, dict)
        expected_tables = {
            "cik_parties", "local_parties", "local_candidates",
            "sections", "protocols", "votes", "preferences",
        }
        assert set(counts.keys()) == expected_tables

    def test_returns_correct_row_counts(self, db_path, data_dir):
        _populate_all_files(data_dir)
        loader = DataLoader(db_path, data_dir)
        counts = loader.load_all()

        assert counts["cik_parties"] == 2
        assert counts["local_parties"] == 1
        assert counts["local_candidates"] == 1
        assert counts["sections"] == 1
        assert counts["protocols"] == 1
        assert counts["votes"] == 2  # 2 party groups normalized
        assert counts["preferences"] == 2

    def test_data_actually_in_database(self, db_path, data_dir):
        _populate_all_files(data_dir)
        loader = DataLoader(db_path, data_dir)
        loader.load_all()

        for table in ["cik_parties", "local_parties", "local_candidates",
                       "sections", "protocols", "votes", "preferences"]:
            count = loader.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            assert count > 0, f"Table {table} should have rows"

    def test_indexes_exist(self, db_path, data_dir):
        _populate_all_files(data_dir)
        loader = DataLoader(db_path, data_dir)
        loader.load_all()

        indexes = loader.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        index_names = [row[0] for row in indexes]

        assert "idx_votes_section_party" in index_names
        assert "idx_votes_party" in index_names
        assert "idx_preferences_section_party" in index_names
        assert "idx_preferences_section" in index_names
        assert "idx_protocols_form" in index_names

    def test_logs_counts(self, db_path, data_dir, caplog):
        _populate_all_files(data_dir)
        loader = DataLoader(db_path, data_dir)
        import logging
        with caplog.at_level(logging.INFO):
            loader.load_all()

        assert "cik_parties" in caplog.text
        assert "protocols" in caplog.text

    def test_empty_files_return_zero_counts(self, db_path, data_dir):
        """All files are empty stubs — every table should have 0 rows."""
        loader = DataLoader(db_path, data_dir)
        counts = loader.load_all()

        for table, count in counts.items():
            assert count == 0, f"Table {table} should have 0 rows with empty files"

    def test_loading_order_preserved(self, db_path, data_dir):
        """load_all() loads tables in the correct order:
        cik_parties, local_parties, local_candidates, sections, protocols, votes, preferences.
        """
        _populate_all_files(data_dir)
        loader = DataLoader(db_path, data_dir)

        call_order = []
        original_load_cik = loader._load_cik_parties
        original_load_lp = loader._load_local_parties
        original_load_lc = loader._load_local_candidates
        original_load_sec = loader._load_sections
        original_load_prot = loader._load_protocols
        original_load_votes = loader._load_votes
        original_load_pref = loader._load_preferences

        def wrap(name, original):
            def wrapper():
                call_order.append(name)
                return original()
            return wrapper

        loader._load_cik_parties = wrap("cik_parties", original_load_cik)
        loader._load_local_parties = wrap("local_parties", original_load_lp)
        loader._load_local_candidates = wrap("local_candidates", original_load_lc)
        loader._load_sections = wrap("sections", original_load_sec)
        loader._load_protocols = wrap("protocols", original_load_prot)
        loader._load_votes = wrap("votes", original_load_votes)
        loader._load_preferences = wrap("preferences", original_load_pref)

        loader.load_all()

        expected_order = [
            "cik_parties", "local_parties", "local_candidates",
            "sections", "protocols", "votes", "preferences",
        ]
        assert call_order == expected_order
