"""Unit tests for section_processor — SectionProcessor aggregation, routing, error handling.

Requirements: 15.1, 15.3, 14.1
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import (
    FormTypeError,
    MachinePreferencesData,
    MachineVotesData,
    Page1Data,
    Page2Data,
    PaperPreferencesData,
    PaperVotesData,
    PreferenceEntry,
    PreferenceRecord,
    ProtocolRecord,
    VoteEntry,
    VoteRecord,
)
from section_processor import SectionProcessor


# ---------------------------------------------------------------------------
# Fixtures — mock page data
# ---------------------------------------------------------------------------

def _page1_form26() -> Page1Data:
    return Page1Data(
        control_number="0110151",
        form_type=26,
        form_number="01022018",
        section_code="010100001",
        rik_code="01",
        ballots_received=600,
    )


def _page1_form24() -> Page1Data:
    return Page1Data(
        control_number="0100018",
        form_type=24,
        form_number="01022019",
        section_code="010100018",
        rik_code="01",
        ballots_received=100,
    )


def _page2_data() -> Page2Data:
    return Page2Data(
        control_number="0110151",
        voter_list_count=625,
        additional_voters=4,
        voted_count=310,
        unused_ballots=445,
        invalid_ballots=1,
        paper_ballots_in_box=154,
        invalid_votes=6,
        no_support_votes=6,
    )


def _paper_votes() -> PaperVotesData:
    return PaperVotesData(
        control_numbers=["0110151", "0110151"],
        votes=[
            VoteEntry(party_number=2, vote_count=10),
            VoteEntry(party_number=4, vote_count=20),
            VoteEntry(party_number=18, vote_count=70),
        ],
        total_valid_paper_votes=100,
    )


def _paper_prefs() -> PaperPreferencesData:
    return PaperPreferencesData(
        control_numbers=["0110151", "0110151", "0110151"],
        preferences=[
            PreferenceEntry(party_number=2, candidate_number=101, vote_count=3),
            PreferenceEntry(party_number=2, candidate_number=102, vote_count=5),
            PreferenceEntry(party_number=4, candidate_number=101, vote_count=1),
        ],
    )


def _machine_votes() -> MachineVotesData:
    return MachineVotesData(
        control_numbers=["0110151", "0110151"],
        votes=[
            VoteEntry(party_number=2, vote_count=5),
            VoteEntry(party_number=4, vote_count=15),
            VoteEntry(party_number=18, vote_count=80),
        ],
        machine_ballots_in_box=160,
        no_support_votes_machine=2,
        total_valid_machine_votes=100,
    )


def _machine_prefs() -> MachinePreferencesData:
    return MachinePreferencesData(
        control_numbers=["0110151", "0110151"],
        preferences=[
            PreferenceEntry(party_number=2, candidate_number=101, vote_count=2),
            PreferenceEntry(party_number=2, candidate_number=102, vote_count=1),
            PreferenceEntry(party_number=4, candidate_number=101, vote_count=4),
        ],
    )


# ---------------------------------------------------------------------------
# Helper to create a temp section directory with dummy HTML files
# ---------------------------------------------------------------------------

def _create_section_dir(tmp_path: Path, section_code: str, num_pages: int) -> Path:
    """Create a section directory with dummy HTML files."""
    section_dir = tmp_path / f"{section_code}.0"
    section_dir.mkdir()
    for i in range(1, num_pages + 1):
        html_file = section_dir / f"{section_code}.0_page_{i}.html"
        html_file.write_text(
            f'<div data-bbox="100 5 200 25" data-label="Text">0000000</div>',
            encoding="utf-8",
        )
    return section_dir


# ---------------------------------------------------------------------------
# Tests — Form 26 aggregation
# ---------------------------------------------------------------------------


class TestForm26Aggregation:
    """Test aggregation logic for Form 26 (paper + machine)."""

    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path):
        self.section_dir = _create_section_dir(tmp_path, "010100001", 14)
        self.processor = SectionProcessor(str(self.section_dir))

    @patch("section_processor.parse_machine_preference_pages")
    @patch("section_processor.parse_machine_vote_pages")
    @patch("section_processor.parse_preference_pages")
    @patch("section_processor.parse_vote_pages")
    @patch("section_processor.parse_page2")
    @patch("section_processor.parse_page1")
    def test_aggregation_form26(
        self, mock_p1, mock_p2, mock_votes, mock_prefs,
        mock_mvotes, mock_mprefs,
    ):
        mock_p1.return_value = _page1_form26()
        mock_p2.return_value = _page2_data()
        mock_votes.return_value = _paper_votes()
        mock_prefs.return_value = _paper_prefs()
        mock_mvotes.return_value = _machine_votes()
        mock_mprefs.return_value = _machine_prefs()

        protocol, votes, preferences = self.processor.process()

        # Protocol record
        assert protocol.form_number == "01022018"
        assert protocol.section_code == "010100001"
        assert protocol.rik_code == "01"
        assert protocol.ballots_received == 600
        assert protocol.voter_list_count == 625
        assert protocol.valid_votes_paper == 100
        assert protocol.machine_ballots == 160
        assert protocol.valid_votes_machine == 100
        assert protocol.field5 == ""
        assert protocol.field6 == ""

        # Vote record: total = paper + machine
        assert votes.form_number == "01022018"
        assert len(votes.party_votes) == 3
        for pn, total, paper, machine in votes.party_votes:
            assert total == paper + machine

        # Party 2: paper=10, machine=5, total=15
        p2 = next(t for t in votes.party_votes if t[0] == 2)
        assert p2 == (2, 15, 10, 5)

        # Party 18: paper=70, machine=80, total=150
        p18 = next(t for t in votes.party_votes if t[0] == 18)
        assert p18 == (18, 150, 70, 80)

        # Preference records: total = paper + machine
        for pr in preferences:
            assert pr.total_votes == pr.paper_votes + pr.machine_votes

        # Party 2, candidate 101: paper=3, machine=2, total=5
        pr_2_101 = next(
            p for p in preferences
            if p.party_number == 2 and p.candidate_number == 101
        )
        assert pr_2_101.paper_votes == 3
        assert pr_2_101.machine_votes == 2
        assert pr_2_101.total_votes == 5


# ---------------------------------------------------------------------------
# Tests — Form 24 routing (paper only)
# ---------------------------------------------------------------------------


class TestForm24Routing:
    """Test that Form 24 sets machine=0 and total=paper."""

    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path):
        self.section_dir = _create_section_dir(tmp_path, "010100018", 8)
        self.processor = SectionProcessor(str(self.section_dir))

    @patch("section_processor.parse_preference_pages")
    @patch("section_processor.parse_vote_pages")
    @patch("section_processor.parse_page2")
    @patch("section_processor.parse_page1")
    def test_form24_no_machine(
        self, mock_p1, mock_p2, mock_votes, mock_prefs,
    ):
        mock_p1.return_value = _page1_form24()
        mock_p2.return_value = _page2_data()
        mock_votes.return_value = _paper_votes()
        mock_prefs.return_value = _paper_prefs()

        protocol, votes, preferences = self.processor.process()

        # Protocol: machine fields should be None
        assert protocol.machine_ballots is None
        assert protocol.no_support_votes_machine is None
        assert protocol.valid_votes_machine is None

        # Votes: machine=0, total=paper
        for pn, total, paper, machine in votes.party_votes:
            assert machine == 0, f"Party {pn}: machine should be 0"
            assert total == paper, f"Party {pn}: total should equal paper"

        # Preferences: machine=0, total=paper
        for pr in preferences:
            assert pr.machine_votes == 0
            assert pr.total_votes == pr.paper_votes


# ---------------------------------------------------------------------------
# Tests — Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    """Test error handling for missing pages and FormTypeError."""

    def test_missing_page1_raises_form_type_error(self, tmp_path):
        """If page 1 is missing, FormTypeError should be raised."""
        section_dir = tmp_path / "999999999.0"
        section_dir.mkdir()
        # No HTML files at all
        processor = SectionProcessor(str(section_dir))
        with pytest.raises(FormTypeError, match="Page 1 not found"):
            processor.process()

    def test_missing_page2_logs_warning(self, tmp_path):
        """If page 2 is missing, process should still work with None page2 data."""
        section_dir = _create_section_dir(tmp_path, "010100099", 1)
        # Only page 1 exists
        processor = SectionProcessor(str(section_dir))

        with patch("section_processor.parse_page1") as mock_p1:
            mock_p1.return_value = _page1_form24()
            protocol, votes, preferences = processor.process()

        # Page 2 fields should be None
        assert protocol.voter_list_count is None
        assert protocol.voted_count is None

    def test_html_files_sorted_by_page_number(self, tmp_path):
        """HTML files should be loaded sorted by page number."""
        section_dir = tmp_path / "010100001.0"
        section_dir.mkdir()
        # Create files in reverse order
        for i in [5, 3, 1, 4, 2]:
            f = section_dir / f"010100001.0_page_{i}.html"
            f.write_text(
                f'<div data-bbox="100 5 200 25" data-label="Text">000</div>',
                encoding="utf-8",
            )
        processor = SectionProcessor(str(section_dir))
        page_nums = []
        for f in processor.html_files:
            import re
            m = re.search(r"_page_(\d+)\.html$", f.name)
            if m:
                page_nums.append(int(m.group(1)))
        assert page_nums == [1, 2, 3, 4, 5]


# ---------------------------------------------------------------------------
# Tests — LLM verifier integration
# ---------------------------------------------------------------------------


class TestLLMVerifierIntegration:
    """Test that LLM verifier is called when provided."""

    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path):
        self.section_dir = _create_section_dir(tmp_path, "010100001", 14)
        self.mock_verifier = MagicMock()
        self.processor = SectionProcessor(
            str(self.section_dir), llm_verifier=self.mock_verifier
        )

    @patch("section_processor.parse_machine_preference_pages")
    @patch("section_processor.parse_machine_vote_pages")
    @patch("section_processor.parse_preference_pages")
    @patch("section_processor.parse_vote_pages")
    @patch("section_processor.parse_page2")
    @patch("section_processor.parse_page1")
    def test_llm_verifier_called_for_all_pages(
        self, mock_p1, mock_p2, mock_votes, mock_prefs,
        mock_mvotes, mock_mprefs,
    ):
        p1 = _page1_form26()
        mock_p1.return_value = p1
        self.mock_verifier.verify_page1.return_value = p1
        mock_p2.return_value = _page2_data()
        self.mock_verifier.verify_page2.return_value = _page2_data()
        mock_votes.return_value = _paper_votes()
        self.mock_verifier.verify_votes.return_value = _paper_votes()
        mock_prefs.return_value = _paper_prefs()
        self.mock_verifier.verify_preferences.return_value = _paper_prefs()
        mock_mvotes.return_value = _machine_votes()
        self.mock_verifier.verify_machine_votes.return_value = _machine_votes()
        mock_mprefs.return_value = _machine_prefs()
        self.mock_verifier.verify_machine_preferences.return_value = _machine_prefs()

        self.processor.process()

        self.mock_verifier.verify_page1.assert_called_once()
        self.mock_verifier.verify_page2.assert_called_once()
        self.mock_verifier.verify_votes.assert_called_once()
        self.mock_verifier.verify_preferences.assert_called_once()
        self.mock_verifier.verify_machine_votes.assert_called_once()
        self.mock_verifier.verify_machine_preferences.assert_called_once()

    @patch("section_processor.parse_preference_pages")
    @patch("section_processor.parse_vote_pages")
    @patch("section_processor.parse_page2")
    @patch("section_processor.parse_page1")
    def test_no_llm_calls_for_form24(
        self, mock_p1, mock_p2, mock_votes, mock_prefs,
    ):
        """For Form 24, machine verifier methods should not be called."""
        section_dir_24 = self.section_dir.parent / "010100018.0"
        section_dir_24.mkdir()
        for i in range(1, 9):
            f = section_dir_24 / f"010100018.0_page_{i}.html"
            f.write_text(
                '<div data-bbox="100 5 200 25" data-label="Text">000</div>',
                encoding="utf-8",
            )
        processor = SectionProcessor(
            str(section_dir_24), llm_verifier=self.mock_verifier
        )

        mock_p1.return_value = _page1_form24()
        self.mock_verifier.verify_page1.return_value = _page1_form24()
        mock_p2.return_value = _page2_data()
        self.mock_verifier.verify_page2.return_value = _page2_data()
        mock_votes.return_value = _paper_votes()
        self.mock_verifier.verify_votes.return_value = _paper_votes()
        mock_prefs.return_value = _paper_prefs()
        self.mock_verifier.verify_preferences.return_value = _paper_prefs()

        processor.process()

        self.mock_verifier.verify_page1.assert_called_once()
        self.mock_verifier.verify_page2.assert_called_once()
        self.mock_verifier.verify_machine_votes.assert_not_called()
        self.mock_verifier.verify_machine_preferences.assert_not_called()
