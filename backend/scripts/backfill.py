import argparse

from core.config_paths import FEATURES_DIR
from core.data.registry import DataRegistry
from core.logging import get_logger
from features.engine import FeatureEngine

logger = get_logger(__name__)

BACKFILL_START = "2010-01-01"
BACKFILL_END = "2024-12-31"


def run_backfill(force: bool = False) -> None:
    FEATURES_DIR.mkdir(parents=True, exist_ok=True)
    engine = FeatureEngine(registry=DataRegistry())
    features = engine.build(BACKFILL_START, BACKFILL_END)
    for year, group in features.groupby(features.index.year):
        path = FEATURES_DIR / f"features_{year}.parquet"
        if path.exists() and not force:
            logger.info("Feature file exists, skipping", extra={"year": int(year)})
            continue
        group.to_parquet(path)
        logger.info("Feature file written", extra={"year": int(year), "rows": len(group)})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    run_backfill(force=args.force)


if __name__ == "__main__":
    main()

