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
from app.history_access import resolve_history_audio, tts_history_query
from app.models.tts_history import TtsHistoryEntry
from app.models.user import User
from app.utils.user_messages import log_user_label

router = APIRouter(prefix="/tts", tags=["History"])
logger = logging.getLogger("ASR")

HISTORY_CACHE_HEADERS = {"Cache-Control": "no-store, private"}

MAX_AUDIO_BYTES = 80 * 1024 * 1024
MAX_SCRIPT_CHARS = 2_000_000

AUDIO_ONLY_RECORDING_LABEL = "Audio-only recording"


def _normalize_history_script(script_text: str) -> str:
    stripped = (script_text or "").strip()
    if not stripped:
        return AUDIO_ONLY_RECORDING_LABEL
    if stripped.lower() in {"uploaded audio", "audio-only recording"}:
        return AUDIO_ONLY_RECORDING_LABEL
    return script_text


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


def _user_history_query(db: Session, user: User):
    return tts_history_query(db, user)


def _get_user_history_row(db: Session, user: User, history_id: UUID) -> TtsHistoryEntry | None:
    return (
        _user_history_query(db, user)
        .filter(TtsHistoryEntry.id == history_id)
        .first()
    )


MIME_FOR_FORMAT = {
    "wav": "audio/wav",
    "wave": "audio/wav",
    "mp3": "audio/mpeg",
    "mpeg": "audio/mpeg",
}


class HistoryItemOut(BaseModel):
    id: str
    createdAt: str
    fileName: str
    downloadName: str
    language: str
    gender: str
    speaker: str
    audioFormat: str
    mimeType: str
    textPreview: str
    scriptText: str

    @classmethod
    def from_row(cls, row: TtsHistoryEntry) -> "HistoryItemOut":
        created = row.created_at.isoformat() if row.created_at else ""
        return cls(
            id=str(row.id),
            createdAt=created,
            fileName=row.file_name,
            downloadName=row.download_name,
            language=row.language,
            gender=row.gender,
            speaker=row.speaker,
            audioFormat=row.audio_format,
            mimeType=row.mime_type,
            textPreview=row.text_preview,
            scriptText=row.script_text,
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
            .order_by(TtsHistoryEntry.created_at.desc())
            .all()
        )
        return [HistoryItemOut.from_row(r) for r in rows]
    except OperationalError as exc:
        logger.exception("Failed to list TTS history (database connection)")
        raise HTTPException(status_code=503, detail=_database_error_detail(exc)) from exc
    except SQLAlchemyError as exc:
        logger.exception("Failed to list TTS history")
        raise HTTPException(status_code=503, detail=_database_error_detail(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to list TTS history")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/history", response_model=HistoryItemOut)
async def create_history(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    script_text: str = Form(...),
    file_name: str = Form(...),
    language: str = Form(...),
    gender: str = Form(default=""),
    speaker: str = Form(default=""),
    audio_format: str = Form(...),
    audio: UploadFile = File(...),
):
    if not audio.filename:
        raise HTTPException(
            status_code=400,
            detail="Audio file is missing from the upload. Please try saving again.",
        )
    if len(script_text) > MAX_SCRIPT_CHARS:
        raise HTTPException(status_code=400, detail="script_text too large")

    safe_name = _sanitize_file_name(file_name)
    fmt = (audio_format or "wav").lower().lstrip(".")
    mime = _mime_for_format(fmt, audio.content_type)
    raw = await audio.read()
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="audio file too large")
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio file")

    stored_script = _normalize_history_script(script_text)
    text_preview = stored_script[:120]
    audio_only = stored_script == AUDIO_ONLY_RECORDING_LABEL

    download_name = f"{safe_name}.{fmt}"
    row = TtsHistoryEntry(
        user_id=current_user.id,
        file_name=safe_name,
        download_name=download_name,
        language=language,
        gender="-" if audio_only else (gender or "").strip(),
        speaker="-" if audio_only else (speaker or "").strip(),
        audio_format=fmt,
        mime_type=mime,
        text_preview=text_preview,
        script_text=stored_script,
        audio_data=raw,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    client_ip = request.client.host if request.client else "127.0.0.1"
    gender_label = "" if audio_only else (gender or "").strip()
    speaker_label = "" if audio_only else (speaker or "").strip()
    logging.getLogger("TTS").info(
        f"[SAVED] {datetime.utcnow().isoformat()} | From: {client_ip} | "
        f"User: {log_user_label(current_user)} | File: {safe_name} | Language: {language}"
        + (f" | Gender: {gender_label} | Speaker: {speaker_label}" if not audio_only else "")
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
        "tts",
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
        db, current_user.id, history_id, row.file_name, "tts"
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
