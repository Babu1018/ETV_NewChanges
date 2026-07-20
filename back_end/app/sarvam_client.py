"""Shared Sarvam AI client helpers — per-request user keys with server .env fallback."""
import os

from fastapi import HTTPException, Request

from app.config import BACKEND_ROOT
from dotenv import load_dotenv

load_dotenv(BACKEND_ROOT / ".env")

SARVAM_API_KEY_ENV = (os.getenv("SARVAM_API_KEY") or "").strip()


def resolve_sarvam_api_key(
    request: Request | None = None,
    *,
    header_key: str | None = None,
    form_key: str | None = None,
) -> str:
    """User-provided key (header/form) takes precedence over server .env."""
    candidates = [
        (header_key or "").strip(),
        (form_key or "").strip(),
    ]
    if request is not None:
        candidates.append((request.headers.get("x-sarvam-api-key") or "").strip())
    for key in candidates:
        if key:
            return key
    return SARVAM_API_KEY_ENV


def require_sarvam_api_key(
    request: Request | None = None,
    *,
    header_key: str | None = None,
    form_key: str | None = None,
) -> str:
    key = resolve_sarvam_api_key(request, header_key=header_key, form_key=form_key)
    if not key:
        raise HTTPException(status_code=503, detail="API Key is Required")
    return key


def get_sarvam_client(api_key: str | None = None):
    from sarvamai import SarvamAI

    key = (api_key or SARVAM_API_KEY_ENV or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="API Key is Required")
    return SarvamAI(api_subscription_key=key)


def raise_if_sarvam_auth_error(exc: Exception) -> None:
    """Map Sarvam 403 invalid_api_key to a clear HTTP error."""
    msg = str(exc).lower()
    if "invalid_api_key" in msg or "invalid or missing authentication" in msg:
        raise HTTPException(status_code=503, detail="Invalid API Key") from exc
