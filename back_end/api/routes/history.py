import logging
import re
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.activity_log_link import (
    mark_activity_log_deleted_for_history,
    mark_all_saved_activity_logs_deleted,
)
from app.auth.deps import get_current_user
from app.db import get_db
from app.history_access import asr_history_query, resolve_history_audio
from app.models.asr_history import AsrHistoryEntry
from app.models.user import User
from app.utils.user_messages import log_user_label

router = APIRouter(prefix="/asr", tags=["ASR History"])
logger = logging.getLogger("ASR")

HISTORY_CACHE_HEADERS = {"Cache-Control": "no-store, private"}

MAX_AUDIO_BYTES = 80 * 1024 * 1024
MAX_TRANSCRIPT_CHARS = 2_000_000

MIME_FOR_FORMAT = {
    "wav": "audio/wav",
    "wave": "audio/wav",
    "mp3": "audio/mpeg",
    "mpeg": "audio/mpeg",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
}


def _database_error_detail(exc: Exception) -> str:
    msg = str(exc).strip() or exc.__class__.__name__
    return (
        "Database unavailable. In Docker use DATABASE_URL with host `db` (see docker-compose) "
        "or `host.docker.internal` if PostgreSQL runs on your PC. "
        f"Details: {msg}"
    )


def _sanitize_file_name(name: str) -> str:
    name = (name or "").strip()
    name = re.sub(r"[^\w\-. ]+", "", name)
    name = re.sub(r"\s+", "_", name).strip("._") or "recording"
    return name[:200]


def _asr_validator_logger(language: str) -> logging.Logger:
    mapping = {
        "english": "EnglishASR",
        "hindi": "HindiASR",
        "telugu": "TeluguASR",
    }
    return logging.getLogger(mapping.get((language or "").strip().lower(), "EnglishASR"))


def _user_history_query(db: Session, user: User):
    return asr_history_query(db, user)


def _get_user_history_row(db: Session, user: User, history_id: UUID) -> AsrHistoryEntry | None:
    return (
        _user_history_query(db, user)
        .filter(AsrHistoryEntry.id == history_id)
        .first()
    )


class HistoryItemOut(BaseModel):
    id: str
    createdAt: str
    fileName: str
    downloadName: str
    language: str
    validatorName: str
    audioFormat: str
    mimeType: str
    textPreview: str
    transcriptText: str

    @classmethod
    def from_row(cls, row: AsrHistoryEntry) -> "HistoryItemOut":
        created = row.created_at.isoformat() if row.created_at else ""
        return cls(
            id=str(row.id),
            createdAt=created,
            fileName=row.file_name,
            downloadName=row.download_name,
            language=row.language,
            validatorName=row.validator_name or "",
            audioFormat=row.audio_format,
            mimeType=row.mime_type,
            textPreview=row.text_preview,
            transcriptText=row.transcript_text,
        )


def _mime_for_format(fmt: str, upload_content_type: str | None) -> str:
    if upload_content_type and upload_content_type.startswith("audio/"):
        return upload_content_type.split(";")[0].strip()
    return MIME_FOR_FORMAT.get(fmt.lower(), "application/octet-stream")


@router.get("/history", response_model=list[HistoryItemOut])
def list_history(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for key, value in HISTORY_CACHE_HEADERS.items():
        response.headers[key] = value
    try:
        rows = (
            _user_history_query(db, current_user)
            .order_by(AsrHistoryEntry.created_at.desc())
            .all()
        )
        return [HistoryItemOut.from_row(r) for r in rows]
    except OperationalError as exc:
        logger.exception("Failed to list ASR history (database connection)")
        raise HTTPException(status_code=503, detail=_database_error_detail(exc)) from exc
    except SQLAlchemyError as exc:
        logger.exception("Failed to list ASR history")
        raise HTTPException(status_code=503, detail=_database_error_detail(exc)) from exc


@router.post("/history", response_model=HistoryItemOut)
async def create_history(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    transcript_text: str = Form(...),
    file_name: str = Form(...),
    language: str = Form(...),
    validator_name: str = Form(""),
    audio_format: str = Form(...),
    audio: UploadFile = File(...),
):
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio file is missing.")
    if len(transcript_text) > MAX_TRANSCRIPT_CHARS:
        raise HTTPException(status_code=400, detail="transcript too large")

    safe_name = _sanitize_file_name(file_name)
    fmt = (audio_format or "wav").lower().lstrip(".")
    mime = _mime_for_format(fmt, audio.content_type)
    raw = await audio.read()
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="audio file too large")
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio file")

    preview = (transcript_text or "").strip()[:120]
    download_name = f"{safe_name}.{fmt}"
    row = AsrHistoryEntry(
        user_id=current_user.id,
        file_name=safe_name,
        download_name=download_name,
        language=language,
        validator_name=(validator_name or "").strip()[:128],
        audio_format=fmt,
        mime_type=mime,
        text_preview=preview,
        transcript_text=transcript_text,
        audio_data=raw,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    client_ip = request.client.host if request.client else "127.0.0.1"
    _asr_validator_logger(language).info(
        f"[SAVED] {datetime.utcnow().isoformat()} | From: {client_ip} | "
        f"User: {log_user_label(current_user)} | File: {safe_name} | Language: {language}"
    )

    return HistoryItemOut.from_row(row)


@router.get("/history/{history_id}/audio")
def get_history_audio(
    history_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_user_history_row(db, current_user, history_id)
    if row is None:
        raise HTTPException(status_code=404, detail="History entry not found")

    resolved = resolve_history_audio(
        db,
        current_user,
        history_id,
        "asr",
        history_audio=row.audio_data,
        history_mime=row.mime_type,
        history_download_name=row.download_name,
        file_name=row.file_name,
    )
    if resolved is None:
        raise HTTPException(status_code=404, detail="History audio not found")

    audio_bytes, mime_type, download_name = resolved
    return Response(
        content=audio_bytes,
        media_type=mime_type,
        headers={
            **HISTORY_CACHE_HEADERS,
            "Content-Disposition": f'inline; filename="{download_name}"',
        },
    )


@router.delete("/history/{history_id}", status_code=204)
def delete_history_item(
    history_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_user_history_row(db, current_user, history_id)
    if row is None:
        raise HTTPException(status_code=404, detail="History entry not found")
    mark_activity_log_deleted_for_history(
        db, current_user.id, history_id, row.file_name, "asr"
    )
    db.delete(row)
    db.commit()


@router.delete("/history", status_code=204)
def clear_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mark_all_saved_activity_logs_deleted(db, current_user.id)
    _user_history_query(db, current_user).delete()
    db.commit()
