"""Link admin activity logs to user History save/delete state."""
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.asr_history import AsrHistoryEntry
from app.models.tts_history import TtsHistoryEntry

HISTORY_STATUS_UNSAVED = "unsaved"
HISTORY_STATUS_SAVED = "saved"
HISTORY_STATUS_DELETED = "deleted"


def link_activity_log_to_history(
    db: Session,
    user_id: UUID,
    activity_log_id: UUID,
    history_id: UUID,
) -> None:
    row = (
        db.query(ActivityLog)
        .filter(ActivityLog.id == activity_log_id, ActivityLog.user_id == user_id)
        .first()
    )
    if row is None:
        return
    row.linked_history_id = history_id
    row.history_status = HISTORY_STATUS_SAVED


def mark_activity_log_deleted_for_history(
    db: Session,
    user_id: UUID,
    history_id: UUID,
    file_name: str | None = None,
    activity_type: str | None = None,
) -> None:
    query = db.query(ActivityLog).filter(ActivityLog.user_id == user_id)
    if activity_type:
        query = query.filter(ActivityLog.activity_type == activity_type)
    for row in query.all():
        if row.linked_history_id == history_id:
            row.history_status = HISTORY_STATUS_DELETED
            continue
        if file_name and row.file_name == file_name and row.history_status != HISTORY_STATUS_DELETED:
            row.history_status = HISTORY_STATUS_DELETED


def mark_all_saved_activity_logs_deleted(db: Session, user_id: UUID) -> None:
    (
        db.query(ActivityLog)
        .filter(
            ActivityLog.user_id == user_id,
            ActivityLog.history_status == HISTORY_STATUS_SAVED,
        )
        .update({ActivityLog.history_status: HISTORY_STATUS_DELETED})
    )


def resolve_history_status_label(row: ActivityLog, db: Session) -> str:
    status = getattr(row, "history_status", None) or HISTORY_STATUS_UNSAVED
    if status == HISTORY_STATUS_DELETED:
        return "Deleted"

    history_id = getattr(row, "linked_history_id", None)
    if status == HISTORY_STATUS_SAVED:
        if not history_id:
            return _infer_status_from_history_match(row, db)
        if _history_row_exists(row, db, history_id):
            return "Saved"
        return "Deleted"

    return _infer_status_from_history_match(row, db)


def _history_row_exists(row: ActivityLog, db: Session, history_id: UUID) -> bool:
    if row.activity_type == "asr":
        return (
            db.query(AsrHistoryEntry.id)
            .filter(AsrHistoryEntry.id == history_id)
            .first()
            is not None
        )
    return (
        db.query(TtsHistoryEntry.id)
        .filter(TtsHistoryEntry.id == history_id)
        .first()
        is not None
    )


def _infer_status_from_history_match(row: ActivityLog, db: Session) -> str:
    """Fallback when history-link was missed (e.g. before feature or after timeout)."""
    if not row.user_id or not row.file_name:
        return "Unsaved"

    if row.activity_type == "asr":
        exists = (
            db.query(AsrHistoryEntry.id)
            .filter(
                AsrHistoryEntry.user_id == row.user_id,
                AsrHistoryEntry.file_name == row.file_name,
            )
            .first()
        )
    else:
        exists = (
            db.query(TtsHistoryEntry.id)
            .filter(
                TtsHistoryEntry.user_id == row.user_id,
                TtsHistoryEntry.file_name == row.file_name,
            )
            .first()
        )
    return "Saved" if exists else "Unsaved"
