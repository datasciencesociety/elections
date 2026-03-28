"""Router for protocols."""

import logging

from fastapi import APIRouter

router = APIRouter(prefix="/protocol", tags=["protocol"])


@router.post(
    "/check",
    status_code=200,
)
async def protocol_check() -> dict[str, str]:
    try:
        return {"status": "OK"}
    except Exception as e:
        # Invalid preset name or sensor configuration
        logging.warning(
            "Invalid sensor config: %s",
            str(e),
        )
