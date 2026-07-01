from datetime import datetime, timedelta
from typing import Any


class DataFetchCache:
    def __init__(self, ttl_seconds: int = 14_400):
        self._store: dict[str, dict[str, Any]] = {}
        self._ttl = timedelta(seconds=ttl_seconds)

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        if datetime.utcnow() > entry["expires"]:
            del self._store[key]
            return None
        return entry["value"]

    def set(self, key: str, value: Any) -> None:
        self._store[key] = {
            "value": value,
            "expires": datetime.utcnow() + self._ttl,
        }

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)
