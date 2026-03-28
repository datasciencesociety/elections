"""Unit tests for protocol service."""

import pytest
from election_protocols_be.models.protocol import Protocol
from election_protocols_be.services import protocol_service


@pytest.mark.unit
class TestProtocolService:
    """Tests for protocol_service module."""

    @pytest.mark.asyncio
    async def test_check_returns_protocol_instance(self, mock_upload_file):
        """Test that check() returns a Protocol instance."""
        result = await protocol_service.check(files=[mock_upload_file])
        assert isinstance(result, Protocol)

    @pytest.mark.asyncio
    async def test_check_protocol_has_required_fields(self, mock_upload_file):
        """Test that returned Protocol has all required fields."""
        result = await protocol_service.check(files=[mock_upload_file])
        assert hasattr(result, "sik_no")
        assert hasattr(result, "sik_type")
        assert hasattr(result, "voter_count")
        assert hasattr(result, "additional_voter_count")
        assert hasattr(result, "registered_votes")
        assert hasattr(result, "paper_ballots")
        assert hasattr(result, "machine_ballots")

    @pytest.mark.asyncio
    async def test_check_with_multiple_files(
        self, mock_upload_file, mock_pdf_upload_file
    ):
        """Test check() with multiple files."""
        result = await protocol_service.check(
            files=[mock_upload_file, mock_pdf_upload_file]
        )
        assert isinstance(result, Protocol)
