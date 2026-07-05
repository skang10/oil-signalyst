import asyncio
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import agent, auth, market, models, reports, signals, training, users, ws
from api.routes.health import router as health_router
from core.config_paths import CFTC_RAW_DIR, DATA_DIR, FEATURES_DIR, LOGS_DIR, MODELS_DIR, RAW_DIR
from core.logging import get_logger
from db.crud import get_or_create_default_user
from db.database import get_db, init_db

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    for path in (DATA_DIR, RAW_DIR, CFTC_RAW_DIR, FEATURES_DIR, MODELS_DIR, LOGS_DIR):
        path.mkdir(parents=True, exist_ok=True)

    await init_db()
    async with get_db() as db:
        await get_or_create_default_user(db)

    logger.info("Starting oil-signalyst API")
    # Fire-and-forget: builds every candidate's Evaluate-page charts into the
    # in-memory cache (core/postprocess/signal_charts.py) so first page views
    # are served warm instead of taking ~4s. Startup itself is not delayed.
    from core.postprocess.signal_charts import refresh_signal_charts
    from scripts.daily_update import run_daily_update

    prewarm_task = asyncio.create_task(refresh_signal_charts())

    # Nothing else refreshes the persisted feature Parquet matrix, so without
    # a daily job it drifts stale. Run once a day after the US close and the
    # EIA/COT releases (server-local time) to append the latest rows and warm
    # the caches. In-process is enough for this single-node local tool.
    scheduler = AsyncIOScheduler()
    scheduler.add_job(run_daily_update, "cron", hour=22, minute=30, id="daily_update")
    scheduler.start()

    yield

    prewarm_task.cancel()
    scheduler.shutdown(wait=False)
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
