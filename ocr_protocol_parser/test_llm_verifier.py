"""Unit tests for LLM verifier.

Tests with mocked OpenAI API responses to verify:
- Matching values pass through unchanged
- Corrected values are applied and logged
- Fallback behavior when API call fails
- Fallback behavior when API returns invalid JSON

Validates: Requirements 16.3, 16.4, 16.5
"""

from __future__ import annotations

import json
import logging
import sys
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from models import (
    LLMVerifierConfig,
    MachinePreferencesData,
    MachineVotesData,
    Page1Data,
    Page2Data,
    PaperPreferencesData,
    PaperVotesData,
    PreferenceEntry,
    VoteEntry,
)


# ---------------------------------------------------------------------------
# Helpers — mock the openai module before importing llm_verifier
# ---------------------------------------------------------------------------

def _make_config() -> LLMVerifierConfig:
    return LLMVerifierConfig(
        api_base_url="http://localhost:8000/v1",
        api_key="test-key",
        model="test-model",
        timeout=10,
        enabled=True,
    )


def _mock_completion(content_dict: dict) -> MagicMock:
    """Build a mock chat.completions.create return value."""
    message = SimpleNamespace(content=json.dumps(content_dict))
    choice = SimpleNamespace(message=message)
    return SimpleNamespace(choices=[choice])


def _create_verifier_with_mock(mock_openai_cls: MagicMock):
    """Import LLMVerifier and create an instance with a mocked OpenAI client."""
    # Need to re-import to pick up the mock
    import importlib
    import llm_verifier as lv_mod
    importlib.reload(lv_mod)
    verifier = lv_mod.LLMVerifier(_make_config())
    return verifier


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_page1() -> Page1Data:
    return Page1Data(
        control_number="0110151",
        form_type=26,
        form_number="01022018",
        section_code="010100001",
        rik_code="01",
        ballots_received=600,
    )


@pytest.fixture
def sample_page2() -> Page2Data:
    return Page2Data(
        control_number="0110151",
        voter_list_count=500,
        additional_voters=10,
        voted_count=450,
        unused_ballots=150,
        invalid_ballots=5,
        paper_ballots_in_box=445,
        invalid_votes=3,
        no_support_votes=2,
    )


@pytest.fixture
def sample_paper_votes() -> PaperVotesData:
    return PaperVotesData(
        control_numbers=["001", "002"],
        votes=[VoteEntry(2, 100), VoteEntry(4, 200)],
        total_valid_paper_votes=300,
    )


@pytest.fixture
def sample_paper_prefs() -> PaperPreferencesData:
    return PaperPreferencesData(
        control_numbers=["001", "002", "003"],
        preferences=[
            PreferenceEntry(2, 101, 50),
            PreferenceEntry(2, 102, 30),
        ],
    )


@pytest.fixture
def sample_machine_votes() -> MachineVotesData:
    return MachineVotesData(
        control_numbers=["m1", "m2"],
        votes=[VoteEntry(2, 80), VoteEntry(4, 120)],
        machine_ballots_in_box=200,
        no_support_votes_machine=5,
        total_valid_machine_votes=195,
    )


@pytest.fixture
def sample_machine_prefs() -> MachinePreferencesData:
    return MachinePreferencesData(
        control_numbers=["m1"],
        preferences=[PreferenceEntry(2, 101, 30)],
    )


# ---------------------------------------------------------------------------
# Test: Page 1 — matching values pass through unchanged (Req 16.4)
# ---------------------------------------------------------------------------

class TestVerifyPage1:
    def test_matching_values_pass_through(self, sample_page1: Page1Data):
        """When LLM returns same values, original data passes through."""
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion({
            "form_type": 26,
            "form_number": "01022018",
            "section_code": "010100001",
            "rik_code": "01",
            "ballots_received": 600,
        })

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_page1("<html>page1</html>", sample_page1)

        assert result.form_type == sample_page1.form_type
        assert result.form_number == sample_page1.form_number
        assert result.section_code == sample_page1.section_code
        assert result.rik_code == sample_page1.rik_code
        assert result.ballots_received == sample_page1.ballots_received
        assert result.control_number == sample_page1.control_number

    def test_corrected_values_applied(self, sample_page1: Page1Data, caplog):
        """When LLM returns different values, corrected data is applied and logged (Req 16.3)."""
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion({
            "form_type": 26,
            "form_number": "01022018",
            "section_code": "010100001",
            "rik_code": "01",
            "ballots_received": 650,  # corrected
        })

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            with caplog.at_level(logging.INFO):
                result = verifier.verify_page1("<html>page1</html>", sample_page1)

        assert result.ballots_received == 650
        assert result.control_number == sample_page1.control_number
        assert "ballots_received" in caplog.text

    def test_api_failure_returns_original(self, sample_page1: Page1Data):
        """When API call raises, original data is returned unchanged (Req 16.5)."""
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.side_effect = ConnectionError("network down")

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_page1("<html>page1</html>", sample_page1)

        assert result is sample_page1

    def test_invalid_json_returns_original(self, sample_page1: Page1Data):
        """When API returns invalid JSON, original data is returned unchanged."""
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        message = SimpleNamespace(content="not valid json {{{")
        choice = SimpleNamespace(message=message)
        mock_client.chat.completions.create.return_value = SimpleNamespace(choices=[choice])

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_page1("<html>page1</html>", sample_page1)

        assert result is sample_page1


# ---------------------------------------------------------------------------
# Test: Page 2 — matching, corrected, and fallback (Req 16.3, 16.4, 16.5)
# ---------------------------------------------------------------------------

class TestVerifyPage2:
    def test_matching_values_pass_through(self, sample_page2: Page2Data):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion({
            "voter_list_count": 500,
            "additional_voters": 10,
            "voted_count": 450,
            "unused_ballots": 150,
            "invalid_ballots": 5,
            "paper_ballots_in_box": 445,
            "invalid_votes": 3,
            "no_support_votes": 2,
        })

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_page2("<html>page2</html>", sample_page2)

        assert result.voter_list_count == 500
        assert result.voted_count == 450
        assert result.control_number == sample_page2.control_number

    def test_corrected_values_applied(self, sample_page2: Page2Data, caplog):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion({
            "voter_list_count": 510,  # corrected
            "additional_voters": 10,
            "voted_count": 450,
            "unused_ballots": 150,
            "invalid_ballots": 5,
            "paper_ballots_in_box": 445,
            "invalid_votes": 3,
            "no_support_votes": 2,
        })

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            with caplog.at_level(logging.INFO):
                result = verifier.verify_page2("<html>page2</html>", sample_page2)

        assert result.voter_list_count == 510
        assert "voter_list_count" in caplog.text

    def test_api_failure_returns_original(self, sample_page2: Page2Data):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.side_effect = TimeoutError("timeout")

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_page2("<html>page2</html>", sample_page2)

        assert result is sample_page2


# ---------------------------------------------------------------------------
# Test: Paper votes — matching, corrected, and fallback
# ---------------------------------------------------------------------------

class TestVerifyVotes:
    def test_matching_values_pass_through(self, sample_paper_votes: PaperVotesData):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion({
            "votes": [
                {"party_number": 2, "vote_count": 100},
                {"party_number": 4, "vote_count": 200},
            ],
            "total_valid_paper_votes": 300,
        })

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_votes(["<html>p3</html>", "<html>p4</html>"], sample_paper_votes)

        assert len(result.votes) == 2
        assert result.votes[0].vote_count == 100
        assert result.total_valid_paper_votes == 300

    def test_corrected_vote_count(self, sample_paper_votes: PaperVotesData, caplog):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion({
            "votes": [
                {"party_number": 2, "vote_count": 110},  # corrected
                {"party_number": 4, "vote_count": 200},
            ],
            "total_valid_paper_votes": 310,  # corrected
        })

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            with caplog.at_level(logging.INFO):
                result = verifier.verify_votes(["<html>p3</html>"], sample_paper_votes)

        assert result.votes[0].vote_count == 110
        assert result.total_valid_paper_votes == 310
        assert "party_2_votes" in caplog.text

    def test_api_failure_returns_original(self, sample_paper_votes: PaperVotesData):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.side_effect = RuntimeError("API error")

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_votes(["<html>p3</html>"], sample_paper_votes)

        assert result is sample_paper_votes


# ---------------------------------------------------------------------------
# Test: Paper preferences — matching and fallback
# ---------------------------------------------------------------------------

class TestVerifyPreferences:
    def test_matching_values_pass_through(self, sample_paper_prefs: PaperPreferencesData):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion({
            "preferences": [
                {"party_number": 2, "candidate_number": 101, "vote_count": 50},
                {"party_number": 2, "candidate_number": 102, "vote_count": 30},
            ],
        })

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_preferences(["<html>p5</html>"], sample_paper_prefs)

        assert len(result.preferences) == 2
        assert result.preferences[0].vote_count == 50

    def test_api_failure_returns_original(self, sample_paper_prefs: PaperPreferencesData):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception("fail")

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_preferences(["<html>p5</html>"], sample_paper_prefs)

        assert result is sample_paper_prefs


# ---------------------------------------------------------------------------
# Test: Machine votes — matching and fallback
# ---------------------------------------------------------------------------

class TestVerifyMachineVotes:
    def test_matching_values_pass_through(self, sample_machine_votes: MachineVotesData):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion({
            "votes": [
                {"party_number": 2, "vote_count": 80},
                {"party_number": 4, "vote_count": 120},
            ],
            "machine_ballots_in_box": 200,
            "no_support_votes_machine": 5,
            "total_valid_machine_votes": 195,
        })

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_machine_votes(["<html>p8</html>"], sample_machine_votes)

        assert len(result.votes) == 2
        assert result.machine_ballots_in_box == 200

    def test_api_failure_returns_original(self, sample_machine_votes: MachineVotesData):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception("fail")

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_machine_votes(["<html>p8</html>"], sample_machine_votes)

        assert result is sample_machine_votes


# ---------------------------------------------------------------------------
# Test: Machine preferences — matching and fallback
# ---------------------------------------------------------------------------

class TestVerifyMachinePreferences:
    def test_matching_values_pass_through(self, sample_machine_prefs: MachinePreferencesData):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion({
            "preferences": [
                {"party_number": 2, "candidate_number": 101, "vote_count": 30},
            ],
        })

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_machine_preferences(["<html>p10</html>"], sample_machine_prefs)

        assert len(result.preferences) == 1
        assert result.preferences[0].vote_count == 30

    def test_api_failure_returns_original(self, sample_machine_prefs: MachinePreferencesData):
        mock_openai = MagicMock()
        mock_client = MagicMock()
        mock_openai.OpenAI.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception("fail")

        with patch.dict(sys.modules, {"openai": mock_openai}):
            verifier = _create_verifier_with_mock(mock_openai)
            result = verifier.verify_machine_preferences(["<html>p10</html>"], sample_machine_prefs)

        assert result is sample_machine_prefs
