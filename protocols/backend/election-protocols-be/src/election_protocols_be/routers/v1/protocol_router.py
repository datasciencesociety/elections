"""Router for protocols."""

import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from election_protocols_be.models.protocol import ALLOWED_CONTENT_TYPES
from election_protocols_be.services import protocol_service

router = APIRouter(prefix="/protocol", tags=["protocol"])


@router.post(
    "/check/stream",
    summary="OCR, validate and compare an election protocol PDF (Stream)",
    description=(
        "Upload an election protocol PDF and optionally a ground-truth JSON for comparison. "
        "Returns a Server-Sent Events (SSE) stream with progress updates and the final JSON result."
    ),
    status_code=200,
)
async def protocol_check_stream(
    files: list[UploadFile] = File(..., description="Election protocol PDF or HTML pages"),
    sik_type: str = Form("paper_machine", description="SIK type: 'paper' or 'paper_machine'"),
    ocr_mode: str = Form("gemini", description="OCR mode: 'gemini' or 'chandra'"),
    ground_truth: UploadFile = File(None, description="Optional ground-truth JSON for comparison"),
) -> StreamingResponse:
    if not files:
        raise HTTPException(status_code=422, detail="No files provided.")

    if sik_type not in ("paper", "paper_machine"):
        raise HTTPException(
            status_code=422,
            detail="sik_type must be 'paper' or 'paper_machine'",
        )
        
    if ocr_mode not in ("gemini", "chandra"):
        raise HTTPException(
            status_code=422,
            detail="ocr_mode must be 'gemini' or 'chandra'",
        )

    async def stream_wrapper():
        try:
            async for event in protocol_service.stream_process(
                uploaded_files=files,
                sik_type=sik_type,
                ocr_mode=ocr_mode,
                ground_truth_file=ground_truth if (ground_truth and ground_truth.filename) else None,
            ):
                yield event
        except Exception as exc:
            logging.exception("Stream wrapper failed")
            yield f'data: {{"status":"error","msg":"Internal Error: {str(exc)}"}}\n\n'

    return StreamingResponse(stream_wrapper(), media_type="text/event-stream")
