"""SQLAlchemy engine and session for ETV (ASR + TTS history, shared users)."""
import logging
import os

from dotenv import load_dotenv
from fastapi import HTTPException
from sqlalchemy.orm import declarative_base

from app.config import BACKEND_ROOT

load_dotenv(BACKEND_ROOT / ".env")

logger = logging.getLogger("ASR")
Base = declarative_base()

engine = None
SessionLocal = None
DATABASE_URL = ""


def resolve_database_url() -> str:
    explicit = os.getenv("DATABASE_URL", "").strip()
    if not explicit:
        logger.error(
            "DATABASE_URL is not set. Create database 'ETV' in pgAdmin and set "
            "DATABASE_URL=postgresql+psycopg2://USER:PASSWORD@localhost:5432/ETV"
        )
        return ""
    if not explicit.startswith("postgresql"):
        logger.error("DATABASE_URL must use PostgreSQL (postgresql+psycopg2://...)")
        return ""
    return explicit


def _create_engine(url: str):
    from sqlalchemy import create_engine

    kwargs = {"pool_pre_ping": True}
    if url.startswith("postgresql"):
        kwargs["connect_args"] = {"connect_timeout": 5}
    return create_engine(url, **kwargs)


def _ensure_engine() -> None:
    global engine, SessionLocal, DATABASE_URL
    if engine is not None and SessionLocal is not None:
        return
    if not DATABASE_URL:
        DATABASE_URL = resolve_database_url()
    if not DATABASE_URL:
        logger.warning("No database URL — auth/history return 503 until DATABASE_URL is set")
        return
    try:
        from sqlalchemy.orm import sessionmaker

        engine = _create_engine(DATABASE_URL)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        logger.info("ETV database: PostgreSQL")
    except Exception as exc:
        logger.error("Failed to create database engine: %s", exc)
        engine = None
        SessionLocal = None


def init_db() -> None:
    _ensure_engine()
    if engine is None:
        return
    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError

    from app.models.activity_log import ActivityLog  # noqa: F401
    from app.models.activity_log_edit_audio import ActivityLogEditAudio  # noqa: F401
    from app.models.asr_history import AsrHistoryEntry  # noqa: F401
    from app.models.password_reset import PasswordResetOtp  # noqa: F401
    from app.models.tts_history import TtsHistoryEntry  # noqa: F401
    from app.models.user import User  # noqa: F401

    try:
        Base.metadata.create_all(bind=engine, checkfirst=True)
        logger.info("Database tables ensured (create_all)")
    except OperationalError as exc:
        logger.warning(
            "PostgreSQL not reachable at startup (auth/history return 503 until DB is up): %s",
            exc,
        )
        return
    except Exception as exc:
        logger.error("create_all failed: %s", exc)

    try:
        _migrate_history_user_id("asr_history")
        _migrate_history_user_id("tts_history")
        _migrate_history_user_id_backfill()
        _migrate_activity_log_edit_regions()
        _migrate_activity_log_history_status()
        _migrate_activity_log_user_snapshot()
        _migrate_activity_log_edit_audios()
        _migrate_activity_log_transcript_edits()
        _migrate_user_roles()
    except Exception as exc:
        logger.warning("Database migration skipped or failed: %s", exc)


def _migration_connection():
    """Short-lived connection with lock/statement timeouts so startup cannot hang."""
    from sqlalchemy import text

    conn = engine.connect()
    try:
        conn.execute(text("SET lock_timeout = '5s'"))
        conn.execute(text("SET statement_timeout = '30s'"))
        conn.commit()
        return conn
    except Exception:
        conn.close()
        raise


def _migrate_history_user_id(table: str) -> None:
    if engine is None:
        return
    from sqlalchemy import text

    logger.info("Migrating %s.user_id column (if needed)...", table)
    conn = _migration_connection()
    try:
        with conn.begin():
            conn.execute(
                text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS user_id UUID")
            )
        logger.info("%s.user_id migration complete", table)
    except Exception as exc:
        logger.warning("%s user_id column migration skipped or failed: %s", table, exc)
    finally:
        conn.close()


def _migrate_history_user_id_backfill() -> None:
    """Attach legacy history rows (user_id NULL) to owners via activity_logs."""
    if engine is None:
        return
    from sqlalchemy import text

    logger.info("Backfilling history.user_id from activity_logs (if needed)...")
    conn = _migration_connection()
    try:
        with conn.begin():
            conn.execute(
                text(
                    """
                    UPDATE asr_history AS ah
                    SET user_id = al.user_id
                    FROM activity_logs AS al
                    WHERE ah.user_id IS NULL
                      AND al.user_id IS NOT NULL
                      AND al.activity_type = 'asr'
                      AND al.linked_history_id = ah.id
                    """
                )
            )
            conn.execute(
                text(
                    """
                    UPDATE tts_history AS th
                    SET user_id = al.user_id
                    FROM activity_logs AS al
                    WHERE th.user_id IS NULL
                      AND al.user_id IS NOT NULL
                      AND al.activity_type = 'tts'
                      AND al.linked_history_id = th.id
                    """
                )
            )
        logger.info("history.user_id backfill complete")
    except Exception as exc:
        logger.warning("history.user_id backfill skipped or failed: %s", exc)
    finally:
        conn.close()


def _migrate_activity_log_edit_regions() -> None:
    if engine is None:
        return
    from sqlalchemy import text

    logger.info("Migrating activity_logs.edit_regions column (if needed)...")
    conn = _migration_connection()
    try:
        with conn.begin():
            conn.execute(
                text(
                    "ALTER TABLE activity_logs "
                    "ADD COLUMN IF NOT EXISTS edit_regions TEXT NOT NULL DEFAULT '[]'"
                )
            )
        logger.info("activity_logs.edit_regions migration complete")
    except Exception as exc:
        logger.warning("activity_logs.edit_regions migration skipped or failed: %s", exc)
    finally:
        conn.close()


def _migrate_activity_log_history_status() -> None:
    if engine is None:
        return
    from sqlalchemy import text

    logger.info("Migrating activity_logs history link columns (if needed)...")
    conn = _migration_connection()
    try:
        with conn.begin():
            conn.execute(
                text(
                    "ALTER TABLE activity_logs "
                    "ADD COLUMN IF NOT EXISTS linked_history_id UUID"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE activity_logs "
                    "ADD COLUMN IF NOT EXISTS history_status VARCHAR(16) NOT NULL DEFAULT 'unsaved'"
                )
            )
        logger.info("activity_logs history link migration complete")
    except Exception as exc:
        logger.warning("activity_logs history link migration skipped or failed: %s", exc)
    finally:
        conn.close()


def _migrate_activity_log_user_snapshot() -> None:
    if engine is None:
        return
    from sqlalchemy import text

    logger.info("Migrating activity_logs user snapshot columns (if needed)...")
    conn = _migration_connection()
    try:
        with conn.begin():
            conn.execute(
                text(
                    "ALTER TABLE activity_logs "
                    "ADD COLUMN IF NOT EXISTS user_email VARCHAR(255)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE activity_logs "
                    "ADD COLUMN IF NOT EXISTS user_name VARCHAR(255)"
                )
            )
            conn.execute(
                text(
                    """
                    UPDATE activity_logs AS al
                    SET
                        user_email = u.email,
                        user_name = COALESCE(
                            NULLIF(TRIM(CONCAT(u.firstname, ' ', u.lastname)), ''),
                            u.email
                        )
                    FROM users AS u
                    WHERE al.user_id = u.id
                      AND (al.user_email IS NULL OR al.user_name IS NULL)
                    """
                )
            )
        logger.info("activity_logs user snapshot migration complete")
    except Exception as exc:
        logger.warning("activity_logs user snapshot migration skipped or failed: %s", exc)
    finally:
        conn.close()


def _migrate_activity_log_edit_audios() -> None:
    if engine is None:
        return
    from sqlalchemy import text

    logger.info("Migrating activity_log_edit_audios table (if needed)...")
    conn = _migration_connection()
    try:
        with conn.begin():
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS activity_log_edit_audios (
                        id UUID PRIMARY KEY,
                        activity_log_id UUID NOT NULL
                            REFERENCES activity_logs(id) ON DELETE CASCADE,
                        start_sec DOUBLE PRECISION NOT NULL,
                        end_sec DOUBLE PRECISION NOT NULL,
                        file_name VARCHAR(255) NOT NULL,
                        download_name VARCHAR(512) NOT NULL,
                        audio_format VARCHAR(32) NOT NULL,
                        mime_type VARCHAR(128) NOT NULL,
                        audio_data BYTEA NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_activity_log_edit_audios_log_id "
                    "ON activity_log_edit_audios (activity_log_id)"
                )
            )
        logger.info("activity_log_edit_audios migration complete")
    except Exception as exc:
        logger.warning("activity_log_edit_audios migration skipped or failed: %s", exc)
    finally:
        conn.close()


def _migrate_activity_log_transcript_edits() -> None:
    if engine is None:
        return
    from sqlalchemy import text

    logger.info("Migrating activity_logs transcript edit columns (if needed)...")
    conn = _migration_connection()
    try:
        with conn.begin():
            conn.execute(
                text(
                    "ALTER TABLE activity_logs "
                    "ADD COLUMN IF NOT EXISTS original_text_content TEXT"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE activity_logs "
                    "ADD COLUMN IF NOT EXISTS transcript_edits TEXT NOT NULL DEFAULT '{}'"
                )
            )
            conn.execute(
                text(
                    """
                    UPDATE activity_logs
                    SET original_text_content = text_content
                    WHERE activity_type = 'asr'
                      AND original_text_content IS NULL
                    """
                )
            )
        logger.info("activity_logs transcript edit migration complete")
    except Exception as exc:
        logger.warning("activity_logs transcript edit migration skipped or failed: %s", exc)
    finally:
        conn.close()


def _migrate_user_roles() -> None:
    if engine is None:
        return
    from sqlalchemy import text

    from app.auth.roles import ADMIN_EMAILS

    logger.info("Migrating users.role column (if needed)...")
    conn = _migration_connection()
    try:
        with conn.begin():
            conn.execute(
                text(
                    "ALTER TABLE users "
                    "ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'user'"
                )
            )
            for email in ADMIN_EMAILS:
                conn.execute(
                    text("UPDATE users SET role = 'admin' WHERE lower(email) = :email"),
                    {"email": email.lower()},
                )
        logger.info("User roles migration complete (admin emails: %s)", ", ".join(sorted(ADMIN_EMAILS)))
    except Exception as exc:
        logger.warning("User role migration skipped or failed: %s", exc)
    finally:
        conn.close()


def get_db():
    _ensure_engine()
    if SessionLocal is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "PostgreSQL not configured. Set DATABASE_URL in back_end/.env "
                "(database 'ETV' in pgAdmin) and ensure the server is running."
            ),
        )
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
