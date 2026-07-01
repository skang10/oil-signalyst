from contextlib import asynccontextmanager

from fastapi import FastAPI

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
    app = FastAPI(title="oil-signalyst", version="0.1.0", lifespan=lifespan)
    app.include_router(health_router)
    return app


app = create_app()
