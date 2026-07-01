import asyncio

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from core.config import settings
from core.logging import get_logger
from scheduler.jobs import run_daily_pipeline

logger = get_logger(__name__)


async def _run() -> None:
    scheduler = AsyncIOScheduler(timezone="UTC")
    if settings.scheduler_enabled:
        scheduler.add_job(
            run_daily_pipeline,
            "cron",
            hour=settings.pipeline_cron_hour,
            minute=settings.pipeline_cron_minute,
            id="daily_pipeline",
            replace_existing=True,
        )
        logger.info(
            "Daily pipeline scheduled",
            extra={
                "hour": settings.pipeline_cron_hour,
                "minute": settings.pipeline_cron_minute,
                "timezone": "UTC",
            },
        )

    scheduler.start()
    logger.info("Scheduler running")
    stop_event = asyncio.Event()
    try:
        await stop_event.wait()
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        scheduler.shutdown()
        logger.info("Scheduler shut down")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
