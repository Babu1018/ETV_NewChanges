import logging
import os

from dotenv import load_dotenv
from fastapi import HTTPException, Request, Security
from fastapi.security import APIKeyHeader

from app.config import BACKEND_ROOT

load_dotenv(BACKEND_ROOT / ".env")

API_AUTH_KEY = os.getenv("API_AUTH_KEY", "")
api_key_header = APIKeyHeader(name="x-api-key", auto_error=False)
sarvam_api_key_header = APIKeyHeader(name="x-sarvam-api-key", auto_error=False)


def get_client_ip(request: Request) -> str:
    x_forwarded_for = request.headers.get("x-forwarded-for")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    x_real_ip = request.headers.get("x-real-ip")
    if x_real_ip:
        return x_real_ip
    return request.client.host if request.client else "unknown"


def verify_api_key(
    request: Request,
    api_key: str | None,
    *,
    log_name: str = "ASR",
) -> None:
    if not API_AUTH_KEY:
        return
    if api_key != API_AUTH_KEY:
        logging.getLogger(log_name).warning(
            "Unauthorized access from %s", get_client_ip(request)
        )
        raise HTTPException(status_code=401, detail="Invalid API Key")
