"""Settings for the election-protocols-be package."""

from functools import lru_cache
from importlib.metadata import version

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()


def get_package_version() -> str:
    """Get the version of the election-protocols-be package."""
    return version("election-protocols-be")


class Settings(BaseSettings):
    """Settings for the election-protocols-be package."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Application settings
    SERVICE_NAME: str = "election-protocols-be"
    ENVIRONMENT: str = "local"  # local, development, staging, production
    LOGGING_LEVEL: str = "INFO"

    ELECTION_PROTOCOLS_BE_VERSION: str = Field(default_factory=get_package_version)


@lru_cache
def get_settings() -> Settings:
    """Get cached Settings instance."""
    return Settings()
