from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from auth.jwt import JWTError, decode_access_token
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
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ")
    try:
        payload = decode_access_token(token)
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
    user = await db.get(User, int(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
