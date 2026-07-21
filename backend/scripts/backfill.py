import argparse
from datetime import UTC, datetime

from core.config_paths import FEATURES_DIR
from core.data.registry import DataRegistry
from core.logging import get_logger
from features.engine import FeatureEngine

logger = get_logger(__name__)

BACKFILL_START = "2010-01-01"


def _default_end() -> str:
    """Today, not a hardcoded date.

    This was pinned at 2024-12-31, which is why the feature matrix had a
    540-day hole: the backfill stopped at the end of 2024 and the only other
    writer is the daily pipeline, which has to be running to fill anything.
    A cutoff_date inside that hole silently produced an empty validation
    window.
    """
    return str(datetime.now(UTC).date())


def run_backfill(force: bool = False, end: str | None = None) -> None:
    FEATURES_DIR.mkdir(parents=True, exist_ok=True)
    engine = FeatureEngine(registry=DataRegistry())
    features = engine.build(BACKFILL_START, end or _default_end())
    for year, group in features.groupby(features.index.year):
        path = FEATURES_DIR / f"features_{year}.parquet"
        if path.exists() and not force:
            logger.info("Feature file exists, skipping", extra={"year": int(year)})
            continue
        group.to_parquet(path)
        logger.info("Feature file written", extra={"year": int(year), "rows": len(group)})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="overwrite existing year files")
    parser.add_argument("--end", default=None, help="last date to build (default: today)")
    args = parser.parse_args()
    run_backfill(force=args.force, end=args.end)


if __name__ == "__main__":
    main()

