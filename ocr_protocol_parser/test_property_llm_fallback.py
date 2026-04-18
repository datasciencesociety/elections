# Feature: ocr-protocol-parser, Property 12: LLM verification fallback preserves conventional data
"""Property-based tests for LLM verification fallback.

**Validates: Requirements 16.5, 16.7**

Property 12: For any page parsing result, if the LLM API call fails
(timeout, network error, invalid response), the LLM_Verifier SHALL return
the original conventionally-parsed data unchanged. The system SHALL never
produce worse results than conventional parsing alone.
"""

from __future__ import annotations

import importlib
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from hypothesis import given, settings
from hypothesis import strategies as st

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
# Strategies
# ---------------------------------------------------------------------------

control_number_st = st.from_regex(r"[0-9]{5,10}", fullmatch=True)
form_type_st = st.sampled_from([24, 26, 28, 30])
form_number_st = st.from_regex(r"[0-9]{8}", fullmatch=True)
section_code_st = st.from_regex(r"[0-9]{9}", fullmatch=True)
rik_code_st = st.from_regex(r"[0-9]{2}", fullmatch=True)
optional_int_st = st.one_of(st.none(), st.integers(min_value=0, max_value=999_999))

page1_st = st.builds(
    Page1Data,
    control_number=control_number_st,
    form_type=form_type_st,
    form_number=form_number_st,
    section_code=section_code_st,
    rik_code=rik_code_st,
    ballots_received=optional_int_st,
)

page2_st = st.builds(
    Page2Data,
    control_number=control_number_st,
    voter_list_count=optional_int_st,
    additional_voters=optional_int_st,
    voted_count=optional_int_st,
    unused_ballots=optional_int_st,
    invalid_ballots=optional_int_st,
    paper_ballots_in_box=optional_int_st,
    invalid_votes=optional_int_st,
    no_support_votes=optional_int_st,
)

vote_entry_st = st.builds(
    VoteEntry,
    party_number=st.integers(min_value=1, max_value=99),
    vote_count=st.integers(min_value=0, max_value=999_999),
)

paper_votes_st = st.builds(
    PaperVotesData,
    control_numbers=st.lists(control_number_st, min_size=0, max_size=3),
    votes=st.lists(vote_entry_st, min_size=0, max_size=10),
    total_valid_paper_votes=optional_int_st,
)

pref_entry_st = st.builds(
    PreferenceEntry,
    party_number=st.integers(min_value=1, max_value=99),
    candidate_number=st.integers(min_value=101, max_value=122),
    vote_count=st.integers(min_value=0, max_value=999_999),
)

paper_prefs_st = st.builds(
    PaperPreferencesData,
    control_numbers=st.lists(control_number_st, min_size=0, max_size=5),
    preferences=st.lists(pref_entry_st, min_size=0, max_size=10),
)

machine_votes_st = st.builds(
    MachineVotesData,
    control_numbers=st.lists(control_number_st, min_size=0, max_size=3),
    votes=st.lists(vote_entry_st, min_size=0, max_size=10),
    machine_ballots_in_box=optional_int_st,
    no_support_votes_machine=optional_int_st,
    total_valid_machine_votes=optional_int_st,
)

machine_prefs_st = st.builds(
    MachinePreferencesData,
    control_numbers=st.lists(control_number_st, min_size=0, max_size=3),
    preferences=st.lists(pref_entry_st, min_size=0, max_size=10),
)

# Strategy for different error types the API might raise
error_st = st.sampled_from([
    ConnectionError("network down"),
    TimeoutError("request timed out"),
    RuntimeError("API error"),
    ValueError("bad response"),
    OSError("connection refused"),
])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_config() -> LLMVerifierConfig:
    return LLMVerifierConfig(
        api_base_url="http://localhost:8000/v1",
        api_key="test-key",
        model="test-model",
        timeout=10,
        enabled=True,
    )


def _create_failing_verifier(error: Exception):
    """Create an LLMVerifier whose API call always raises the given error."""
    mock_openai = MagicMock()
    mock_client = MagicMock()
    mock_openai.OpenAI.return_value = mock_client
    mock_client.chat.completions.create.side_effect = error

    with patch.dict(sys.modules, {"openai": mock_openai}):
        import llm_verifier as lv_mod
        importlib.reload(lv_mod)
        return lv_mod.LLMVerifier(_make_config())


# ---------------------------------------------------------------------------
# Property tests
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(data=page1_st, error=error_st)
def test_page1_fallback_preserves_data(data: Page1Data, error: Exception) -> None:
    """For any Page1Data, if the LLM API fails, verify_page1 returns the
    original data unchanged."""
    verifier = _create_failing_verifier(error)
    result = verifier.verify_page1("<html>test</html>", data)
    assert result is data


@settings(max_examples=100)
@given(data=page2_st, error=error_st)
def test_page2_fallback_preserves_data(data: Page2Data, error: Exception) -> None:
    """For any Page2Data, if the LLM API fails, verify_page2 returns the
    original data unchanged."""
    verifier = _create_failing_verifier(error)
    result = verifier.verify_page2("<html>test</html>", data)
    assert result is data


@settings(max_examples=100)
@given(data=paper_votes_st, error=error_st)
def test_paper_votes_fallback_preserves_data(data: PaperVotesData, error: Exception) -> None:
    """For any PaperVotesData, if the LLM API fails, verify_votes returns the
    original data unchanged."""
    verifier = _create_failing_verifier(error)
    result = verifier.verify_votes(["<html>test</html>"], data)
    assert result is data


@settings(max_examples=100)
@given(data=paper_prefs_st, error=error_st)
def test_paper_prefs_fallback_preserves_data(data: PaperPreferencesData, error: Exception) -> None:
    """For any PaperPreferencesData, if the LLM API fails, verify_preferences
    returns the original data unchanged."""
    verifier = _create_failing_verifier(error)
    result = verifier.verify_preferences(["<html>test</html>"], data)
    assert result is data


@settings(max_examples=100)
@given(data=machine_votes_st, error=error_st)
def test_machine_votes_fallback_preserves_data(data: MachineVotesData, error: Exception) -> None:
    """For any MachineVotesData, if the LLM API fails, verify_machine_votes
    returns the original data unchanged."""
    verifier = _create_failing_verifier(error)
    result = verifier.verify_machine_votes(["<html>test</html>"], data)
    assert result is data


@settings(max_examples=100)
@given(data=machine_prefs_st, error=error_st)
def test_machine_prefs_fallback_preserves_data(data: MachinePreferencesData, error: Exception) -> None:
    """For any MachinePreferencesData, if the LLM API fails,
    verify_machine_preferences returns the original data unchanged."""
    verifier = _create_failing_verifier(error)
    result = verifier.verify_machine_preferences(["<html>test</html>"], data)
    assert result is data
