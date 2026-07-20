"""Send password-reset OTP via SMTP (Gmail, Outlook, or any SMTP server)."""
import logging
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from dotenv import load_dotenv

from app.config import BACKEND_ROOT

load_dotenv(BACKEND_ROOT / ".env")

logger = logging.getLogger("ASR")

SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").strip()
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER).strip()
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").strip().lower() in ("1", "true", "yes")
APP_NAME = os.getenv("SMTP_APP_NAME", "ASR Studio").strip()


def is_smtp_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM)


def send_password_reset_otp(to_email: str, otp: str, valid_minutes: int = 15) -> None:
    """Raise on failure so the caller can log and fall back to dev OTP logging."""
    if not is_smtp_configured():
        raise RuntimeError(
            "SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in back_end/.env"
        )

    subject = f"{APP_NAME} — password reset code"
    text_body = (
        f"Your verification code is: {otp}\n\n"
        f"This code expires in {valid_minutes} minutes.\n\n"
        f"If you did not request a password reset, you can ignore this email.\n"
    )
    html_body = f"""
    <html><body style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
      <p>Your <strong>{APP_NAME}</strong> verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0;">{otp}</p>
      <p style="color:#64748b;font-size:14px;">Expires in {valid_minutes} minutes.</p>
      <p style="color:#64748b;font-size:14px;">If you did not request this, ignore this email.</p>
    </body></html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    if SMTP_USE_TLS:
        context = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, [to_email], msg.as_string())
    else:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, [to_email], msg.as_string())

    logger.info("Password reset OTP emailed to %s", to_email)
