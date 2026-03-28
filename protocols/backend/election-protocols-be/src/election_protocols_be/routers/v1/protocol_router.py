"""Router for protocols."""

import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import ValidationError

from election_protocols_be.models.protocol import ALLOWED_CONTENT_TYPES
from election_protocols_be.models.response import ProcessResult
from election_protocols_be.services import protocol_service

router = APIRouter(prefix="/protocol", tags=["protocol"])


@router.post(
    "/check",
    summary="OCR, validate and compare an election protocol PDF",
    description=(
        "Upload an election protocol PDF. "
        "Optionally upload a ground-truth JSON for comparison. "
        "Returns the extracted data, validation result, and comparison score."
    ),
    status_code=200,
    response_model=ProcessResult,
)
async def protocol_check(
    file: UploadFile = File(..., description="Election protocol PDF"),
    sik_type: str = Form("paper_machine", description="SIK type: 'paper' or 'paper_machine'"),
    ground_truth: UploadFile = File(None, description="Optional ground-truth JSON for comparison"),
) -> ProcessResult:
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Unsupported file type: {file.content_type}. "
                f"Allowed types: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}"
            ),
        )

    if sik_type not in ("paper", "paper_machine"):
        raise HTTPException(
            status_code=422,
            detail="sik_type must be 'paper' or 'paper_machine'",
        )

    try:
        return await protocol_service.process(
            pdf_file=file,
            sik_type=sik_type,
            ground_truth_file=ground_truth if (ground_truth and ground_truth.filename) else None,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logging.exception("Protocol processing failed: %s", str(exc))
        raise HTTPException(status_code=500, detail="Protocol processing failed") from exc
