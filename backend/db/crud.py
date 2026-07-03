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
    from auth.password import hash_password
    from core.config import settings

    user = await get_user(db, 1)
    if user is None:
        user = User(
            id=1,
            name="Xuemei",
            # ds, not researcher: this is the one local account for the
            # whole tool, and Phase 4's role pill (D17) only previews other
            # roles for an authenticated ds user - anything else would
            # permanently lock the sole account out of DS Workbench
            # (Data/Model Monitor, Training Control) and the pill itself.
            role="ds",
            email="xuemei@local",
            hashed_password=hash_password(settings.default_user_password),
        )
        db.add(user)
        await db.flush()
    elif not user.hashed_password:
        # One-time migration for a pre-Phase-4 row (no registration flow
        # exists - this is the one local account) so login works without a
        # manual migration step. Gated on hashed_password being unset so
        # this never re-fires once done - in particular, role must not be
        # reset on every startup, since a user changing their own role to
        # "researcher" later via Settings (PUT /api/users/me/config) is a
        # legitimate action this must not silently override.
        if user.name == "Default User":
            user.name = "Xuemei"
        if user.role == "researcher":
            user.role = "ds"
        user.email = user.email or "xuemei@local"
        user.hashed_password = hash_password(settings.default_user_password)
        db.add(user)
        if dirty:
            db.add(user)
        await db.flush()
    return user
