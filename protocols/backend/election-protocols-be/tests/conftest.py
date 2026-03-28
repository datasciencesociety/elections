"""Shared test fixtures for the election protocols backend."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from election_protocols_be.models.protocol import (
    CandidatePreference,
    MachineBallots,
    PaperBallots,
    PartyVote,
    Protocol,
    REGION_MAX_PREFERENCES,
)


def _make_votes(region: int) -> list[dict]:
    """Generate one PartyVote dict per required party for a region (all counts zero)."""
    prefs = [{"candidate_number": 100 + i, "count": 0} for i in range(1, REGION_MAX_PREFERENCES[region] + 1)]
    party_numbers = list(range(1, 29)) + ([29] if region == 15 else [])
    return [
        {"party_number": p, "votes": 0, "preferences": [] if (region == 15 and p == 29) else prefs, "no_preferences": 0}
        for p in party_numbers
    ]


@pytest.fixture
def sample_protocol_data():
    """Full protocol JSON — region 12, all 28 parties, all ballot counts zero."""
    region = 12
    votes = _make_votes(region)
    return {
        "sik_no": "120200009",
        "sik_type": "paper_machine",
        "voter_count": 427,
        "additional_voter_count": 3,
        "registered_votes": 0,
        "paper_ballots": {
            "total": 300,
            "unused_ballots": 300,
            "registered_vote": 0,
            "invalid_out_of_the_box": 0,
            "invalid_in_the_box": 0,
            "support_noone": 0,
            "votes": votes,
            "total_valid_votes": 0,
        },
        "machine_ballots": {
            "total_votes": 0,
            "support_noone": 0,
            "total_valid_votes": 0,
            "votes": votes,
        },
    }


@pytest.fixture
def sample_protocol(sample_protocol_data):
    """Parsed Protocol model instance from sample data."""
    return Protocol.model_validate(sample_protocol_data)


@pytest.fixture
def sample_candidate_preference():
    """Single candidate preference fixture."""
    return CandidatePreference(candidate_number=101, count=3)


@pytest.fixture
def sample_party_vote():
    """Single party vote with preferences fixture."""
    return PartyVote(
        party_number=8,
        votes=6,
        preferences=[CandidatePreference(candidate_number=102, count=3)],
        no_preferences=1,
    )


def _make_party_votes_for_region(region: int) -> list[PartyVote]:
    """Generate one PartyVote per required party for a given region (all counts zero)."""
    prefs = [CandidatePreference(candidate_number=100 + i, count=0) for i in range(1, REGION_MAX_PREFERENCES[region] + 1)]
    party_numbers = list(range(1, 29)) + ([29] if region == 15 else [])
    return [
        PartyVote(party_number=p, votes=0, preferences=[] if (region == 15 and p == 29) else prefs, no_preferences=0)
        for p in party_numbers
    ]


@pytest.fixture
def sample_paper_ballots():
    """Paper ballots fixture — region 12, all 28 parties, all ballot counts zero."""
    return PaperBallots(
        total=300,
        unused_ballots=300,
        registered_vote=0,
        invalid_out_of_the_box=0,
        invalid_in_the_box=0,
        support_noone=0,
        votes=_make_party_votes_for_region(12),
        total_valid_votes=0,
    )


@pytest.fixture
def sample_machine_ballots():
    """Machine ballots fixture — region 12, all 28 parties, all ballot counts zero."""
    return MachineBallots(
        total_votes=0,
        support_noone=0,
        total_valid_votes=0,
        votes=_make_party_votes_for_region(12),
    )


@pytest.fixture
def mock_upload_file():
    """Mock UploadFile with async methods."""
    file = MagicMock(spec=["filename", "content_type"])
    file.filename = "test_image.jpg"
    file.content_type = "image/jpeg"
    file.read = AsyncMock(return_value=b"fake image data")
    file.close = AsyncMock()
    return file


@pytest.fixture
def mock_pdf_upload_file():
    """Mock PDF UploadFile."""
    file = MagicMock(spec=["filename", "content_type"])
    file.filename = "protocol.pdf"
    file.content_type = "application/pdf"
    file.read = AsyncMock(return_value=b"fake pdf data")
    file.close = AsyncMock()
    return file


@pytest.fixture
def mock_invalid_upload_file():
    """Mock invalid content type UploadFile."""
    file = MagicMock(spec=["filename", "content_type"])
    file.filename = "document.txt"
    file.content_type = "text/plain"
    file.read = AsyncMock(return_value=b"fake text data")
    file.close = AsyncMock()
    return file


@pytest.fixture
def mock_valid_upload_file():
    """Mock valid image UploadFile."""
    file = MagicMock(spec=["filename", "content_type"])
    file.filename = "test_image.jpg"
    file.content_type = "image/jpeg"
    file.read = AsyncMock(return_value=b"fake image data")
    file.close = AsyncMock()
    return file
