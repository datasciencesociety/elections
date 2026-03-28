"""Response models for the protocol processing pipeline."""

from typing import Any, Optional

from pydantic import BaseModel

from election_protocols_be.models.protocol import Protocol


class CompareResult(BaseModel):
    """Comparison between OCR output and ground-truth JSON."""

    score: dict[str, Any]  # {total, correct, wrong, missing, accuracy}
    errors: list[str]  # wrong values
    nulls: list[str]   # fields missing in prediction


class ProcessResult(BaseModel):
    """Full result of processing a protocol PDF."""

    raw_ocr: dict[str, Any]                  # raw JSON from Gemini
    protocol: Optional[Protocol] = None       # parsed & validated; None if validation fails
    validation_errors: list[str] = []         # Pydantic validation error messages
    comparison: Optional[CompareResult] = None  # populated when ground-truth is provided
