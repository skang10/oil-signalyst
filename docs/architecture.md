# Architecture

> This file is the system-level overview. For the full backend module
> breakdown, ML training pipeline, API surface, and persistence model, see
> [`docs/architecture-backend.md`](architecture-backend.md). For the React
> SPA's structure, routing, auth, and data-fetching conventions, see
> [`docs/architecture-frontend.md`](architecture-frontend.md).

## System Overview

```mermaid
flowchart LR
    Browser[Browser<br/>React SPA] --> API[FastAPI service :8000]
    Scheduler[APScheduler service] --> Pipeline[Daily pipeline job]
    Scheduler --> SignalScan[Weekly signal scan]

    API --> Auth[JWT auth: /api/auth/*]
    API --> Reports[Reports / Models / Training / Signals / Users / Market routes]
    API --> Agent[DS Agent: /api/agent/* -> OpenAI]
    API --> WS[WebSocket /ws/price ticker]
    API --> DB[(SQLite<br/>data/oilmarket.db)]

    Pipeline --> Registry[DataRegistry]
    Registry --> Yahoo[Yahoo Finance]
    Registry --> EIA[EIA API]
    Registry --> FRED[FRED API]
    Registry --> CFTC[CFTC ZIP files]

    Registry --> FeatureEngine[FeatureEngine]
    FeatureEngine --> Pool[pool_features table<br/>seeded from config/features.yaml]
    FeatureEngine --> FeatureSnapshot[feature_snapshots table]
    FeatureEngine --> Parquet[data/features/*.parquet]
    Pipeline --> ML[TabPFN-backed regime/eia/returns models]
    ML --> TabPFN[Hosted TabPFN API]
    ML --> Predictions[predictions table]
    Pipeline --> AutoRetrain[Optional auto-retrain<br/>psi / sunday mode]
    Pipeline --> SystemLog[system_logs table]

    Agent --> OpenAI[OpenAI Chat Completions]
    Agent --> AgentTurns[agent_turns table]
```

The system provides a scheduled daily ingestion + inference pipeline, a
three-model ML stack (regime classification, EIA forecasting, conditional
return distribution) trained via a hosted TabPFN API, drift/explainability
monitoring, a role-aware reporting + signal-research API surface secured
with JWT auth, a real-OpenAI DS Agent with multi-step tool use, and a React
SPA that consumes it all directly. See `docs/architecture-backend.md` and
`docs/architecture-frontend.md` for the full detail on each side.

## Runtime Containers

```mermaid
flowchart TB
    subgraph DockerCompose[docker-compose]
        Migrate[migrate<br/>alembic upgrade head]
        API[api<br/>uvicorn api.main:app]
        Scheduler[scheduler<br/>python scheduler/runner.py]
        Frontend[frontend<br/>nginx: static SPA + reverse proxy]
    end

    Migrate --> API
    Migrate --> Scheduler
    Frontend -->|proxy /api + /ws| API

    API --> DataVolume[(./data:/app/data)]
    Scheduler --> DataVolume
    API --> ConfigVolume[(./config:/app/config)]
    Scheduler --> ConfigVolume
    API --> LogsVolume[(./logs:/app/logs)]
    Scheduler --> LogsVolume
```

All four services run under Docker Compose. The `frontend` nginx container
serves the built SPA and reverse-proxies `/api` and `/ws` to the `api`
service, so in the container path the whole stack is **same-origin** (no
CORS needed). In local dev the frontend runs separately via `npm run dev`
(Vite, port 5173) against `http://localhost:8000`, and the backend's CORS
middleware allow-lists that dev origin.

## Backend Modules

Full module breakdown (API routes incl. auth/agent/market/ws,
`core/models/` training+inference, `core/postprocess/` decision/monitoring
layer, `core/agent/` OpenAI tool-use loop, `core/services/` feature-pool +
deploy, `features/`, `db/`, `scheduler/`) lives in
[`docs/architecture-backend.md`](architecture-backend.md#module-map).

## Frontend

React 18 + Vite SPA behind a JWT login: role-gated dashboard, history,
signal research, and a DS Workbench (data/model monitoring, training
control with run history) plus a real DS Agent chat panel. Consumes the
backend's API surface directly - no mock layer. Full module breakdown,
routing, auth, and data-fetching conventions live in
[`docs/architecture-frontend.md`](architecture-frontend.md#module-map).

## Daily Pipeline

High-level stages (see
[`docs/architecture-backend.md`](architecture-backend.md#data-flow-daily-pipeline)
for the full sequence including PSI, SHAP, and the decision engine):

```mermaid
flowchart LR
    Scheduler --> Snapshot[Build/upsert today's feature snapshot]
    Snapshot --> PSI[Compute PSI drift scores]
    Snapshot --> Predict[Score regime -> eia -> returns models]
    Predict --> Explain[SHAP explanation + decision engine]
    Explain --> Store[Insert predictions row]
    Store --> Backfill[Backfill actual_return on past predictions]
    Backfill --> AutoRetrain[Maybe auto-retrain per users.retrain_mode]
    AutoRetrain --> Prewarm[Rebuild Signal-Evaluate chart cache]
```

## Persistence Model

Entity relationships only - see
[`docs/architecture-backend.md`](architecture-backend.md#persistence-model)
for the full field-level ERD.

```mermaid
erDiagram
    users ||--o{ system_logs : triggers
    users ||--o{ train_jobs : triggers
    users ||--o{ pool_features : "last changed by"
    users ||--o{ agent_turns : owns
    model_versions ||--o{ predictions : serves
    feature_snapshots ||--o{ predictions : input

    users {
        int id PK
        string role
        string retrain_mode
    }
    feature_snapshots {
        int id PK
        date date UK
    }
    model_versions {
        int id PK
        string model_type
        bool is_active
    }
    predictions {
        int id PK
        date date
        int model_version_id FK
        int feature_snapshot_id FK
    }
    pool_features {
        int id PK
        string name UK
        string status
        int changed_by FK
    }
    train_jobs {
        string id PK
        string status
        string trigger_source
    }
    signal_evaluations {
        int id PK
        string signal_name
        datetime ignored_at
    }
    agent_turns {
        int id PK
        string session_id
        string role
    }
    system_logs {
        int id PK
        string event_type
    }
```
