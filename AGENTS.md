# Agent Guidelines for Election Protocols

This document provides guidelines for agents working on this codebase.

## Project Overview

This is a Python monorepo using `uv` for package management. The main backend service is a FastAPI application for processing election protocol images.

- **Python Version**: 3.14+
- **Package Manager**: `uv`
- **Root**: `protocols/backend/`

## Build/Lint/Test Commands

### Install Dependencies
```bash
cd protocols/backend
uv sync --all-packages
```

### Linting
```bash
cd protocols/backend
ruff check .
```

### Formatting
```bash
cd protocols/backend
ruff format .
```

### Running Tests
```bash
cd protocols/backend
pytest
```

### Run a Single Test
```bash
cd protocols/backend
pytest path/to/test_file.py::test_function_name
```

### Run Tests Matching a Pattern
```bash
cd protocols/backend
pytest -k "test_name_pattern"
```

### Run Tests by Marker
```bash
cd protocols/backend
pytest -m unit        # Run only unit tests
pytest -m integration # Run only integration tests
pytest -m "not slow"  # Skip slow tests
```

### Watch Mode (auto-rerun on changes)
```bash
cd protocols/backend
pytest-watch
```

### Coverage Report
```bash
cd protocols/backend
pytest --cov --cov-report=html  # HTML report in htmlcov/
pytest --cov --cov-report=term-missing  # Terminal report with missing lines
```

## Code Style Guidelines

### General
- **Line Length**: 88 characters (enforced by ruff)
- **Python**: 3.14+ with type annotations
- **Quote Style**: Double quotes (`"..."`) for strings
- **Indentation**: 4 spaces

### Imports
- Use absolute imports from package root
- Example: `from election_protocols_be.models.protocol import ProtocolCheckResponse`
- Group order: stdlib → third-party → local (enforced by ruff isort)

### Naming Conventions
- **Variables/Functions**: `snake_case`
- **Classes**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Type Variables**: `PascalCase`
- **Private members**: `_leading_underscore`

### Type Annotations
- Always use type hints for function parameters and return types
- Use `dict[str, str]` not `Dict[str, str]` (Python 3.9+)
- Use `list[str]` not `List[str]`

### Docstrings
- Use triple double quotes `"""..."""`
- Use Google-style docstrings for modules and public APIs
- Example:
```python
async def protocol_check(files: list[UploadFile]) -> ProtocolCheckResponse:
    """Check election protocol images.
    
    Args:
        files: List of uploaded files to check.
        
    Returns:
        ProtocolCheckResponse with validation results.
    """
```

### Error Handling
- Use `logging.exception()` for caught exceptions (includes traceback)
- Raise `HTTPException` from FastAPI for API errors
- Always chain exceptions with `from e`
```python
try:
    result = await service.method()
except Exception as e:
    logging.exception("Operation failed: %s", str(e))
    raise HTTPException(status_code=500, detail="Operation failed") from e
```

### Pydantic Models
- Use `model_config` dict for configuration (not `class Config`)
- Use `Field()` for field customization
```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    
    SERVICE_NAME: str = "default"
    VERSION: str = Field(default_factory=get_version)
```

### Logging
- Use module-level logger: `logger = logging.getLogger(__name__)`
- Use `%s` formatting for log messages (lazy evaluation)
```python
logging.info("User %s logged in", username)
logging.exception("Error occurred: %s", str(e))
```

### Testing
- Test files: `test_*.py` in `*/tests/` directories
- Test classes: `Test*`
- Test functions: `test_*`
- Use pytest-asyncio for async tests (auto mode enabled)
- Use markers: `@pytest.mark.unit`, `@pytest.mark.integration`, `@pytest.mark.slow`

### API Routes (FastAPI)
- Use `APIRouter` with prefix and tags
- Document endpoints with OpenAPI metadata
- Return appropriate HTTP status codes
- Validate input with Pydantic models

### Project Structure
```
protocols/backend/
├── election-protocols-be/          # Main API service
│   ├── src/election_protocols_be/
│   │   ├── main.py                 # FastAPI app entry point
│   │   ├── routers/v1/             # API route handlers
│   │   ├── services/               # Business logic
│   │   ├── models/                 # Pydantic models
│   │   └── utils/                  # Utilities (settings, etc.)
│   └── tests/                      # Service tests
└── election-protocols-experiments/ # Experimental code
    └── src/election_protocols_experiments/
```

### Lint Rules (ruff)
- E/W: pycodestyle errors/warnings
- F: pyflakes
- I: isort (import sorting)
- B: flake8-bugbear
- UP: pyupgrade

## Git Workflow
- Branch from `main`
- Use conventional commit messages
- Run lint and tests before committing
- No force-push to main

## Environment Variables
- Load from `.env` files (handled by `python-dotenv`)
- Settings managed via `pydantic-settings`
- Environment types: `local`, `development`, `staging`, `production`
