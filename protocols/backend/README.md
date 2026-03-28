# Election Protocols Backend Packages

## Setup Locally

```sh

# (MacOS only) Install the UV package manager if you haven't already
brew install uv

# Navigate to the backend directory
cd protocols/backend

# Create a Python virtual environment and activate it
uv venv
source .venv/bin/activate

# Install dependencies
uv sync --all-packages

# Run the FastAPI server
uv run --package election-protocols-be uvicorn --app-dir election-protocols-be/src election_protocols_be.main:app --port 4000 --reload
```
