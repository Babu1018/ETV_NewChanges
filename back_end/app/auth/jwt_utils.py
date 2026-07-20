import os
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import jwt
from dotenv import load_dotenv

from app.config import BACKEND_ROOT

load_dotenv(BACKEND_ROOT / ".env")

JWT_SECRET = os.getenv("AUTH_JWT_SECRET", "dev-change-me-asr-auth-secret")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_HOURS = int(os.getenv("AUTH_TOKEN_HOURS", "24"))


def create_access_token(user_id: UUID, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_HOURS)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
