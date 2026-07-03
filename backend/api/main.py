from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import market, models, reports, signals, training, users, ws
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
    yield
    logger.info("Shutting down oil-signalyst API")


def create_app() -> FastAPI:
    app = FastAPI(title="oil-signalyst", version="0.2.1", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        # Vite dev server only - this is a local single-user dev tool with no
        # deployed frontend origin yet.
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(reports.router)
    app.include_router(models.router)
    app.include_router(training.router)
    app.include_router(signals.router)
    app.include_router(users.router)
    app.include_router(market.router)
    app.include_router(ws.router)
    return app


app = create_app()
