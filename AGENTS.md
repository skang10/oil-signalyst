# Agent Guidelines

- Use git checkpoints for coherent units of work; run relevant checks first when practical.
- Use short conventional commits: `feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`, `test(scope): ...`, `chore(scope): ...`.
- If git checkpoints or remote sync are requested, proceed with `git add`, `git commit`, and `git push` without asking again.
- Before staging, inspect unexpected changes and exclude unrelated work.
- Never commit secrets. Real keys stay in `.env`; `.env.example` must contain placeholders only.
- Push to `origin/main` when the user asks for remote sync.

## Project Context

Oil Signalyst is a FastAPI backend for oil-market data ingestion, feature snapshots, and scheduled daily pipeline runs. Start with `README.md` for local setup and `docs/architecture.md` for module and data-flow context.

## Where To Start

- Backend app entrypoint: `backend/api/main.py`
- Health route: `backend/api/routes/health.py`
- Settings and paths: `backend/core/config.py`, `backend/core/config_paths.py`
- Data adapters and registry: `backend/core/data/`
- Feature construction: `backend/features/engine.py`
- Database models/session/CRUD: `backend/db/`
- Scheduler job runner: `backend/scheduler/`
- Tests: `backend/tests/`

## Common Commands

Run from `backend/` unless noted:

- Install dev dependencies: `uv sync --extra dev`
- Apply migrations: `uv run alembic upgrade head`
- Run API: `uv run uvicorn api.main:app --reload --port 8000`
- Run scheduler: `uv run python scheduler/runner.py`
- Lint: `uv run ruff check .`
- Test: `uv run pytest`
- Full compose stack from repo root: `docker compose up --build`

Integration tests and live data runs need valid `EIA_API_KEY` and `FRED_API_KEY` in `.env`; keep `.env.example` placeholder-only.
