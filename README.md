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

Daily pipeline scheduler (separate terminal). The API process does **not**
run the pipeline; the scheduler is its own process. Without it the feature
matrix and predictions never advance (the Data Monitor will show stale data).
Under Docker Compose this runs automatically as the `scheduler` service.

```bash
cd backend
uv run python -m scheduler.runner
```

It runs `run_daily_pipeline` on a cron (`PIPELINE_CRON_HOUR`/`_MINUTE`,
default 22:00 UTC) plus a weekly signal scan. To run one pass immediately
instead of waiting for the cron: `uv run python -c "import asyncio; from
scheduler.jobs import run_daily_pipeline; asyncio.run(run_daily_pipeline())"`.

Frontend (in a separate terminal, backend must be running on `:8000`):

```bash
cd frontend
npm install
npm run dev
```

## Docker Compose

```bash
docker compose up -d --build
```

Starts `frontend` (nginx, reverse-proxying `/api` and `/ws` to `api` so the
whole stack is same-origin - no CORS config needed), `api`, `scheduler`,
and a one-shot `migrate` job. Reachable at `http://localhost:5173`. Requires
a populated `.env` at the repo root (see `.env.example`).
