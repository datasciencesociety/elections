"""Unit tests for CLI argument parsing and pipeline orchestration."""

import argparse
import os
import sqlite3
import tempfile
from unittest.mock import MagicMock, patch

import pytest

from cli import main, parse_args


# ---------------------------------------------------------------------------
# Task 11.2 — Argument parsing tests
# ---------------------------------------------------------------------------

class TestParseArgs:
    """Test CLI argument parsing with valid and invalid inputs."""

    def test_required_data_dir(self):
        """data_dir is required — omitting it should raise SystemExit."""
        with pytest.raises(SystemExit):
            parse_args([])

    def test_data_dir_only(self):
        """Providing only data_dir should use all defaults."""
        args = parse_args(["/some/path"])
        assert args.data_dir == "/some/path"
        assert args.rules is None
        assert args.output == "validation_report.csv"
        assert args.db == "election_data.db"

    def test_custom_output(self):
        """--output overrides the default CSV path."""
        args = parse_args(["/data", "--output", "my_report.csv"])
        assert args.output == "my_report.csv"

    def test_custom_db(self):
        """--db overrides the default SQLite path."""
        args = parse_args(["/data", "--db", "custom.db"])
        assert args.db == "custom.db"

    def test_rules_single(self):
        """--rules with a single rule id."""
        args = parse_args(["/data", "--rules", "R2.1"])
        assert args.rules == ["R2.1"]

    def test_rules_multiple(self):
        """--rules with multiple rule ids."""
        args = parse_args(["/data", "--rules", "R2.1", "R3.4", "R5.6"])
        assert args.rules == ["R2.1", "R3.4", "R5.6"]

    def test_all_options_combined(self):
        """All options provided together."""
        args = parse_args([
            "/data/dir",
            "--rules", "R2.1", "R7.5",
            "--output", "out.csv",
            "--db", "test.db",
        ])
        assert args.data_dir == "/data/dir"
        assert args.rules == ["R2.1", "R7.5"]
        assert args.output == "out.csv"
        assert args.db == "test.db"

    def test_unknown_argument_exits(self):
        """Unknown arguments should cause SystemExit."""
        with pytest.raises(SystemExit):
            parse_args(["/data", "--unknown"])


# ---------------------------------------------------------------------------
# Task 11.2 — --rules filtering passes correct list to ValidationEngine
# ---------------------------------------------------------------------------

class TestRulesFiltering:
    """Verify that --rules filtering is correctly forwarded to ValidationEngine.run_all."""

    @patch("cli.ReportGenerator")
    @patch("cli.ValidationEngine")
    @patch("cli.DataLoader")
    def test_rules_passed_to_engine(self, mock_loader_cls, mock_engine_cls, mock_reporter_cls):
        """When --rules is provided, run_all receives the exact list."""
        mock_loader = MagicMock()
        mock_loader.load_all.return_value = {"protocols": 10}
        mock_loader_cls.return_value = mock_loader

        mock_engine = MagicMock()
        mock_engine.run_all.return_value = []
        mock_engine._get_rules.return_value = {"R2.1": None, "R3.4": None}
        mock_engine_cls.return_value = mock_engine

        mock_reporter = MagicMock()
        mock_reporter_cls.return_value = mock_reporter

        main(["/fake/dir", "--rules", "R2.1", "R3.4"])

        mock_engine.run_all.assert_called_once_with(rules=["R2.1", "R3.4"])

    @patch("cli.ReportGenerator")
    @patch("cli.ValidationEngine")
    @patch("cli.DataLoader")
    def test_no_rules_passes_none(self, mock_loader_cls, mock_engine_cls, mock_reporter_cls):
        """When --rules is omitted, run_all receives None (run all rules)."""
        mock_loader = MagicMock()
        mock_loader.load_all.return_value = {"protocols": 5}
        mock_loader_cls.return_value = mock_loader

        mock_engine = MagicMock()
        mock_engine.run_all.return_value = []
        mock_engine._get_rules.return_value = {"R2.1": None}
        mock_engine_cls.return_value = mock_engine

        mock_reporter = MagicMock()
        mock_reporter_cls.return_value = mock_reporter

        main(["/fake/dir"])

        mock_engine.run_all.assert_called_once_with(rules=None)

    @patch("cli.ReportGenerator")
    @patch("cli.ValidationEngine")
    @patch("cli.DataLoader")
    def test_pipeline_calls_reporter(self, mock_loader_cls, mock_engine_cls, mock_reporter_cls):
        """Pipeline calls write_csv and print_summary on the reporter."""
        mock_loader = MagicMock()
        mock_loader.load_all.return_value = {}
        mock_loader_cls.return_value = mock_loader

        mock_engine = MagicMock()
        mock_engine.run_all.return_value = []
        mock_engine._get_rules.return_value = {"R2.1": None, "R2.2": None}
        mock_engine_cls.return_value = mock_engine

        mock_reporter = MagicMock()
        mock_reporter_cls.return_value = mock_reporter

        main(["/fake/dir", "--output", "test_out.csv"])

        mock_reporter.write_csv.assert_called_once_with([], "test_out.csv")
        mock_reporter.print_summary.assert_called_once_with([], ["R2.1", "R2.2"])

    @patch("cli.ReportGenerator")
    @patch("cli.ValidationEngine")
    @patch("cli.DataLoader")
    def test_rules_run_uses_filtered_list_for_summary(self, mock_loader_cls, mock_engine_cls, mock_reporter_cls):
        """When --rules is provided, print_summary receives the filtered list, not all rules."""
        mock_loader = MagicMock()
        mock_loader.load_all.return_value = {}
        mock_loader_cls.return_value = mock_loader

        mock_engine = MagicMock()
        mock_engine.run_all.return_value = []
        mock_engine._get_rules.return_value = {"R2.1": None, "R2.2": None, "R3.1": None}
        mock_engine_cls.return_value = mock_engine

        mock_reporter = MagicMock()
        mock_reporter_cls.return_value = mock_reporter

        main(["/fake/dir", "--rules", "R2.1", "R3.1"])

        # print_summary should receive only the filtered rules, not all rules
        mock_reporter.print_summary.assert_called_once_with([], ["R2.1", "R3.1"])
