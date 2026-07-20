"""Per-user ASR/TTS history list/audio access, including legacy rows and activity-log fallback."""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.asr_history import AsrHistoryEntry
from app.models.tts_history import TtsHistoryEntry
from app.models.user import User


def linked_history_ids(db: Session, user: User, activity_type: str) -> list[UUID]:
    rows = (
        db.query(ActivityLog.linked_history_id)
        .filter(
            ActivityLog.user_id == user.id,
            ActivityLog.activity_type == activity_type,
            ActivityLog.linked_history_id.isnot(None),
        )
        .all()
    )
    return [row[0] for row in rows if row[0] is not None]


def asr_history_query(db: Session, user: User):
    linked = linked_history_ids(db, user, "asr")
    filters = [AsrHistoryEntry.user_id == user.id]
    if linked:
        filters.append(AsrHistoryEntry.id.in_(linked))
    return db.query(AsrHistoryEntry).filter(or_(*filters))


def tts_history_query(db: Session, user: User):
    linked = linked_history_ids(db, user, "tts")
    filters = [TtsHistoryEntry.user_id == user.id]
    if linked:
        filters.append(TtsHistoryEntry.id.in_(linked))
    return db.query(TtsHistoryEntry).filter(or_(*filters))


def activity_log_for_history(
    db: Session,
    user: User,
    history_id: UUID,
    activity_type: str,
    *,
    file_name: str | None = None,
) -> ActivityLog | None:
    row = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.user_id == user.id,
            ActivityLog.activity_type == activity_type,
            ActivityLog.linked_history_id == history_id,
        )
        .order_by(ActivityLog.created_at.desc())
        .first()
    )
    if row is not None:
        return row

    if not file_name:
        return None

    return (
        db.query(ActivityLog)
        .filter(
            ActivityLog.user_id == user.id,
            ActivityLog.activity_type == activity_type,
            ActivityLog.file_name == file_name,
        )
        .order_by(ActivityLog.created_at.desc())
        .first()
    )


def resolve_history_audio(
    db: Session,
    user: User,
    history_id: UUID,
    activity_type: str,
    *,
    history_audio: bytes | None,
    history_mime: str,
    history_download_name: str,
    file_name: str | None = None,
) -> tuple[bytes, str, str] | None:
    if history_audio:
        return history_audio, history_mime, history_download_name

    log = activity_log_for_history(
        db, user, history_id, activity_type, file_name=file_name
    )
    if log is None or not log.audio_data:
        return None

    return log.audio_data, log.mime_type, log.download_name
