"""Unit tests for ReportGenerator."""

import os
import tempfile

import pytest

from reporter import ReportGenerator
from validator import Violation


@pytest.fixture
def reporter():
    return ReportGenerator()


@pytest.fixture
def sample_violations():
    return [
        Violation(
            rule_id="R2.1",
            section_code="010100001",
            description="Получени бюлетини ≠ неизползвани + сгрешени + намерени в кутията",
            expected_value="500",
            actual_value="510",
        ),
        Violation(
            rule_id="R2.1",
            section_code="010100002",
            description="Получени бюлетини ≠ неизползвани + сгрешени + намерени в кутията",
            expected_value="300",
            actual_value="305",
        ),
        Violation(
            rule_id="R3.1",
            section_code="020200001",
            description="Сума гласове по партии ≠ общо валидни в протокола",
            expected_value="200",
            actual_value="195",
        ),
    ]


class TestWriteCsv:
    """Tests for write_csv method."""

    def test_csv_uses_semicolon_delimiter(self, reporter, sample_violations):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8") as f:
            path = f.name
        try:
            reporter.write_csv(sample_violations, path)
            with open(path, encoding="utf-8") as f:
                lines = f.readlines()
            # Header + 3 data rows
            assert len(lines) == 4
            # Every line uses semicolons
            for line in lines:
                assert ";" in line
        finally:
            os.unlink(path)

    def test_csv_has_correct_header(self, reporter, sample_violations):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8") as f:
            path = f.name
        try:
            reporter.write_csv(sample_violations, path)
            with open(path, encoding="utf-8") as f:
                header = f.readline().strip()
            assert header == "rule_id;section_code;description;expected_value;actual_value"
        finally:
            os.unlink(path)

    def test_csv_data_rows_match_violations(self, reporter, sample_violations):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8") as f:
            path = f.name
        try:
            reporter.write_csv(sample_violations, path)
            with open(path, encoding="utf-8") as f:
                lines = f.readlines()
            # Check first data row
            parts = lines[1].strip().split(";")
            assert parts[0] == "R2.1"
            assert parts[1] == "010100001"
        finally:
            os.unlink(path)

    def test_csv_empty_violations(self, reporter):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8") as f:
            path = f.name
        try:
            reporter.write_csv([], path)
            with open(path, encoding="utf-8") as f:
                lines = f.readlines()
            # Only header row
            assert len(lines) == 1
            assert lines[0].strip() == "rule_id;section_code;description;expected_value;actual_value"
        finally:
            os.unlink(path)

    def test_csv_utf8_encoding(self, reporter, sample_violations):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8") as f:
            path = f.name
        try:
            reporter.write_csv(sample_violations, path)
            with open(path, encoding="utf-8") as f:
                content = f.read()
            # Bulgarian text should be present
            assert "Получени бюлетини" in content
        finally:
            os.unlink(path)


class TestPrintSummary:
    """Tests for print_summary method."""

    def test_summary_with_violations(self, reporter, sample_violations, capsys):
        rules_run = ["R2.1", "R3.1", "R5.1"]
        reporter.print_summary(sample_violations, rules_run)
        output = capsys.readouterr().out

        assert "R2.1: 2 нарушения" in output
        assert "R3.1: 1 нарушения" in output
        assert "R5.1: OK" in output
        assert "Общо нарушения: 3" in output

    def test_summary_all_passed(self, reporter, capsys):
        rules_run = ["R2.1", "R3.1"]
        reporter.print_summary([], rules_run)
        output = capsys.readouterr().out

        assert "R2.1: OK" in output
        assert "R3.1: OK" in output
        assert "Общо нарушения: 0" in output

    def test_summary_empty_violations_empty_rules(self, reporter, capsys):
        reporter.print_summary([], [])
        output = capsys.readouterr().out

        assert "Общо нарушения: 0" in output

    def test_summary_header_in_bulgarian(self, reporter, capsys):
        reporter.print_summary([], ["R2.1"])
        output = capsys.readouterr().out

        assert "Резултати от валидацията" in output

    def test_summary_rules_sorted(self, reporter, sample_violations, capsys):
        rules_run = ["R5.1", "R2.1", "R3.1"]
        reporter.print_summary(sample_violations, rules_run)
        output = capsys.readouterr().out

        # R2.1 should appear before R3.1 which should appear before R5.1
        pos_r2 = output.index("R2.1")
        pos_r3 = output.index("R3.1")
        pos_r5 = output.index("R5.1")
        assert pos_r2 < pos_r3 < pos_r5
