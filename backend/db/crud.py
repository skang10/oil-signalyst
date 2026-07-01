from datetime import date

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import FeatureSnapshot, ModelVersion, Prediction, User


async def get_feature_snapshot_by_date(
    db: AsyncSession,
    target_date: date,
) -> FeatureSnapshot | None:
    result = await db.execute(select(FeatureSnapshot).where(FeatureSnapshot.date == target_date))
    return result.scalar_one_or_none()


async def get_prediction_by_date(
    db: AsyncSession,
    target_date: date,
) -> Prediction | None:
    result = await db.execute(
        select(Prediction)
        .where(Prediction.date == target_date)
        .order_by(desc(Prediction.created_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_recent_predictions(
    db: AsyncSession,
    limit: int = 30,
) -> list[Prediction]:
    result = await db.execute(select(Prediction).order_by(desc(Prediction.date)).limit(limit))
    return list(result.scalars().all())


async def get_active_model_version(
    db: AsyncSession,
    model_type: str,
) -> ModelVersion | None:
    result = await db.execute(
        select(ModelVersion)
        .where(ModelVersion.model_type == model_type, ModelVersion.is_active.is_(True))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_user(db: AsyncSession, user_id: int) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_or_create_default_user(db: AsyncSession) -> User:
    user = await get_user(db, 1)
    if user is None:
        user = User(id=1, name="Default User", role="researcher")
        db.add(user)
        await db.flush()
    return user
