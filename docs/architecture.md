# Architecture

## System Overview

```mermaid
flowchart LR
    User[Local user / API client] --> API[FastAPI service]
    Scheduler[APScheduler service] --> Pipeline[Daily pipeline job]

    API --> Health[GET /health]
    API --> DB[(SQLite<br/>data/oilmarket.db)]

    Pipeline --> Registry[DataRegistry]
    Registry --> Yahoo[Yahoo Finance]
    Registry --> EIA[EIA API]
    Registry --> FRED[FRED API]
    Registry --> CFTC[CFTC ZIP files]

    Registry --> FeatureEngine[FeatureEngine]
    FeatureEngine --> FeatureSnapshot[feature_snapshots table]
    FeatureEngine --> Parquet[data/features/*.parquet]
    Pipeline --> SystemLog[system_logs table]

    FeatureSnapshot --> DB
    SystemLog --> DB
    Parquet --> DataDir[data/ volume]
    CFTC --> RawCache[data/raw/cftc/]
```

The current system provides API health checks, database schema, real data-source adapters, feature construction, scheduled daily pipeline, and local persistence.

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

```mermaid
flowchart LR
    subgraph API[api/]
        Main[main.py]
        Deps[dependencies.py]
        Health[health.py]
    end

    subgraph Core[core/]
        Settings[config.py]
        Paths[config_paths.py]
        Cache[cache.py]
        Registry[DataRegistry]
        Sources[Yahoo / EIA / FRED / CFTC]
    end

    subgraph Features[features/]
        Engine[FeatureEngine]
    end

    subgraph DB[db/]
        Models[models.py]
        Crud[crud.py]
        Database[database.py]
    end

    subgraph Scheduler[scheduler/]
        Runner[runner.py]
        Jobs[jobs.py]
    end

    Main --> Deps
    Main --> Health
    Health --> Database
    Jobs --> Registry
    Jobs --> Engine
    Jobs --> Crud
    Registry --> Sources
    Registry --> Cache
    Engine --> Registry
    Database --> Models
    Crud --> Models
```

## Daily Pipeline

```mermaid
sequenceDiagram
    participant S as APScheduler
    participant J as run_daily_pipeline
    participant R as DataRegistry
    participant F as FeatureEngine
    participant D as SQLite
    participant P as Parquet files

    S->>J: Trigger daily job
    J->>D: Check existing feature_snapshot(date)
    J->>D: Insert system_logs running
    J->>R: Fetch required sources
    R->>R: Align dates and publication lags
    J->>F: Build feature matrix
    F->>R: fetch_all(required sources)
    J->>P: Upsert data/features/features_YEAR.parquet
    J->>D: Insert feature_snapshots row
    J->>D: Mark system_logs success
```

## Persistence Model

```mermaid
erDiagram
    users ||--o{ system_logs : triggers
    model_versions ||--o{ predictions : serves
    feature_snapshots ||--o{ predictions : input

    users {
        int id PK
        string name
        string role
        json instruments
    }

    feature_snapshots {
        int id PK
        date date UK
        json features
        string feature_version
    }

    model_versions {
        int id PK
        string model_type
        string version
        bool is_active
    }

    predictions {
        int id PK
        date date
        json regime_probs
        json return_dist
        int model_version_id FK
        int feature_snapshot_id FK
    }

    system_logs {
        int id PK
        string event_type
        string status
        int user_id FK
    }

    signal_evaluations {
        int id PK
        string signal_name
        json source_config
        string status
    }
```
