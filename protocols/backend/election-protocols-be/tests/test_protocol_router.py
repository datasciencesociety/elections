"""Integration tests for protocol router."""

import pytest
from election_protocols_be.routers.v1.protocol_router import protocol_check
from fastapi import HTTPException


@pytest.mark.integration
class TestProtocolRouter:
    """Tests for protocol_check endpoint."""

    @pytest.mark.asyncio
    async def test_check_valid_file_returns_protocol(self, mock_valid_upload_file):
        """Test POST with valid file returns Protocol."""
        result = await protocol_check(files=[mock_valid_upload_file])
        assert result.sik_no == "12020009"
        assert result.sik_type == "paper"

    @pytest.mark.asyncio
    async def test_check_invalid_content_type_raises_422(
        self, mock_invalid_upload_file
    ):
        """Test POST with invalid content type raises HTTPException 422."""
        with pytest.raises(HTTPException) as exc_info:
            await protocol_check(files=[mock_invalid_upload_file])
        assert exc_info.value.status_code == 422
        assert "Unsupported file type" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_check_multiple_valid_files(
        self, mock_valid_upload_file, mock_pdf_upload_file
    ):
        """Test POST with multiple valid files."""
        result = await protocol_check(
            files=[mock_valid_upload_file, mock_pdf_upload_file]
        )
        assert isinstance(result.sik_no, str)

    @pytest.mark.asyncio
    async def test_check_empty_files_list(self):
        """Test POST with empty files list."""
        result = await protocol_check(files=[])
        assert result.sik_no == "12020009"
