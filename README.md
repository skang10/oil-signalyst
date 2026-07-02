# oil-signalyst

Oil-market signal research: a FastAPI backend (ML pipeline, daily
inference, signal scanning) and a React frontend (role-gated dashboard,
signal research, DS Workbench).

See [Architecture](docs/architecture.md) for the system design and data
flow ([backend](docs/architecture-backend.md),
[frontend](docs/architecture-frontend.md) deep-dives).

## Local development

Backend:

```bash
cd backend
uv sync --extra dev
uv run alembic upgrade head
uv run uvicorn api.main:app --reload --port 8000
```

The integration tests require network access and valid `EIA_API_KEY` and
`FRED_API_KEY` values in `.env`.

Frontend (in a separate terminal, backend must be running on `:8000`):

```bash
cd frontend
npm install
npm run dev
```
