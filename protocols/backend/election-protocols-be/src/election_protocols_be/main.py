"""Main module for the Election Protocols Backend API."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from election_protocols_be.routers.v1 import protocol_router
from election_protocols_be.utils.settings import get_settings

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.LOGGING_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(filename)s:%(lineno)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S (%Z)",
    force=True,  # Force override of existing handlers
)

app = FastAPI(
    title="Election Protocols Backend API",
    description="API for the Election Protocols Backend.",
    version=settings.ELECTION_PROTOCOLS_BE_VERSION,
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
)

# Configure CORS with security in mind
if settings.ENVIRONMENT == "local":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        max_age=3600,
    )
else:
    app.add_middleware(
        CORSMiddleware,
        # TODO: Update the domain when we know the actual
        allow_origin_regex=r"https://[\w-]+\.bg-election-protocols\.com",
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        max_age=3600,
    )


app.include_router(protocol_router.router, prefix="/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "OK", "version": settings.ELECTION_PROTOCOLS_BE_VERSION}


@app.get("/")
async def root() -> dict[str, str]:
    """Dummy root endpoint."""
    return {"message": "Election Protocols Backend is running!"}
