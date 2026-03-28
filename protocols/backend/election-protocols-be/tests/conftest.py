"""Shared test fixtures for the election protocols backend."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from election_protocols_be.models.protocol import (
    CandidatePreference,
    MachineBallots,
    PaperBallots,
    PartyVote,
    Protocol,
)


@pytest.fixture
def sample_protocol_data():
    """Full protocol JSON from the task example."""
    return {
        "sik_no": "12020009",
        "sik_type": "paper",
        "voter_count": 427,
        "additional_voter_count": 3,
        "registered_votes": 160,
        "paper_ballots": {
            "total": 300,
            "unused_ballots": 217,
            "registered_vote": 82,
            "invalid_out_of_the_box": 1,
            "invalid_in_the_box": 1,
            "support_noone": 0,
            "votes": [
                {
                    "party_number": 8,
                    "votes": 6,
                    "preferences": [
                        {
                            "candidate_number": 102,
                            "count": 3,
                        }
                    ],
                    "no_preferences": 1,
                }
            ],
            "total_valid_votes": 81,
        },
        "machine_ballots": {
            "total_votes": 78,
            "support_noone": 2,
            "total_valid_votes": 76,
            "votes": [
                {
                    "party_number": 1,
                    "votes": 6,
                    "preferences": [
                        {
                            "candidate_number": 101,
                            "count": 3,
                        }
                    ],
                    "no_preferences": 3,
                }
            ],
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


@pytest.fixture
def sample_paper_ballots():
    """Paper ballots fixture."""
    return PaperBallots(
        total=300,
        unused_ballots=217,
        registered_vote=82,
        invalid_out_of_the_box=1,
        invalid_in_the_box=1,
        support_noone=0,
        votes=[
            PartyVote(
                party_number=8,
                votes=6,
                preferences=[CandidatePreference(candidate_number=102, count=3)],
                no_preferences=1,
            )
        ],
        total_valid_votes=81,
    )


@pytest.fixture
def sample_machine_ballots():
    """Machine ballots fixture."""
    return MachineBallots(
        total_votes=78,
        support_noone=2,
        total_valid_votes=76,
        votes=[
            PartyVote(
                party_number=1,
                votes=6,
                preferences=[CandidatePreference(candidate_number=101, count=3)],
                no_preferences=3,
            )
        ],
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
