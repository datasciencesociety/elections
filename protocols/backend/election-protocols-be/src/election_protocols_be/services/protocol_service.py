"""Business logic for protocol operations."""

from fastapi import UploadFile

from election_protocols_be.models.protocol import ProtocolCheckResponse


async def check(files: list[UploadFile]) -> ProtocolCheckResponse:
    return ProtocolCheckResponse(test=1)
