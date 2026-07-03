from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from core.config import settings

ALGORITHM = "HS256"
ACCESS_TTL = timedelta(hours=1)


def create_access_token(user_id: int, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": datetime.now(UTC) + ACCESS_TTL,
        "iat": datetime.now(UTC),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raises jose.JWTError on invalid/expired token."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])


__all__ = ["JWTError", "create_access_token", "decode_access_token"]
