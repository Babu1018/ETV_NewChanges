import logging
import random
import secrets
from datetime import datetime, timedelta, timezone

from app.auth.passwords import hash_password, verify_password

logger = logging.getLogger("ASR")

OTP_LENGTH = 6
OTP_TTL_MINUTES = 15
RESET_TOKEN_TTL_MINUTES = 30


def generate_otp() -> str:
    return "".join(str(random.randint(0, 9)) for _ in range(OTP_LENGTH))


def hash_otp(otp: str) -> str:
    return hash_password(otp)


def verify_otp(otp: str, otp_hash: str) -> bool:
    return verify_password(otp, otp_hash)


def otp_expires_at() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)


def reset_token_expires_at() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)


def generate_reset_token() -> str:
    return secrets.token_urlsafe(32)


def log_otp_for_dev(email: str, otp: str) -> None:
    logger.info("Password reset OTP for %s: %s (valid %s min)", email, otp, OTP_TTL_MINUTES)
