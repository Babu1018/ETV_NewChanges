import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth.email_service import is_smtp_configured, send_password_reset_otp
from app.auth.jwt_utils import create_access_token
from app.auth.otp import (
    OTP_LENGTH,
    OTP_TTL_MINUTES,
    generate_otp,
    generate_reset_token,
    hash_otp,
    log_otp_for_dev,
    otp_expires_at,
    reset_token_expires_at,
    verify_otp,
)
from app.auth.passwords import hash_password, verify_password
from app.auth.roles import ROLE_USER
from app.db import get_db
from app.models.password_reset import PasswordResetOtp
from app.models.user import User
from api.routes.users import UserProfile, user_to_profile

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger("ASR")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _is_expired(expires_at: datetime) -> bool:
    exp = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
    return exp.astimezone(timezone.utc) < _utc_now()


class RegisterBody(BaseModel):
    firstname: str = Field(..., min_length=1, max_length=128)
    lastname: str = Field(..., min_length=1, max_length=128)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    contactno: str | None = None
    dob: date | None = None
    place: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    gender: str | None = None


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class EmailBody(BaseModel):
    email: EmailStr


class VerifyOtpBody(BaseModel):
    email: EmailStr
    otp: str = Field(..., min_length=OTP_LENGTH, max_length=OTP_LENGTH)


class ResetPasswordBody(BaseModel):
    email: EmailStr
    token: str
    new_password: str = Field(..., min_length=6, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfile | None = None


class MessageResponse(BaseModel):
    message: str


class ResetTokenResponse(BaseModel):
    reset_token: str


@router.post("/register", response_model=MessageResponse)
def register(body: RegisterBody, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=email,
        password_hash=hash_password(body.password),
        firstname=body.firstname.strip(),
        lastname=body.lastname.strip(),
        contactno=body.contactno,
        dob=body.dob,
        place=body.place,
        city=body.city,
        state=body.state,
        pincode=body.pincode,
        gender=body.gender,
        role=ROLE_USER,
    )
    db.add(user)
    db.commit()
    logger.info("User registered: %s", email)
    return MessageResponse(message="Registration successful")


@router.post("/token-login", response_model=TokenResponse)
def token_login(body: LoginBody, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    try:
        user = db.query(User).filter(User.email == email, User.is_active.is_(True)).first()
    except SQLAlchemyError as exc:
        logger.exception("Login database error")
        detail = str(exc).strip()
        if "users" in detail and "does not exist" in detail.lower():
            detail = (
                "Auth tables are missing in PostgreSQL. Rebuild and restart the API container: "
                "docker compose up --build -d api"
            )
        raise HTTPException(status_code=503, detail=detail) from exc
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user.id, user.email)
    return TokenResponse(access_token=token, user=user_to_profile(user))


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(body: EmailBody, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email")

    otp = generate_otp()
    db.query(PasswordResetOtp).filter(PasswordResetOtp.email == email).delete()
    db.add(
        PasswordResetOtp(
            email=email,
            otp_hash=hash_otp(otp),
            expires_at=otp_expires_at(),
        )
    )
    db.commit()

    if is_smtp_configured():
        try:
            send_password_reset_otp(email, otp, OTP_TTL_MINUTES)
        except Exception as exc:
            logger.error("Failed to send OTP email to %s: %s", email, exc)
            log_otp_for_dev(email, otp)
            raise HTTPException(
                status_code=503,
                detail="Could not send verification email. Check SMTP settings in back_end/.env",
            ) from exc
    else:
        log_otp_for_dev(email, otp)
        logger.warning(
            "SMTP not configured — OTP for %s was logged only (see terminal / logs). "
            "Set SMTP_* in back_end/.env to send email.",
            email,
        )

    return MessageResponse(message="Verification code sent")


@router.post("/verify-otp", response_model=ResetTokenResponse)
def verify_otp_endpoint(body: VerifyOtpBody, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    row = (
        db.query(PasswordResetOtp)
        .filter(PasswordResetOtp.email == email)
        .order_by(PasswordResetOtp.created_at.desc())
        .first()
    )
    if not row or _is_expired(row.expires_at):
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    if not verify_otp(body.otp, row.otp_hash):
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    reset_token = generate_reset_token()
    row.reset_token = reset_token
    row.expires_at = reset_token_expires_at()
    db.commit()
    return ResetTokenResponse(reset_token=reset_token)


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(body: ResetPasswordBody, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    row = (
        db.query(PasswordResetOtp)
        .filter(
            PasswordResetOtp.email == email,
            PasswordResetOtp.reset_token == body.token,
        )
        .first()
    )
    if not row or not row.reset_token or _is_expired(row.expires_at):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = hash_password(body.new_password)
    db.query(PasswordResetOtp).filter(PasswordResetOtp.email == email).delete()
    db.commit()
    return MessageResponse(message="Password updated")
