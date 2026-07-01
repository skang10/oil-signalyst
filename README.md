# oil-signalyst

Foundation scaffold for the oil-signalyst backend.

See [Architecture](docs/architecture.md) for the system design and data flow.

## Local development

```bash
cd backend
uv sync --extra dev
uv run alembic upgrade head
uv run uvicorn api.main:app --reload --port 8000
```

The integration tests require network access and valid `EIA_API_KEY` and
`FRED_API_KEY` values in `.env`.
