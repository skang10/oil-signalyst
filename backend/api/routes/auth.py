import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Cookie, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select

from api.dependencies import CurrentUser, DbSession
from auth.jwt import create_access_token
from auth.password import verify_password
from db.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(body: LoginRequest, response: Response, db: DbSession) -> dict:
    row = await db.execute(select(User).where(User.email == body.email))
    user = row.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = create_access_token(user.id, user.role)
    refresh_token = secrets.token_urlsafe(48)
    user.refresh_token = refresh_token
    user.last_login_at = datetime.now(UTC).replace(tzinfo=None)
    db.add(user)

    # Refresh token in an httpOnly cookie - not accessible to JS, unlike the
    # access token (which the frontend keeps in memory only, see D10).
    response.set_cookie(
        "refresh_token",
        refresh_token,
        httponly=True,
        samesite="lax",
        max_age=REFRESH_COOKIE_MAX_AGE,
    )
    return {"access_token": access_token, "role": user.role, "name": user.name}


@router.post("/refresh")
async def refresh(db: DbSession, refresh_token: str | None = Cookie(default=None)) -> dict:
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")
    row = await db.execute(select(User).where(User.refresh_token == refresh_token))
    user = row.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    new_access = create_access_token(user.id, user.role)
    return {"access_token": new_access, "role": user.role}


@router.post("/logout")
async def logout(response: Response, db: DbSession, user: CurrentUser) -> dict:
    user.refresh_token = None
    db.add(user)
    response.delete_cookie("refresh_token")
    return {"status": "logged out"}
