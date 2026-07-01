from pathlib import Path

import joblib

from core.exceptions import ModelNotFoundError
from db.crud import get_active_model_version
from db.database import get_db
from db.models import ModelVersion

_cache: dict[str, dict] = {}


class ModelRegistry:
    @staticmethod
    async def get_active(model_type: str) -> dict:
        if model_type in _cache:
            return _cache[model_type]

        async with get_db() as db:
            model_version = await get_active_model_version(db, model_type)

        if model_version is None or not model_version.file_path:
            raise ModelNotFoundError(f"No active model for type '{model_type}'")

        artifact = joblib.load(Path(model_version.file_path))
        artifact["model_version_id"] = model_version.id
        artifact["model_version"] = model_version.version
        artifact["feature_list"] = model_version.feature_list or artifact.get("feature_list", [])
        _cache[model_type] = artifact
        return artifact

    @staticmethod
    def invalidate(model_type: str) -> None:
        _cache.pop(model_type, None)

    @staticmethod
    async def get_active_version_id(model_type: str) -> int | None:
        async with get_db() as db:
            model_version = await get_active_model_version(db, model_type)
        return model_version.id if model_version else None

    @staticmethod
    async def get_active_version(model_type: str) -> ModelVersion | None:
        async with get_db() as db:
            return await get_active_model_version(db, model_type)

