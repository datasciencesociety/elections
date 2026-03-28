"""Router for protocols."""

import logging

from fastapi import APIRouter, HTTPException, UploadFile

from election_protocols_be.models.protocol import (
    ALLOWED_CONTENT_TYPES,
    ProtocolCheckResponse,
)
from election_protocols_be.services import protocol_service

router = APIRouter(prefix="/protocol", tags=["protocol"])


@router.post(
    "/check",
    summary="Check election protocol images",
    description=(
        "Upload one or more election protocol images or PDFs for validation. "
        "Accepted formats: JPEG, PNG, TIFF, WebP, PDF."
    ),
    status_code=200,
    response_model=ProtocolCheckResponse,
    responses={
        200: {
            "description": "Protocol check completed successfully.",
            "content": {
                "application/json": {
                    "example": {"test": 1},
                }
            },
        },
        422: {
            "description": "Unsupported file type uploaded.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": (
                            "Unsupported file type: text/plain. "
                            "Allowed types: application/pdf, image/jpeg, "
                            "image/png, image/tiff, image/webp"
                        ),
                    }
                }
            },
        },
        500: {
            "description": "Internal error during protocol processing.",
            "content": {
                "application/json": {
                    "example": {"detail": "Protocol check failed"},
                }
            },
        },
    },
)
async def protocol_check(files: list[UploadFile]) -> ProtocolCheckResponse:
    for file in files:
        if file.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=422,
                detail=f"Unsupported file type: {file.content_type}. "
                f"Allowed types: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}",
            )

    try:
        return await protocol_service.check(files)
    except Exception as e:
        logging.exception("Protocol check failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Protocol check failed") from e
