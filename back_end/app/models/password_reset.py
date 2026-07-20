import uuid

from sqlalchemy import Column, DateTime, String, Uuid, func

from app.db import Base


class PasswordResetOtp(Base):
    __tablename__ = "password_reset_otps"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False, index=True)
    otp_hash = Column(String(255), nullable=False)
    reset_token = Column(String(255), nullable=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
