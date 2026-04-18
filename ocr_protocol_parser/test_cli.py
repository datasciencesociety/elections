"""Unit tests for CLI — argument parsing and end-to-end processing.

Requirements: 1.4, 14.3
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cli import discover_sections, main, parse_args


# ---------------------------------------------------------------------------
# Tests — parse_args
# ---------------------------------------------------------------------------


class TestParseArgs:
    """Test CLI argument parsing."""

    def test_required_args(self):
        args = parse_args(["--html-dir", "/data/html", "--output-dir", "/data/out"])
        assert args.html_dir == "/data/html"
        assert args.output_dir == "/data/out"

    def test_missing_html_dir_exits(self):
        with pytest.raises(SystemExit):
            parse_args(["--output-dir", "/data/out"])

    def test_missing_output_dir_exits(self):
        with pytest.raises(SystemExit):
            parse_args(["--html-dir", "/data/html"])

    def test_section_filter(self):
        args = parse_args([
            "--html-dir", "/data/html",
            "--output-dir", "/data/out",
            "--section", "010100001",
        ])
        assert args.section == "010100001"

    def test_section_default_none(self):
        args = parse_args(["--html-dir", "/d", "--output-dir", "/o"])
        assert args.section is None

    def test_log_level_default(self):
        args = parse_args(["--html-dir", "/d", "--output-dir", "/o"])
        assert args.log_level == "INFO"

    def test_log_level_custom(self):
        args = parse_args([
            "--html-dir", "/d", "--output-dir", "/o",
            "--log-level", "DEBUG",
        ])
        assert args.log_level == "DEBUG"

    def test_log_level_invalid_exits(self):
        with pytest.raises(SystemExit):
            parse_args([
                "--html-dir", "/d", "--output-dir", "/o",
                "--log-level", "INVALID",
            ])

    def test_llm_verify_flag_default_false(self):
        args = parse_args(["--html-dir", "/d", "--output-dir", "/o"])
        assert args.llm_verify is False

    def test_llm_verify_flag_set(self):
        args = parse_args([
            "--html-dir", "/d", "--output-dir", "/o",
            "--llm-verify",
        ])
        assert args.llm_verify is True

    def test_llm_model_default(self):
        args = parse_args(["--html-dir", "/d", "--output-dir", "/o"])
        assert args.llm_model == "gpt-4o-mini"

    def test_llm_model_custom(self):
        args = parse_args([
            "--html-dir", "/d", "--output-dir", "/o",
            "--llm-model", "gpt-4",
        ])
        assert args.llm_model == "gpt-4"

    def test_llm_timeout_default(self):
        args = parse_args(["--html-dir", "/d", "--output-dir", "/o"])
        assert args.llm_timeout == 30

    def test_llm_timeout_custom(self):
        args = parse_args([
            "--html-dir", "/d", "--output-dir", "/o",
            "--llm-timeout", "60",
        ])
        assert args.llm_timeout == 60

    def test_llm_api_base_from_arg(self):
        args = parse_args([
            "--html-dir", "/d", "--output-dir", "/o",
            "--llm-api-base", "http://localhost:8080/v1",
        ])
        assert args.llm_api_base == "http://localhost:8080/v1"

    def test_llm_api_key_from_arg(self):
        args = parse_args([
            "--html-dir", "/d", "--output-dir", "/o",
            "--llm-api-key", "sk-test123",
        ])
        assert args.llm_api_key == "sk-test123"


# ---------------------------------------------------------------------------
# Helpers — create minimal HTML test fixtures
# ---------------------------------------------------------------------------


def _make_page1_html(section_code: str, form_type: int = 26) -> str:
    """Create minimal page 1 HTML with required fields."""
    form_map = {24: "75-НС-х", 26: "76-НС-хм", 28: "77-НС-чх", 30: "78-НС-чхм"}
    suffix = form_map[form_type]
    spaced = " ".join(section_code)
    return (
        f'<div data-bbox="100 5 200 25" data-label="Text">0110151</div>\n'
        f'<div data-bbox="100 30 800 60" data-label="Section-Header">'
        f'Приложение № {suffix}</div>\n'
        f'<div data-bbox="100 65 400 85" data-label="Text">01022018</div>\n'
        f'<div data-bbox="100 90 600 110" data-label="Text">{spaced}</div>\n'
        f'<div data-bbox="100 115 600 135" data-label="Text">'
        f'изборен район 01</div>\n'
        f'<div data-bbox="100 140 600 160" data-label="Text">'
        f'А. Брой на получените бюлетини 600 (с цифри)</div>\n'
        f'<div data-bbox="100 900 600 920" data-label="Page-Footer">0110151</div>\n'
    )


def _make_page2_html() -> str:
    """Create minimal page 2 HTML with voter/ballot fields."""
    return (
        '<div data-bbox="100 5 200 25" data-label="Text">0110151</div>\n'
        '<div data-bbox="100 30 800 300" data-label="Form">'
        '<table>'
        '<tr><td>1. Брой на избирателите</td><td>625 (с цифри)</td></tr>'
        '<tr><td>2. Брой</td><td>4 (с цифри)</td></tr>'
        '<tr><td>3. Брой на гласувалите</td><td>310 (с цифри)</td></tr>'
        '<tr><td>4.а)</td><td>445 (с цифри)</td></tr>'
        '<tr><td>4.б)</td><td>1 (с цифри)</td></tr>'
        '<tr><td>5. Брой на намерените</td><td>154 (с цифри)</td></tr>'
        '<tr><td>6. Брой на намерените</td><td>6 (с цифри)</td></tr>'
        '<tr><td>7. Брой на действителните</td><td>6 (с цифри)</td></tr>'
        '</table>'
        '</div>\n'
        '<div data-bbox="100 900 600 920" data-label="Page-Footer">0110151</div>\n'
    )


def _make_vote_page_html(parties: list[tuple[int, int]], page_num: int = 3) -> str:
    """Create minimal vote page HTML."""
    rows = ""
    for pnum, count in parties:
        rows += f'<tr><td>{pnum}.</td><td>Party {pnum}</td><td>{count} (с цифри)</td></tr>'
    return (
        '<div data-bbox="100 5 200 25" data-label="Text">0110151</div>\n'
        f'<div data-bbox="100 30 800 600" data-label="Table">'
        f'<table>{rows}</table></div>\n'
        '<div data-bbox="100 900 600 920" data-label="Page-Footer">0110151</div>\n'
    )


def _make_vote_page4_html(parties: list[tuple[int, int]], total: int) -> str:
    """Create page 4 with votes and total valid votes."""
    rows = ""
    for pnum, count in parties:
        rows += f'<tr><td>{pnum}.</td><td>Party {pnum}</td><td>{count} (с цифри)</td></tr>'
    return (
        '<div data-bbox="100 5 200 25" data-label="Text">0110151</div>\n'
        f'<div data-bbox="100 30 800 600" data-label="Table">'
        f'<table>{rows}</table></div>\n'
        f'<div data-bbox="100 610 800 640" data-label="Text">'
        f'9. Общ брой на действителните гласове {total} (с цифри)</div>\n'
        '<div data-bbox="100 900 600 920" data-label="Page-Footer">0110151</div>\n'
    )


def _make_pref_page_html(prefs: list[tuple[int, int, int]]) -> str:
    """Create minimal preference page HTML."""
    rows = ""
    current_party = None
    for pnum, cand, count in prefs:
        if pnum != current_party:
            rows += f'<tr><td>{pnum}.</td><td>Party {pnum}</td></tr>'
            current_party = pnum
        rows += f'<tr><td>{cand}</td><td>{count} (с цифри)</td></tr>'
    return (
        '<div data-bbox="100 5 200 25" data-label="Text">0110151</div>\n'
        f'<div data-bbox="100 30 800 600" data-label="Table">'
        f'<table>{rows}</table></div>\n'
        '<div data-bbox="100 900 600 920" data-label="Page-Footer">0110151</div>\n'
    )


def _make_empty_page_html() -> str:
    """Create a minimal empty page."""
    return (
        '<div data-bbox="100 5 200 25" data-label="Text">0110151</div>\n'
        '<div data-bbox="100 900 600 920" data-label="Page-Footer">0110151</div>\n'
    )


def _create_form24_section(tmp_path: Path, section_code: str = "010100018") -> Path:
    """Create a Form 24 section directory with 8 pages of test HTML."""
    html_dir = tmp_path / "html"
    section_dir = html_dir / f"{section_code}.0"
    section_dir.mkdir(parents=True)

    # Page 1 — header
    (section_dir / f"{section_code}.0_page_1.html").write_text(
        _make_page1_html(section_code, form_type=24), encoding="utf-8"
    )
    # Page 2 — voter data
    (section_dir / f"{section_code}.0_page_2.html").write_text(
        _make_page2_html(), encoding="utf-8"
    )
    # Pages 3-4 — paper votes
    (section_dir / f"{section_code}.0_page_3.html").write_text(
        _make_vote_page_html([(2, 10), (4, 20)]), encoding="utf-8"
    )
    (section_dir / f"{section_code}.0_page_4.html").write_text(
        _make_vote_page4_html([(18, 30)], total=60), encoding="utf-8"
    )
    # Pages 5-7 — paper preferences
    (section_dir / f"{section_code}.0_page_5.html").write_text(
        _make_pref_page_html([(2, 101, 3), (2, 102, 5)]), encoding="utf-8"
    )
    (section_dir / f"{section_code}.0_page_6.html").write_text(
        _make_pref_page_html([(4, 101, 1)]), encoding="utf-8"
    )
    (section_dir / f"{section_code}.0_page_7.html").write_text(
        _make_empty_page_html(), encoding="utf-8"
    )
    # Page 8 — empty (Form 24 has 8 pages but no machine data)
    (section_dir / f"{section_code}.0_page_8.html").write_text(
        _make_empty_page_html(), encoding="utf-8"
    )

    return html_dir


# ---------------------------------------------------------------------------
# Tests — main() end-to-end
# ---------------------------------------------------------------------------


class TestMainEndToEnd:
    """Test main() end-to-end with mocked SectionProcessor."""

    def test_no_sections_found(self, tmp_path, capsys):
        """When no sections exist, main prints summary with 0."""
        html_dir = tmp_path / "html"
        html_dir.mkdir()
        output_dir = tmp_path / "output"

        main(["--html-dir", str(html_dir), "--output-dir", str(output_dir)])

        captured = capsys.readouterr()
        assert "0 sections processed" in captured.out

    def test_output_files_created(self, tmp_path):
        """main() should create protocols.txt, votes.txt, preferences.txt."""
        from models import (
            PreferenceRecord,
            ProtocolRecord,
            VoteRecord,
        )

        html_dir = tmp_path / "html"
        section_dir = html_dir / "010100001.0"
        section_dir.mkdir(parents=True)
        for i in range(1, 9):
            (section_dir / f"010100001.0_page_{i}.html").write_text(
                _make_empty_page_html(), encoding="utf-8"
            )

        output_dir = tmp_path / "output"

        mock_protocol = ProtocolRecord(
            form_number="01022018",
            section_code="010100001",
            rik_code="01",
            page_numbers="|0110151",
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
            valid_votes_paper=100,
            machine_ballots=None,
            no_support_votes_machine=None,
            valid_votes_machine=None,
        )
        mock_votes = VoteRecord(
            form_number="01022018",
            section_code="010100001",
            rik_code="01",
            party_votes=[(2, 10, 10, 0)],
        )
        mock_prefs = [
            PreferenceRecord(
                form_number="01022018",
                section_code="010100001",
                party_number=2,
                candidate_number=101,
                total_votes=3,
                paper_votes=3,
                machine_votes=0,
            ),
        ]

        with patch("section_processor.SectionProcessor") as MockProcessor:
            instance = MockProcessor.return_value
            instance.process.return_value = (mock_protocol, mock_votes, mock_prefs)

            main(["--html-dir", str(html_dir), "--output-dir", str(output_dir)])

        assert (output_dir / "protocols.txt").exists()
        assert (output_dir / "votes.txt").exists()
        assert (output_dir / "preferences.txt").exists()

        # Verify content is non-empty
        protocols_content = (output_dir / "protocols.txt").read_text(encoding="utf-8")
        assert "01022018" in protocols_content
        assert "010100001" in protocols_content

    def test_section_filter(self, tmp_path, capsys):
        """--section flag should filter to a single section."""
        html_dir = tmp_path / "html"
        for code in ["010100001", "010100002"]:
            d = html_dir / f"{code}.0"
            d.mkdir(parents=True)
            for i in range(1, 3):
                (d / f"{code}.0_page_{i}.html").write_text(
                    _make_empty_page_html(), encoding="utf-8"
                )

        output_dir = tmp_path / "output"

        # Discover only section 010100001
        sections = discover_sections(str(html_dir), section_filter="010100001")
        assert len(sections) == 1
        assert "010100001" in sections[0]

    def test_error_handling_continues(self, tmp_path, capsys):
        """If a section fails, main() should continue and report errors."""
        html_dir = tmp_path / "html"
        for code in ["010100001", "010100002"]:
            d = html_dir / f"{code}.0"
            d.mkdir(parents=True)
            for i in range(1, 3):
                (d / f"{code}.0_page_{i}.html").write_text(
                    _make_empty_page_html(), encoding="utf-8"
                )

        output_dir = tmp_path / "output"

        with patch("section_processor.SectionProcessor") as MockProcessor:
            instance = MockProcessor.return_value
            # First call raises, second succeeds
            from models import ProtocolRecord, VoteRecord
            mock_protocol = ProtocolRecord(
                form_number="01", section_code="010100002", rik_code="01",
                page_numbers="", field5="", field6="",
                ballots_received=None, voter_list_count=None,
                additional_voters=None, voted_count=None,
                unused_ballots=None, invalid_ballots=None,
                paper_ballots=None, invalid_votes=None,
                no_support_votes_paper=None, valid_votes_paper=None,
                machine_ballots=None, no_support_votes_machine=None,
                valid_votes_machine=None,
            )
            mock_votes = VoteRecord(
                form_number="01", section_code="010100002",
                rik_code="01", party_votes=[],
            )
            instance.process.side_effect = [
                Exception("Parse error"),
                (mock_protocol, mock_votes, []),
            ]

            main(["--html-dir", str(html_dir), "--output-dir", str(output_dir)])

        captured = capsys.readouterr()
        assert "1 sections processed" in captured.out
        assert "1 errors" in captured.out

    def test_summary_report_format(self, tmp_path, capsys):
        """Summary report should include sections processed, errors, warnings."""
        html_dir = tmp_path / "html"
        d = html_dir / "010100001.0"
        d.mkdir(parents=True)
        for i in range(1, 3):
            (d / f"010100001.0_page_{i}.html").write_text(
                _make_empty_page_html(), encoding="utf-8"
            )

        output_dir = tmp_path / "output"

        with patch("section_processor.SectionProcessor") as MockProcessor:
            from models import ProtocolRecord, VoteRecord
            instance = MockProcessor.return_value
            instance.process.return_value = (
                ProtocolRecord(
                    form_number="01", section_code="010100001", rik_code="01",
                    page_numbers="", field5="", field6="",
                    ballots_received=None, voter_list_count=None,
                    additional_voters=None, voted_count=None,
                    unused_ballots=None, invalid_ballots=None,
                    paper_ballots=None, invalid_votes=None,
                    no_support_votes_paper=None, valid_votes_paper=None,
                    machine_ballots=None, no_support_votes_machine=None,
                    valid_votes_machine=None,
                ),
                VoteRecord(
                    form_number="01", section_code="010100001",
                    rik_code="01", party_votes=[],
                ),
                [],
            )

            main(["--html-dir", str(html_dir), "--output-dir", str(output_dir)])

        captured = capsys.readouterr()
        assert "1 sections processed" in captured.out
        assert "0 errors" in captured.out
        assert "0 warnings" in captured.out
