# Architecture

> This file is the system-level overview. For the full backend module
> breakdown, ML training pipeline, API surface, and persistence model, see
> [`docs/architecture-backend.md`](architecture-backend.md). There is no
> frontend yet (`frontend/` is a placeholder) - once one exists it should get
> its own `docs/architecture-frontend.md` rather than growing this file.

## System Overview

```mermaid
flowchart LR
    User[Local user / API client] --> API[FastAPI service]
    Scheduler[APScheduler service] --> Pipeline[Daily pipeline job]
    Scheduler --> SignalScan[Weekly signal scan]

    API --> Health[GET /health]
    API --> Reports[Reports / Models / Training / Signals / Users routes]
    API --> DB[(SQLite<br/>data/oilmarket.db)]

    Pipeline --> Registry[DataRegistry]
    Registry --> Yahoo[Yahoo Finance]
    Registry --> EIA[EIA API]
    Registry --> FRED[FRED API]
    Registry --> CFTC[CFTC ZIP files]

    Registry --> FeatureEngine[FeatureEngine]
    FeatureEngine --> FeatureSnapshot[feature_snapshots table]
    FeatureEngine --> Parquet[data/features/*.parquet]
    Pipeline --> ML[TabPFN-backed regime/eia/returns models]
    ML --> TabPFN[Hosted TabPFN API]
    ML --> Predictions[predictions table]
    Pipeline --> SystemLog[system_logs table]

    Reports --> DB
    Predictions --> DB
    FeatureSnapshot --> DB
    SystemLog --> DB
    Parquet --> DataDir[data/ volume]
    CFTC --> RawCache[data/raw/cftc/]
```

The system provides a scheduled daily ingestion + inference pipeline, a
three-model ML stack (regime classification, EIA forecasting, conditional
return distribution) trained via a hosted TabPFN API, drift/explainability
monitoring, and a role-aware reporting + signal-research API surface. See
`docs/architecture-backend.md` for the full detail.

## Runtime Containers

```mermaid
flowchart TB
    subgraph DockerCompose[docker-compose]
        Migrate[migrate<br/>alembic upgrade head]
        API[api<br/>uvicorn api.main:app]
        Scheduler[scheduler<br/>python scheduler/runner.py]
    end

    Migrate --> API
    Migrate --> Scheduler

    API --> DataVolume[(./data:/app/data)]
    Scheduler --> DataVolume
    API --> ConfigVolume[(./config:/app/config)]
    Scheduler --> ConfigVolume
    API --> LogsVolume[(./logs:/app/logs)]
    Scheduler --> LogsVolume
```

## Backend Modules

Full module breakdown (API routes, `core/models/` training+inference,
`core/postprocess/` decision/monitoring layer, `features/`, `db/`,
`scheduler/`) lives in
[`docs/architecture-backend.md`](architecture-backend.md#module-map).

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
```

## Persistence Model

Entity relationships only - see
[`docs/architecture-backend.md`](architecture-backend.md#persistence-model)
for the full field-level ERD, including `train_jobs` and the
MLflow/PSI/calibration-related columns.

```mermaid
erDiagram
    users ||--o{ system_logs : triggers
    users ||--o{ train_jobs : triggers
    model_versions ||--o{ predictions : serves
    feature_snapshots ||--o{ predictions : input

    users {
        int id PK
        string role
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
    train_jobs {
        string id PK
        string status
    }
    signal_evaluations {
        int id PK
        string signal_name
        string status
    }
    system_logs {
        int id PK
        string event_type
    }
```
