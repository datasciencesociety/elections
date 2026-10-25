"""Integration tests against the 2024 election data folder.

Validates Requirements 6.1, 6.2, 6.3:
- Loader produces identical row counts per table (6.1)
- Validator produces the same violation count (6.2)
- UTF-8 and Windows-1251 encoding support is preserved (6.3)
"""

import os
import re
import tempfile

import pytest

from loader import DataLoader
from validator import ValidationEngine

DATA_DIR_2024 = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "election-results-2024")
)

skip_if_no_data = pytest.mark.skipif(
    not os.path.isdir(DATA_DIR_2024),
    reason=f"2024 data folder not found at {DATA_DIR_2024}",
)

# Baseline row counts from the 2024 data (hardcoded from a verified run)
EXPECTED_ROW_COUNTS = {
    "cik_parties": 28,
    "local_parties": 841,
    "local_candidates": 6031,
    "sections": 12920,
    "protocols": 12920,
    "votes": 362154,
    "preferences": 2998892,
}

EXPECTED_VIOLATION_COUNT = 351

CYRILLIC_PATTERN = re.compile(r"[\u0400-\u04FF]")


@pytest.fixture(scope="module")
def loaded_db():
    """Load the 2024 data into a temporary SQLite database (once per module)."""
    db_path = os.path.join(tempfile.gettempdir(), "test_integration_2024.db")
    loader = DataLoader(db_path, DATA_DIR_2024)
    counts = loader.load_all()
    yield db_path, counts
    loader.conn.close()
    try:
        os.unlink(db_path)
    except OSError:
        pass


@skip_if_no_data
class TestRowCounts:
    """Validates Requirement 6.1: identical row counts per table."""

    def test_all_tables_loaded(self, loaded_db):
        _, counts = loaded_db
        assert set(counts.keys()) == set(EXPECTED_ROW_COUNTS.keys())

    @pytest.mark.parametrize("table,expected", list(EXPECTED_ROW_COUNTS.items()))
    def test_row_count(self, loaded_db, table, expected):
        _, counts = loaded_db
        assert counts[table] == expected, (
            f"Table '{table}': expected {expected} rows, got {counts[table]}"
        )


@skip_if_no_data
class TestValidation:
    """Validates Requirement 6.2: same violation set as baseline."""

    def test_violation_count(self, loaded_db):
        db_path, _ = loaded_db
        engine = ValidationEngine(db_path)
        violations = engine.run_all()
        engine.conn.close()
        assert len(violations) == EXPECTED_VIOLATION_COUNT, (
            f"Expected {EXPECTED_VIOLATION_COUNT} violations, got {len(violations)}"
        )

    def test_violations_have_required_fields(self, loaded_db):
        db_path, _ = loaded_db
        engine = ValidationEngine(db_path)
        violations = engine.run_all()
        engine.conn.close()
        for v in violations[:10]:  # spot-check first 10
            assert v.rule_id
            assert v.section_code
            assert v.description


@skip_if_no_data
class TestEncodingSupport:
    """Validates Requirement 6.3: UTF-8 and Windows-1251 encoding preserved."""

    def test_cyrillic_in_party_names(self, loaded_db):
        db_path, _ = loaded_db
        import sqlite3

        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT party_name FROM cik_parties").fetchall()
        conn.close()
        cyrillic_count = sum(
            1 for (name,) in rows if CYRILLIC_PATTERN.search(name)
        )
        assert cyrillic_count > 0, "No Cyrillic party names found"

    def test_cyrillic_in_settlement_names(self, loaded_db):
        db_path, _ = loaded_db
        import sqlite3

        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            "SELECT settlement_name FROM sections LIMIT 100"
        ).fetchall()
        conn.close()
        cyrillic_count = sum(
            1 for (name,) in rows if CYRILLIC_PATTERN.search(name)
        )
        assert cyrillic_count > 0, "No Cyrillic settlement names found"

    def test_cyrillic_in_candidate_names(self, loaded_db):
        db_path, _ = loaded_db
        import sqlite3

        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            "SELECT candidate_name FROM local_candidates LIMIT 100"
        ).fetchall()
        conn.close()
        cyrillic_count = sum(
            1 for (name,) in rows if CYRILLIC_PATTERN.search(name)
        )
        assert cyrillic_count > 0, "No Cyrillic candidate names found"
