from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from db.crud import get_user
from db.database import AsyncSessionLocal
from db.models import User


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


DbSession = Annotated[AsyncSession, Depends(get_db_session)]


async def get_current_user(
    db: DbSession,
    x_user_id: Annotated[int, Header(alias="X-User-Id")] = 1,
) -> User:
    user = await get_user(db, x_user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"User {x_user_id} not found")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
