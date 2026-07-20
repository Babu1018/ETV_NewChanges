"""Server-side admin activity logs (Users Logs) for ASR/TTS jobs."""
from __future__ import annotations

import logging
import json
import re
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.user import User
from app.transcript_diff import compute_transcript_diff

logger = logging.getLogger("ASR")

AUDIO_ONLY_RECORDING_LABEL = "Audio-only recording"

MIME_FOR_FORMAT = {
    "wav": "audio/wav",
    "wave": "audio/wav",
    "mp3": "audio/mpeg",
    "mpeg": "audio/mpeg",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
}


def _sanitize_file_name(name: str) -> str:
    name = (name or "").strip()
    name = re.sub(r"[^\w\-. ]+", "", name)
    name = re.sub(r"\s+", "_", name).strip("._") or "recording"
    return name[:200]


def _user_display_name(user: User) -> str:
    name = f"{user.firstname or ''} {user.lastname or ''}".strip()
    return name or user.email or "—"


def _normalize_tts_script(script_text: str) -> str:
    stripped = (script_text or "").strip()
    if not stripped:
        return AUDIO_ONLY_RECORDING_LABEL
    if stripped.lower() in {"uploaded audio", "audio-only recording"}:
        return AUDIO_ONLY_RECORDING_LABEL
    return script_text


def apply_asr_transcript_edit(
    row: ActivityLog,
    edited_text: str,
    *,
    validator_name: str | None = None,
) -> None:
    """Update ASR log with manually edited transcript and diff segments."""
    original = row.original_text_content
    if original is None:
        original = row.text_content or ""
        row.original_text_content = original

    row.text_content = edited_text
    row.text_preview = (edited_text or "").strip()[:120]
    row.transcript_edits = json.dumps(
        compute_transcript_diff(original, edited_text),
        ensure_ascii=False,
    )
    if validator_name is not None:
        row.validator_name = (validator_name or "").strip()[:128]


def record_studio_activity_log(
    db: Session,
    user: User | None,
    *,
    activity_type: str,
    text_content: str,
    language: str,
    audio_bytes: bytes,
    audio_format: str,
    mime_type: str | None = None,
    file_name: str = "recording",
    validator_name: str = "",
    gender: str = "",
    speaker: str = "",
) -> UUID | None:
    """Persist a Users Logs row. Never raises — failures are logged only."""
    if user is None or not audio_bytes:
        return None

    normalized_type = (activity_type or "").strip().lower()
    if normalized_type not in ("asr", "tts"):
        return None

    try:
        safe_name = _sanitize_file_name(file_name)
        fmt = (audio_format or "wav").lower().lstrip(".")
        mime = mime_type or MIME_FOR_FORMAT.get(fmt, "application/octet-stream")
        stored_text = (
            _normalize_tts_script(text_content)
            if normalized_type == "tts"
            else (text_content or "")
        )
        preview = (stored_text or "").strip()[:120]
        audio_only = normalized_type == "tts" and stored_text == AUDIO_ONLY_RECORDING_LABEL

        row = ActivityLog(
            user_id=user.id,
            user_email=user.email,
            user_name=_user_display_name(user),
            activity_type=normalized_type,
            file_name=safe_name,
            download_name=f"{safe_name}.{fmt}",
            language=language or "",
            validator_name=(validator_name or "").strip()[:128],
            gender="-" if audio_only else (gender or "").strip(),
            speaker="-" if audio_only else (speaker or "").strip(),
            text_preview=preview,
            text_content=stored_text,
            original_text_content=stored_text if normalized_type == "asr" else None,
            transcript_edits="{}",
            edit_regions="[]",
            audio_format=fmt,
            mime_type=mime,
            audio_data=audio_bytes,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        logger.info(
            "Activity log recorded (%s) id=%s user=%s file=%s",
            normalized_type,
            row.id,
            user.email,
            safe_name,
        )
        return row.id
    except Exception:
        logger.exception("Failed to record studio activity log for %s", user.email)
        db.rollback()
        return None
