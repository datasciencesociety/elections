"""Models for the protocol endpoints."""

from pydantic import BaseModel

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/webp",
    "application/pdf",
}


class ProtocolCheckResponse(BaseModel):
    """Response from a protocol check operation."""

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"test": 1},
            ]
        }
    }

    test: int
