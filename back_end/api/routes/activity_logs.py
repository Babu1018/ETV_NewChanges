import logging
import re
import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.activity_log_link import link_activity_log_to_history
from app.activity_log_service import apply_asr_transcript_edit
from app.auth.deps import get_current_user
from app.db import get_db
from app.models.activity_log import ActivityLog
from app.models.activity_log_edit_audio import ActivityLogEditAudio
from app.models.user import User

router = APIRouter(prefix="/api/activity-logs", tags=["activity"])
logger = logging.getLogger("ASR")

MAX_AUDIO_BYTES = 80 * 1024 * 1024
MAX_TEXT_CHARS = 2_000_000
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


class ActivityLogOut(BaseModel):
    id: str


class EditRegionItem(BaseModel):
    startSec: float
    endSec: float
    spanSec: float | None = None
    status: str = "selected"
    label: str = ""


class EditRegionsBody(BaseModel):
    regions: list[EditRegionItem] = Field(default_factory=list)


class HistoryLinkBody(BaseModel):
    historyId: str


class EditCorrectionAudioOut(BaseModel):
    id: str
    correctionAudioId: str


class TranscriptEditBody(BaseModel):
    editedText: str
    validatorName: str = ""


def _user_display_name(user: User) -> str:
    name = f"{user.firstname or ''} {user.lastname or ''}".strip()
    return name or user.email or "—"


def _parse_edit_regions(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _serialize_edit_regions(regions: list) -> str:
    return json.dumps(regions, ensure_ascii=False)


def _parse_transcript_edits(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _region_times_match(a_start: float, a_end: float, b_start: float, b_end: float) -> bool:
    return round(a_start, 3) == round(b_start, 3) and round(a_end, 3) == round(b_end, 3)


def _attach_correction_to_regions(
    regions: list[dict],
    start_sec: float,
    end_sec: float,
    *,
    correction_audio_id: str,
    correction_file_name: str,
) -> list[dict]:
    updated: list[dict] = []
    matched = False
    for item in regions:
        row = dict(item)
        if _region_times_match(
            float(row.get("startSec", 0)),
            float(row.get("endSec", 0)),
            start_sec,
            end_sec,
        ):
            row["correctionAudioId"] = correction_audio_id
            row["correctionFileName"] = correction_file_name
            matched = True
        updated.append(row)
    if not matched:
        updated.append(
            {
                "startSec": start_sec,
                "endSec": end_sec,
                "spanSec": end_sec - start_sec,
                "status": "selected",
                "label": "",
                "correctionAudioId": correction_audio_id,
                "correctionFileName": correction_file_name,
            }
        )
    return updated


def _sanitize_file_name(name: str) -> str:
    name = (name or "").strip()
    name = re.sub(r"[^\w\-. ]+", "", name)
    name = re.sub(r"\s+", "_", name).strip("._") or "recording"
    return name[:200]


def _normalize_script(script_text: str) -> str:
    stripped = (script_text or "").strip()
    if not stripped:
        return AUDIO_ONLY_RECORDING_LABEL
    if stripped.lower() in {"uploaded audio", "audio-only recording"}:
        return AUDIO_ONLY_RECORDING_LABEL
    return script_text


def _mime_for_format(fmt: str, upload_content_type: str | None) -> str:
    if upload_content_type and upload_content_type.startswith("audio/"):
        return upload_content_type.split(";")[0].strip()
    return MIME_FOR_FORMAT.get(fmt.lower(), "application/octet-stream")


def _get_user_log_row(db: Session, user: User, log_id: UUID) -> ActivityLog | None:
    return (
        db.query(ActivityLog)
        .filter(ActivityLog.id == log_id, ActivityLog.user_id == user.id)
        .first()
    )


@router.post("", response_model=ActivityLogOut)
async def create_activity_log(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    activity_type: str = Form(...),
    text_content: str = Form(...),
    file_name: str = Form(...),
    language: str = Form(...),
    validator_name: str = Form(""),
    gender: str = Form(""),
    speaker: str = Form(""),
    edit_regions: str = Form("[]"),
    linked_history_id: str | None = Form(None),
    audio_format: str = Form(...),
    audio: UploadFile = File(...),
):
    normalized_type = activity_type.strip().lower()
    if normalized_type not in ("asr", "tts"):
        raise HTTPException(status_code=400, detail="activity_type must be asr or tts")
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio file is missing.")
    if len(text_content) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=400, detail="text_content too large")

    safe_name = _sanitize_file_name(file_name)
    fmt = (audio_format or "wav").lower().lstrip(".")
    mime = _mime_for_format(fmt, audio.content_type)
    raw = await audio.read()
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="audio file too large")
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio file")

    stored_text = _normalize_script(text_content) if normalized_type == "tts" else text_content
    preview = (stored_text or "").strip()[:120]
    audio_only = normalized_type == "tts" and stored_text == AUDIO_ONLY_RECORDING_LABEL

    row = ActivityLog(
        user_id=current_user.id,
        user_email=current_user.email,
        user_name=_user_display_name(current_user),
        activity_type=normalized_type,
        file_name=safe_name,
        download_name=f"{safe_name}.{fmt}",
        language=language,
        validator_name=(validator_name or "").strip()[:128],
        gender="-" if audio_only else (gender or "").strip(),
        speaker="-" if audio_only else (speaker or "").strip(),
        text_preview=preview,
        text_content=stored_text,
        original_text_content=stored_text if normalized_type == "asr" else None,
        transcript_edits="{}",
        edit_regions=_serialize_edit_regions(_parse_edit_regions(edit_regions)),
        audio_format=fmt,
        mime_type=mime,
        audio_data=raw,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    logger.info(
        "Activity log created (%s) id=%s user=%s email=%s file=%s",
        normalized_type,
        row.id,
        _user_display_name(current_user),
        current_user.email,
        safe_name,
    )
    return ActivityLogOut(id=str(row.id))


@router.patch("/{log_id}", response_model=ActivityLogOut)
async def update_activity_log(
    log_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    text_content: str = Form(...),
    file_name: str = Form(...),
    language: str = Form(...),
    validator_name: str = Form(""),
    gender: str = Form(""),
    speaker: str = Form(""),
    edit_regions: str = Form("[]"),
    linked_history_id: str | None = Form(None),
    audio_format: str = Form(...),
    audio: UploadFile = File(...),
):
    row = _get_user_log_row(db, current_user, log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Activity log entry not found")
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio file is missing.")
    if len(text_content) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=400, detail="text_content too large")

    safe_name = _sanitize_file_name(file_name)
    fmt = (audio_format or "wav").lower().lstrip(".")
    mime = _mime_for_format(fmt, audio.content_type)
    raw = await audio.read()
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="audio file too large")
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio file")

    stored_text = (
        _normalize_script(text_content) if row.activity_type == "tts" else text_content
    )
    preview = (stored_text or "").strip()[:120]
    audio_only = row.activity_type == "tts" and stored_text == AUDIO_ONLY_RECORDING_LABEL

    row.file_name = safe_name
    row.download_name = f"{safe_name}.{fmt}"
    row.language = language
    row.validator_name = (validator_name or "").strip()[:128]
    row.gender = "-" if audio_only else (gender or "").strip()
    row.speaker = "-" if audio_only else (speaker or "").strip()
    row.text_preview = preview
    row.text_content = stored_text
    if row.activity_type == "asr":
        apply_asr_transcript_edit(
            row,
            stored_text,
            validator_name=(validator_name or "").strip()[:128],
        )
    if edit_regions is not None:
        row.edit_regions = _serialize_edit_regions(_parse_edit_regions(edit_regions))
    if linked_history_id:
        try:
            link_activity_log_to_history(
                db, current_user.id, log_id, UUID(linked_history_id.strip())
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid linked_history_id") from None
    row.audio_format = fmt
    row.mime_type = mime
    row.audio_data = raw
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    logger.debug(
        "Activity log updated (%s) id=%s user=%s email=%s file=%s",
        row.activity_type,
        row.id,
        _user_display_name(current_user),
        current_user.email,
        safe_name,
    )
    return ActivityLogOut(id=str(row.id))


@router.patch("/{log_id}/transcript-edit", response_model=ActivityLogOut)
def update_activity_log_transcript_edit(
    log_id: UUID,
    body: TranscriptEditBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_user_log_row(db, current_user, log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Activity log entry not found")
    if row.activity_type != "asr":
        raise HTTPException(status_code=400, detail="Transcript edits apply to ASR logs only")
    if len(body.editedText) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=400, detail="editedText too large")

    apply_asr_transcript_edit(
        row,
        body.editedText,
        validator_name=body.validatorName,
    )
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    edits = _parse_transcript_edits(row.transcript_edits)
    logger.debug(
        "Activity log transcript edit id=%s user=%s email=%s has_edits=%s",
        row.id,
        _user_display_name(current_user),
        current_user.email,
        edits.get("hasEdits"),
    )
    return ActivityLogOut(id=str(row.id))


@router.patch("/{log_id}/edit-regions", response_model=ActivityLogOut)
def update_activity_log_edit_regions(
    log_id: UUID,
    body: EditRegionsBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_user_log_row(db, current_user, log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Activity log entry not found")
    if row.activity_type != "tts":
        raise HTTPException(status_code=400, detail="Edit regions apply to TTS logs only")

    row.edit_regions = _serialize_edit_regions([item.model_dump() for item in body.regions])
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    logger.debug(
        "Activity log edit regions updated id=%s user=%s email=%s regions=%s",
        row.id,
        _user_display_name(current_user),
        current_user.email,
        len(body.regions),
    )
    return ActivityLogOut(id=str(row.id))


@router.post("/{log_id}/edit-correction-audio", response_model=EditCorrectionAudioOut)
async def upload_activity_log_edit_correction_audio(
    log_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    start_sec: float = Form(...),
    end_sec: float = Form(...),
    file_name: str = Form("correction"),
    audio_format: str = Form("wav"),
    audio: UploadFile = File(...),
):
    row = _get_user_log_row(db, current_user, log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Activity log entry not found")
    if row.activity_type != "tts":
        raise HTTPException(status_code=400, detail="Edit correction audio applies to TTS logs only")
    if end_sec <= start_sec:
        raise HTTPException(status_code=400, detail="Invalid region times")
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio file is missing.")

    safe_name = _sanitize_file_name(file_name)
    fmt = (audio_format or "wav").lower().lstrip(".")
    mime = _mime_for_format(fmt, audio.content_type)
    raw = await audio.read()
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="audio file too large")
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio file")

    existing = (
        db.query(ActivityLogEditAudio)
        .filter(
            ActivityLogEditAudio.activity_log_id == log_id,
            ActivityLogEditAudio.start_sec == start_sec,
            ActivityLogEditAudio.end_sec == end_sec,
        )
        .all()
    )
    for old in existing:
        db.delete(old)

    audio_row = ActivityLogEditAudio(
        activity_log_id=log_id,
        start_sec=start_sec,
        end_sec=end_sec,
        file_name=safe_name,
        download_name=f"{safe_name}.{fmt}",
        audio_format=fmt,
        mime_type=mime,
        audio_data=raw,
    )
    db.add(audio_row)
    db.flush()

    regions = _attach_correction_to_regions(
        _parse_edit_regions(row.edit_regions),
        start_sec,
        end_sec,
        correction_audio_id=str(audio_row.id),
        correction_file_name=safe_name,
    )
    row.edit_regions = _serialize_edit_regions(regions)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(audio_row)

    logger.debug(
        "Activity log edit correction audio stored id=%s log=%s user=%s region=%s-%s",
        audio_row.id,
        row.id,
        current_user.email,
        start_sec,
        end_sec,
    )
    audio_id = str(audio_row.id)
    return EditCorrectionAudioOut(id=audio_id, correctionAudioId=audio_id)


@router.patch("/{log_id}/history-link", response_model=ActivityLogOut)
def link_activity_log_history(
    log_id: UUID,
    body: HistoryLinkBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_user_log_row(db, current_user, log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Activity log entry not found")
    try:
        history_id = UUID(body.historyId)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid historyId") from exc

    link_activity_log_to_history(db, current_user.id, log_id, history_id)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    logger.debug(
        "Activity log linked to history id=%s activity=%s user=%s email=%s history=%s",
        row.id,
        row.activity_type,
        _user_display_name(current_user),
        current_user.email,
        history_id,
    )
    return ActivityLogOut(id=str(row.id))
