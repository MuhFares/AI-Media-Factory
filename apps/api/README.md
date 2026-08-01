# AI Media Factory - API

Python backend service built with FastAPI.

## Setup

```bash
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# macOS / Linux:       source .venv/bin/activate
pip install -e ".[dev]"
```

## Run

```bash
uvicorn ai_media_factory.main:app --reload
```

The service listens on `http://localhost:8000` by default. Interactive API
docs are available at `http://localhost:8000/docs`.

## Test

```bash
pytest
```
