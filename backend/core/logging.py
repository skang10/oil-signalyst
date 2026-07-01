import json
import logging
from datetime import datetime

from core.config import settings


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        reserved = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__)
        extra = {
            key: value
            for key, value in record.__dict__.items()
            if key not in reserved and not key.startswith("_")
        }
        return json.dumps(
            {
                "timestamp": datetime.utcnow().isoformat(),
                "level": record.levelname,
                "module": record.module,
                "message": record.getMessage(),
                "extra": extra,
            },
            default=str,
        )


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)
    logger.setLevel(settings.log_level.upper())
    logger.propagate = False
    return logger
