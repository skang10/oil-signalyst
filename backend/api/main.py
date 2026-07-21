import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import agent, auth, market, models, reports, signals, training, users, ws
from api.routes.health import router as health_router
from core.config_paths import CFTC_RAW_DIR, DATA_DIR, FEATURES_DIR, LOGS_DIR, MODELS_DIR, RAW_DIR, SERIES_CACHE_DIR
from core.logging import get_logger
from db.crud import get_or_create_default_user
from db.database import get_db, init_db

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    for path in (DATA_DIR, RAW_DIR, CFTC_RAW_DIR, SERIES_CACHE_DIR, FEATURES_DIR, MODELS_DIR, LOGS_DIR):
        path.mkdir(parents=True, exist_ok=True)

    await init_db()
    async with get_db() as db:
        await get_or_create_default_user(db)

    from api.routes.training import fail_orphaned_jobs

    orphaned = await fail_orphaned_jobs()
    if orphaned:
        logger.warning("Failed orphaned training jobs at startup", extra={"count": orphaned})

    logger.info("Starting oil-signalyst API")
    # Fire-and-forget: builds every candidate's Evaluate-page charts into the
    # in-memory cache (core/postprocess/signal_charts.py) so first page views
    # are served warm instead of taking ~4s. Startup itself is not delayed.
    from core.postprocess.signal_charts import refresh_signal_charts

    prewarm_task = asyncio.create_task(refresh_signal_charts())

    # Also fire-and-forget: warm the per-source freshness snapshot to disk so
    # the Data/Model Monitor pages read it in ms instead of paying a cold
    # ~20min serial fetch of every source on first view. In its own thread -
    # the fetch is blocking and slow (EIA), but off the request path.
    from core.postprocess.data_monitor import write_freshness_snapshot

    freshness_task = asyncio.create_task(asyncio.to_thread(write_freshness_snapshot))
    yield
    prewarm_task.cancel()
    freshness_task.cancel()
    logger.info("Shutting down oil-signalyst API")


def create_app() -> FastAPI:
    app = FastAPI(title="oil-signalyst", version="0.2.1", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        # Vite dev server only - this is a local single-user dev tool with no
        # deployed frontend origin yet. allow_credentials is required for the
        # httpOnly refresh_token cookie (api/routes/auth.py) to round-trip
        # cross-origin between :5173 and :8000.
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(auth.router)
    app.include_router(reports.router)
    app.include_router(models.router)
    app.include_router(training.router)
    app.include_router(signals.router)
    app.include_router(users.router)
    app.include_router(market.router)
    app.include_router(ws.router)
    app.include_router(agent.router)
    return app


app = create_app()
