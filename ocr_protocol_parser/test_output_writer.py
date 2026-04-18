"""Unit tests for output_writer.py.

Tests format functions against known CIK output lines from official data.
Tests Form 24 vs Form 26 field count differences.

Requirements: 10.1–10.4, 11.1–11.4, 12.1–12.4
"""

from __future__ import annotations

import os
import tempfile

import pytest

from models import PreferenceRecord, ProtocolRecord, VoteRecord
from output_writer import (
    format_preference_line,
    format_protocol_line,
    format_vote_line,
    write_preferences,
    write_protocols,
    write_votes,
)


# ---------------------------------------------------------------------------
# Known CIK data from official election results (010100001, Form 26)
# ---------------------------------------------------------------------------

PROTOCOL_010100001 = ProtocolRecord(
    form_number="26",
    section_code="010100001",
    rik_code="1",
    page_numbers="|0110151|0110151|0110151|0110151|0110151|0110151|0110151|0110151|0110151|0110151|0110151|0110151|0110151|0110151",
    field5="",
    field6="",
    ballots_received=600,
    voter_list_count=625,
    additional_voters=4,
    voted_count=310,
    unused_ballots=445,
    invalid_ballots=1,
    paper_ballots=154,
    invalid_votes=6,
    no_support_votes_paper=6,
    valid_votes_paper=142,
    machine_ballots=156,
    no_support_votes_machine=10,
    valid_votes_machine=146,
)

EXPECTED_PROTOCOL_LINE_010100001 = (
    "26;010100001;1;"
    "|0110151|0110151|0110151|0110151|0110151|0110151|0110151|0110151"
    "|0110151|0110151|0110151|0110151|0110151|0110151"
    ";;;600;625;4;310;445;1;154;6;6;142;156;10;146"
)


# Form 24 section (010100018)
PROTOCOL_010100018 = ProtocolRecord(
    form_number="24",
    section_code="010100018",
    rik_code="1",
    page_numbers="|0100018|0100018|0100018|0100018|0100018|0100018|0100018|0100018",
    field5="",
    field6="",
    ballots_received=100,
    voter_list_count=24,
    additional_voters=5,
    voted_count=20,
    unused_ballots=79,
    invalid_ballots=1,
    paper_ballots=20,
    invalid_votes=2,
    no_support_votes_paper=0,
    valid_votes_paper=18,
    machine_ballots=None,
    no_support_votes_machine=None,
    valid_votes_machine=None,
)

EXPECTED_PROTOCOL_LINE_010100018 = (
    "24;010100018;1;"
    "|0100018|0100018|0100018|0100018|0100018|0100018|0100018|0100018"
    ";;;100;24;5;20;79;1;20;2;0;18;;;"
)


class TestFormatProtocolLine:
    """Tests for format_protocol_line."""

    def test_form26_known_data(self) -> None:
        """Form 26 protocol matches official CIK output."""
        result = format_protocol_line(PROTOCOL_010100001)
        assert result == EXPECTED_PROTOCOL_LINE_010100001

    def test_form24_known_data(self) -> None:
        """Form 24 protocol matches official CIK output with trailing empty fields."""
        result = format_protocol_line(PROTOCOL_010100018)
        assert result == EXPECTED_PROTOCOL_LINE_010100018

    def test_form26_field_count(self) -> None:
        """Form 26 protocol line has 19 fields."""
        line = format_protocol_line(PROTOCOL_010100001)
        assert len(line.split(";")) == 19

    def test_form24_field_count(self) -> None:
        """Form 24 protocol line has 19 fields (trailing empties)."""
        line = format_protocol_line(PROTOCOL_010100018)
        assert len(line.split(";")) == 19

    def test_form24_trailing_semicolons(self) -> None:
        """Form 24 line ends with ;;; for empty machine fields."""
        line = format_protocol_line(PROTOCOL_010100018)
        assert line.endswith(";;;")

    def test_empty_fields_5_6(self) -> None:
        """Fields 5 and 6 are always empty."""
        line = format_protocol_line(PROTOCOL_010100001)
        fields = line.split(";")
        assert fields[4] == ""
        assert fields[5] == ""

    def test_none_fields_become_empty(self) -> None:
        """None values produce empty strings between semicolons."""
        record = ProtocolRecord(
            form_number="26",
            section_code="010100001",
            rik_code="1",
            page_numbers="|123",
            field5="",
            field6="",
            ballots_received=None,
            voter_list_count=None,
            additional_voters=None,
            voted_count=None,
            unused_ballots=None,
            invalid_ballots=None,
            paper_ballots=None,
            invalid_votes=None,
            no_support_votes_paper=None,
            valid_votes_paper=None,
            machine_ballots=None,
            no_support_votes_machine=None,
            valid_votes_machine=None,
        )
        line = format_protocol_line(record)
        fields = line.split(";")
        # All fields from index 6 onward should be empty
        for i in range(6, 19):
            assert fields[i] == "", f"Field {i+1} should be empty"


class TestFormatVoteLine:
    """Tests for format_vote_line."""

    def test_form26_known_data(self) -> None:
        """Form 26 vote line matches official CIK output."""
        record = VoteRecord(
            form_number="26",
            section_code="010100001",
            rik_code="1",
            party_votes=[
                (1, 0, 0, 0), (2, 0, 0, 0), (3, 0, 0, 0), (4, 11, 8, 3),
                (5, 0, 0, 0), (6, 1, 0, 1), (7, 17, 5, 12), (8, 1, 1, 0),
                (9, 0, 0, 0), (10, 1, 0, 1), (11, 0, 0, 0), (12, 46, 22, 24),
                (13, 0, 0, 0), (14, 1, 0, 1), (15, 0, 0, 0), (16, 0, 0, 0),
                (17, 10, 0, 10), (18, 117, 72, 45), (19, 1, 0, 1),
                (20, 0, 0, 0), (21, 1, 1, 0), (22, 1, 1, 0), (23, 0, 0, 0),
                (24, 0, 0, 0), (25, 2, 0, 2), (26, 45, 14, 31),
                (27, 0, 0, 0), (28, 33, 18, 15),
            ],
        )
        expected = (
            "26;010100001;1;"
            "1;0;0;0;2;0;0;0;3;0;0;0;4;11;8;3;5;0;0;0;6;1;0;1;"
            "7;17;5;12;8;1;1;0;9;0;0;0;10;1;0;1;11;0;0;0;12;46;22;24;"
            "13;0;0;0;14;1;0;1;15;0;0;0;16;0;0;0;17;10;0;10;18;117;72;45;"
            "19;1;0;1;20;0;0;0;21;1;1;0;22;1;1;0;23;0;0;0;24;0;0;0;"
            "25;2;0;2;26;45;14;31;27;0;0;0;28;33;18;15"
        )
        result = format_vote_line(record)
        assert result == expected

    def test_form24_machine_zero(self) -> None:
        """Form 24 vote line has machine=0 for all parties."""
        record = VoteRecord(
            form_number="24",
            section_code="010100018",
            rik_code="1",
            party_votes=[
                (1, 0, 0, 0), (7, 1, 1, 0), (12, 1, 1, 0), (18, 14, 14, 0),
            ],
        )
        line = format_vote_line(record)
        fields = line.split(";")
        # Every 4th field starting from index 6 (machine) should be "0"
        for i in range(6, len(fields), 4):
            assert fields[i] == "0", f"Machine field at {i} should be 0"

    def test_header_fields(self) -> None:
        """Vote line starts with formNumber;sectionCode;rikCode."""
        record = VoteRecord(
            form_number="26",
            section_code="010100001",
            rik_code="1",
            party_votes=[(1, 5, 3, 2)],
        )
        line = format_vote_line(record)
        fields = line.split(";")
        assert fields[0] == "26"
        assert fields[1] == "010100001"
        assert fields[2] == "1"

    def test_field_count(self) -> None:
        """Vote line has 3 + 4*N fields."""
        record = VoteRecord(
            form_number="26",
            section_code="010100001",
            rik_code="1",
            party_votes=[(1, 5, 3, 2), (2, 10, 7, 3)],
        )
        line = format_vote_line(record)
        fields = line.split(";")
        assert len(fields) == 3 + 4 * 2


class TestFormatPreferenceLine:
    """Tests for format_preference_line."""

    def test_known_data(self) -> None:
        """Preference line matches official CIK output."""
        record = PreferenceRecord(
            form_number="26",
            section_code="010100001",
            party_number=4,
            candidate_number=105,
            total_votes=3,
            paper_votes=2,
            machine_votes=1,
        )
        result = format_preference_line(record)
        assert result == "26;010100001;4;105;3;2;1"

    def test_seven_fields(self) -> None:
        """Preference line has exactly 7 fields."""
        record = PreferenceRecord(
            form_number="24",
            section_code="010100018",
            party_number=7,
            candidate_number=102,
            total_votes=1,
            paper_votes=1,
            machine_votes=0,
        )
        line = format_preference_line(record)
        assert len(line.split(";")) == 7

    def test_form24_machine_zero(self) -> None:
        """Form 24 preference has machine_votes=0."""
        record = PreferenceRecord(
            form_number="24",
            section_code="010100018",
            party_number=7,
            candidate_number=102,
            total_votes=1,
            paper_votes=1,
            machine_votes=0,
        )
        line = format_preference_line(record)
        fields = line.split(";")
        assert fields[6] == "0"


class TestWriteFunctions:
    """Tests for write_protocols, write_votes, write_preferences."""

    def test_write_protocols(self) -> None:
        """write_protocols writes one line per record."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "protocols.txt")
            write_protocols([PROTOCOL_010100001, PROTOCOL_010100018], path)

            with open(path, encoding="utf-8") as f:
                lines = f.read().strip().split("\n")

            assert len(lines) == 2
            assert lines[0] == EXPECTED_PROTOCOL_LINE_010100001
            assert lines[1] == EXPECTED_PROTOCOL_LINE_010100018

    def test_write_votes(self) -> None:
        """write_votes writes one line per record."""
        record = VoteRecord(
            form_number="26",
            section_code="010100001",
            rik_code="1",
            party_votes=[(1, 5, 3, 2)],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "votes.txt")
            write_votes([record], path)

            with open(path, encoding="utf-8") as f:
                lines = f.read().strip().split("\n")

            assert len(lines) == 1
            assert lines[0] == "26;010100001;1;1;5;3;2"

    def test_write_preferences(self) -> None:
        """write_preferences writes one line per record."""
        records = [
            PreferenceRecord("26", "010100001", 4, 101, 1, 1, 0),
            PreferenceRecord("26", "010100001", 4, 102, 1, 1, 0),
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "preferences.txt")
            write_preferences(records, path)

            with open(path, encoding="utf-8") as f:
                lines = f.read().strip().split("\n")

            assert len(lines) == 2
            assert lines[0] == "26;010100001;4;101;1;1;0"
            assert lines[1] == "26;010100001;4;102;1;1;0"

    def test_write_creates_parent_dirs(self) -> None:
        """write functions create parent directories if needed."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "sub", "dir", "protocols.txt")
            write_protocols([PROTOCOL_010100001], path)
            assert os.path.exists(path)

    def test_write_empty_list(self) -> None:
        """Writing empty list creates empty file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "protocols.txt")
            write_protocols([], path)
            with open(path, encoding="utf-8") as f:
                content = f.read()
            assert content == ""
