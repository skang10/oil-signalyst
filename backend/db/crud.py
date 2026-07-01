from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import FeatureSnapshot, User


async def get_feature_snapshot_by_date(
    db: AsyncSession,
    target_date: date,
) -> FeatureSnapshot | None:
    result = await db.execute(select(FeatureSnapshot).where(FeatureSnapshot.date == target_date))
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
