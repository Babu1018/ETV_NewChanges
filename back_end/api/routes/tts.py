import os

# Windows: HF Hub uses symlinks by default; without Developer Mode this raises WinError 1314.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import uuid
import time
import base64
import re
import shutil
import logging
from datetime import datetime
from io import BytesIO
from typing import List

import torch
import soundfile as sf
from app.ffmpeg_setup import configure_pydub_after_import, ensure_ffmpeg_configured, ffmpeg_available

ensure_ffmpeg_configured()
from pydub import AudioSegment
from pydub.utils import which

configure_pydub_after_import()

from fastapi import APIRouter, UploadFile, File, Form, Request, HTTPException, BackgroundTasks, Security, Depends
from fastapi.responses import FileResponse, Response, JSONResponse
from dotenv import load_dotenv

from app.config import BACKEND_ROOT
from app.auth.deps import get_optional_user
from app.db import get_db
from app.activity_log_service import record_studio_activity_log
from app.deps import api_key_header, sarvam_api_key_header, verify_api_key, get_client_ip
from app.sarvam_client import (
    SARVAM_API_KEY_ENV,
    get_sarvam_client,
    require_sarvam_api_key,
    raise_if_sarvam_auth_error,
)
from app.models.user import User
from sqlalchemy.orm import Session

# ----------------------------
# Load environment variables (before OmniVoice — HF_TOKEN etc.)
# ----------------------------
load_dotenv(BACKEND_ROOT / ".env")


# ============================ OmniVoice (lazy — first /correct-tts only) ============================
_omni_model = None
_omni_last_error = None


def _omnivoice_unavailable_detail(exc: Exception | None = None) -> str:
    msg = str(exc or _omni_last_error or "")
    if "no module named 'omnivoice'" in msg.lower():
        return (
            "Voice clone needs the omnivoice package. In the back_end virtualenv run: "
            "pip install -r requirements.txt then restart the API."
        )
    win_symlink = "1314" in msg or "symlink" in msg.lower() or "privilege" in msg.lower()
    base = (
        "OmniVoice (voice clone) is not loaded. "
        "The first Clone can take several minutes while ~800MB of models download."
    )
    if win_symlink:
        return (
            f"{base} On Windows, symlink creation failed. "
            "Add HF_HUB_DISABLE_SYMLINKS=1 to back_end/.env (or enable Developer Mode in "
            "Settings → System → For developers), delete the partial cache folder "
            "%USERPROFILE%\\.cache\\huggingface\\hub\\models--k2-fsa--OmniVoice, "
            "then restart the backend and try Clone again."
        )
    if msg:
        return f"{base} Error: {msg}"
    return base


def get_omni_model():
    """Load OmniVoice on first successful correction request so /generate-tts stays fast."""
    global _omni_model, _omni_last_error
    log = logging.getLogger("TTS")
    if _omni_model is not None:
        return _omni_model
    try:
        from omnivoice import OmniVoice

        log.info("Loading OmniVoice (first Clone may download large models; please wait)...")
        _omni_model = OmniVoice.from_pretrained(
            "k2-fsa/OmniVoice",
            device_map="cuda" if torch.cuda.is_available() else "cpu",
            dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        )
        _omni_last_error = None
        log.info("OmniVoice loaded successfully (voice cloning ready)")
    except ImportError as e:
        _omni_last_error = (
            f"omnivoice not installed ({e}). "
            "Run in back_end venv: pip install -r requirements.txt"
        )
        _omni_model = None
        log.warning("OmniVoice import failed: %s", e)
    except Exception as e:
        _omni_last_error = str(e)
        _omni_model = None
        log.warning("OmniVoice failed to load: %s. Cloning will be disabled.", e)
    return _omni_model


# ================================================================================
SARVAM_API_KEY = SARVAM_API_KEY_ENV

# ----------------------------
# Logger
# ----------------------------
logger = logging.getLogger("TTS")
logger.setLevel(logging.INFO)


def _log_user_label(user: User | None) -> str:
    if user is None:
        return "—"
    name = f"{user.firstname or ''} {user.lastname or ''}".strip()
    if name and user.email:
        return f"{name} ({user.email})"
    return name or user.email or "—"


router = APIRouter(prefix="/tts", tags=["TTS"])

if not SARVAM_API_KEY:
    logger.warning(
        "SARVAM_API_KEY is not set — users must enter a Sarvam key in the UI, "
        "or add SARVAM_API_KEY to back_end/.env and restart the API."
    )

# ----------------------------
# Language & Voice Mapping
# ----------------------------
LANGUAGE_MAP = {
    "Hindi": "hi-IN",
    "Telugu": "te-IN",
    "English": "en-IN"
}

VOICE_MAP = {
    "Male": {"A": "shubh", "B": "ratan", "C": "mani"},
    "Female": {"D": "priya", "E": "ishita", "F": "ritu", "G": "suhani"}
}

SUPPORTED_AUDIO_FORMATS = {"wav", "mp3"}
AUDIO_MEDIA_TYPES = {"wav": "audio/wav", "mp3": "audio/mpeg"}


def normalize_audio_format(fmt: str) -> str:
    normalized = (fmt or "wav").lower().strip().lstrip(".")
    if normalized not in SUPPORTED_AUDIO_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format '{fmt}'. Use wav or mp3.",
        )
    return normalized


def audio_response(content: bytes, audio_format: str, filename: str):
    from fastapi.responses import Response

    fmt = normalize_audio_format(audio_format)
    return Response(
        content=content,
        media_type=AUDIO_MEDIA_TYPES[fmt],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# =========================================================
# TEXT NORMALIZATION LAYER
# =========================================================
def spell_out(text: str) -> str:
    return " ".join(list(text))

def normalize_urls(text: str) -> str:
    pattern = r"\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b"
    def convert(match):
        url = match.group()
        parts = url.split(".")
        parts = [spell_out(p) for p in parts]
        return " dot ".join(parts)
    return re.sub(pattern, convert, text)

def normalize_emails(text: str) -> str:
    pattern = r"\b[\w\.-]+@[\w\.-]+\.\w+\b"
    def convert(match):
        email = match.group()
        name, domain = email.split("@")
        domain_parts = domain.split(".")
        return (
            spell_out(name)
            + " at "
            + " dot ".join([spell_out(p) for p in domain_parts])
        )
    return re.sub(pattern, convert, text)

def normalize_phone_numbers(text: str) -> str:
    pattern = r"\b\d{10}\b"
    def convert(match):
        return " ".join(list(match.group()))
    return re.sub(pattern, convert, text)

def normalize_text(text: str) -> str:
    text = normalize_emails(text)
    text = normalize_urls(text)
    text = normalize_phone_numbers(text)
    return text

# ----------------------------
# Text Splitter
# ----------------------------
def split_text(text: str, max_len: int = 180) -> List[str]:
    """Split script into Sarvam-sized chunks; never emit empty segments."""
    if not text or not text.strip():
        return []

    # Sentence boundaries: Latin punctuation, newlines, Hindi danda (।)
    sentences = re.split(r"(?<=[।.!?])\s*|\n+", text)
    chunks: List[str] = []
    current = ""

    def flush_current() -> None:
        nonlocal current
        part = current.strip()
        if part:
            chunks.append(part)
        current = ""

    def append_long_segment(segment: str) -> None:
        nonlocal current
        segment = segment.strip()
        if not segment:
            return
        if len(segment) <= max_len:
            if len(current) + len(segment) + 2 <= max_len:
                current = f"{current}{segment}. " if current else f"{segment}. "
            else:
                flush_current()
                current = f"{segment}. "
            return
        flush_current()
        for i in range(0, len(segment), max_len):
            piece = segment[i : i + max_len].strip()
            if piece:
                chunks.append(piece)

    for raw in sentences:
        append_long_segment(raw)

    flush_current()
    return [c for c in chunks if c.strip()]

# ----------------------------
# TTS Processor (Original Bulbul v3)
# ----------------------------
def process_text_to_speech(
    text: str,
    language: str,
    speaker: str,
    audio_format: str,
    output_dir: str,
    sarvam_client,
) -> str:
    logger.info("Splitting text into chunks...")
    text = normalize_text(text)
    chunks = split_text(text)
    if not chunks:
        raise HTTPException(
            status_code=400,
            detail="No speakable text found. Enter script content or upload a non-empty .txt file.",
        )
    chunk_files = []
    for idx, chunk in enumerate(chunks, 1):
        if not chunk.strip():
            continue
        logger.info(f"Generating TTS for chunk {idx}/{len(chunks)}")
        res = sarvam_client.text_to_speech.convert(
            text=chunk,
            target_language_code=language,
            speaker=speaker,
            output_audio_codec=audio_format,
            speech_sample_rate=22050,
            enable_preprocessing=True,
            model="bulbul:v3",
            pace=1.2,
            temperature=0.5
        )
        audio_bytes = base64.b64decode(res.audios[0])
        chunk_path = os.path.join(output_dir, f"chunk_{idx}.{audio_format}")
        with open(chunk_path, "wb") as f:
            f.write(audio_bytes)
        logger.info(f"Saved chunk {idx} at: {chunk_path}")
        chunk_files.append(chunk_path)

    if not chunk_files:
        raise HTTPException(
            status_code=400,
            detail="No audio could be generated from the script. Check your text and try again.",
        )

    logger.info("Combining chunks into final audio...")
    combined = AudioSegment.empty()
    for f in chunk_files:
        combined += AudioSegment.from_file(f, format=audio_format)
        os.remove(f)

    final_path = os.path.join(output_dir, f"final.{audio_format}")
    combined.export(final_path, format=audio_format)
    logger.info(f"Final TTS audio saved at: {final_path}")
    return final_path

# ----------------------------
# Helper: Extract clean reference for cloning
# ----------------------------
def extract_ref_audio(original_path: str, ref_duration_ms: int = 8000) -> str:
    audio = AudioSegment.from_file(original_path)
    if len(audio) > ref_duration_ms + 2000:
        ref = audio[1000 : 1000 + ref_duration_ms]
    else:
        ref = audio[:ref_duration_ms]
    ref_path = original_path.replace(".wav", "_ref.wav")
    ref.export(ref_path, format="wav")
    return ref_path


def decode_text_file(raw: bytes) -> str:
    """Decode uploaded script bytes (UTF-8 / UTF-16 BOM / common Windows encodings)."""
    if not raw:
        return ""
    if len(raw) >= 2 and raw[:2] == b"\xff\xfe":
        return raw.decode("utf-16-le")
    if len(raw) >= 2 and raw[:2] == b"\xfe\xff":
        return raw.decode("utf-16-be")
    if len(raw) >= 3 and raw[:3] == b"\xef\xbb\xbf":
        return raw.decode("utf-8-sig")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return raw.decode("cp1252")
        except UnicodeDecodeError:
            return raw.decode("latin-1")


# ============================ GENERATE TTS ENDPOINT ============================
@router.post("/generate-tts")
async def generate_tts(
    request: Request,
    background_tasks: BackgroundTasks,
    api_key: str = Security(api_key_header),
    sarvam_key: str = Security(sarvam_api_key_header),
    language: str = Form("English"),
    gender: str = Form("Female"),
    speaker: str = Form("D"),
    audio_format: str = Form("wav"),
    sarvam_api_key: str = Form(""),
    file: UploadFile = File(...),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    verify_api_key(request, api_key, log_name="TTS")
    start_timestamp = datetime.utcnow().isoformat()
    start_time = time.time()
    client_ip = get_client_ip(request)
    uid = str(uuid.uuid4())[:8]
    log_user = _log_user_label(current_user)
    logger.info(
        f"[START REQUEST] {start_timestamp} | From: {client_ip} | User: {log_user} | UID: {uid}"
    )

    base_dir = os.path.join(str(BACKEND_ROOT), "temp_tts", uid)
    os.makedirs(base_dir, exist_ok=True)
    logger.info(f"Created temp directory: {base_dir}")

    try:
        if not file:
            raise HTTPException(status_code=400, detail="Upload file required")
        raw_content = await file.read()
        text_content = decode_text_file(raw_content)
        if not text_content.strip():
            raise HTTPException(status_code=400, detail="Empty file")

        logger.info(f"Read text from uploaded script file")

        lang_code = LANGUAGE_MAP.get(language.title(), "en-IN")
        if gender.title() not in VOICE_MAP or speaker.upper() not in VOICE_MAP[gender.title()]:
            raise HTTPException(status_code=400, detail="Invalid speaker")
        actual_speaker = VOICE_MAP[gender.title()][speaker.upper()]
        fmt = normalize_audio_format(audio_format)

        logger.info(f"Selected language: {language.title()} | Code: {lang_code} | Speaker: {actual_speaker}")

        resolved_sarvam_key = require_sarvam_api_key(
            request, header_key=sarvam_key, form_key=sarvam_api_key
        )
        sarvam_client = get_sarvam_client(resolved_sarvam_key)

        final_audio = process_text_to_speech(
            text=text_content,
            language=lang_code,
            speaker=actual_speaker,
            audio_format=fmt,
            output_dir=base_dir,
            sarvam_client=sarvam_client,
        )

        with open(final_audio, "rb") as f:
            content = f.read()

        activity_log_id = None
        if current_user is not None and content:
            script_name = (file.filename or "tts_script").rsplit(".", 1)[0]
            activity_log_id = record_studio_activity_log(
                db,
                current_user,
                activity_type="tts",
                text_content=text_content,
                language=language.title(),
                audio_bytes=content,
                audio_format=fmt,
                file_name=script_name,
                gender=gender,
                speaker=speaker,
            )

        processing_time = round((time.time() - start_time) / 60, 2)
        end_stamp = datetime.utcnow().isoformat()
        logger.info(
            f"[END REQUEST] {end_stamp} | User: {log_user} | UID: {uid} | "
            f"Processing Time: {processing_time} mins | Client: {client_ip}"
        )

        shutil.rmtree(base_dir, ignore_errors=True)
        response = audio_response(content, fmt, os.path.basename(final_audio))
        if activity_log_id:
            response.headers["X-Activity-Log-Id"] = str(activity_log_id)
            response.headers["Access-Control-Expose-Headers"] = "X-Activity-Log-Id"
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ERROR: {e}")
        try:
            raise_if_sarvam_auth_error(e)
        except HTTPException:
            raise
        msg = str(e)
        if (
            "insufficient_quota_error" in msg
            or "No credits available" in msg
            or "status_code: 429" in msg
        ):
            raise HTTPException(
                status_code=429,
                detail=(
                    "Sarvam TTS quota exhausted. Add credits or switch API key in the "
                    "Sarvam dashboard — see https://dashboard.sarvam.ai (or your plan page)."
                ),
            )
        if "text' cannot be empty" in msg or "cannot be empty" in msg.lower():
            raise HTTPException(
                status_code=400,
                detail="Script text is empty or could not be split for TTS. Add text in the script box or upload a .txt file.",
            )
        if "status_code: 400" in msg:
            raise HTTPException(
                status_code=400,
                detail="Sarvam rejected the request. Check that your script has readable text and try again.",
            )
        raise HTTPException(status_code=500, detail=msg)

# ============================ CONVERT AUDIO FORMAT ============================
@router.post("/convert-audio")
async def convert_audio(
    request: Request,
    api_key: str = Security(api_key_header),
    file: UploadFile = File(...),
    audio_format: str = Form("mp3"),
    source_format: str = Form("wav"),
):
    """Convert uploaded audio to wav or mp3 (requires ffmpeg for mp3 export)."""
    verify_api_key(request, api_key, log_name="TTS")
    target = normalize_audio_format(audio_format)
    source = normalize_audio_format(source_format)

    try:
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty audio file")

        segment = AudioSegment.from_file(BytesIO(raw), format=source)
        out = BytesIO()
        segment.export(out, format=target)
        filename = f"converted.{target}"
        return audio_response(out.getvalue(), target, filename)
    except HTTPException:
        raise
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail=(
                "MP3 conversion needs ffmpeg. Run: pip install imageio-ffmpeg "
                "then restart the backend."
            ),
        )
    except Exception as e:
        logger.error(f"Convert audio error: {e}")
        err = str(e)
        if "WinError 2" in err or "ffmpeg" in err.lower() or "avconv" in err.lower():
            raise HTTPException(
                status_code=503,
                detail=(
                    "MP3 conversion needs ffmpeg. Run: pip install imageio-ffmpeg "
                    "then restart the backend."
                ),
            )
        raise HTTPException(status_code=500, detail=err)


# ============================ VALIDATOR CORRECTION ENDPOINT ============================
@router.post("/correct-tts")
async def correct_tts(
    request: Request,
    background_tasks: BackgroundTasks,
    api_key: str = Security(api_key_header),
    sarvam_key: str = Security(sarvam_api_key_header),
    original_audio: UploadFile = File(...),
    correction_audio: UploadFile = File(...),
    mistake_start_sec: float = Form(...),
    mistake_end_sec: float = Form(...),
    language: str = Form("English"),
    sarvam_api_key: str = Form(""),
):
    verify_api_key(request, api_key, log_name="TTS")
    start_time = time.time()
    client_ip = get_client_ip(request)
    uid = str(uuid.uuid4())[:8]
    logger.info(f"Validator request from {client_ip} | UID: {uid} | Mistake: {mistake_start_sec}-{mistake_end_sec}s")

    base_dir = os.path.join(str(BACKEND_ROOT), "temp_tts", uid)
    os.makedirs(base_dir, exist_ok=True)

    try:
        # Save files
        original_path = os.path.join(base_dir, "original_bulbul.wav")
        correction_path = os.path.join(base_dir, "validator_correction.wav")

        with open(original_path, "wb") as f:
            f.write(await original_audio.read())
        with open(correction_path, "wb") as f:
            f.write(await correction_audio.read())

        resolved_sarvam_key = require_sarvam_api_key(
            request, header_key=sarvam_key, form_key=sarvam_api_key
        )
        sarvam_client = get_sarvam_client(resolved_sarvam_key)

        # 1. Transcribe validator correction (Saaras v3)
        with open(correction_path, "rb") as f:
            asr_response = sarvam_client.speech_to_text.transcribe(
                file=f,
                model="saaras:v3",
                mode="transcribe"
            )
        corrected_text = asr_response.transcript.strip()
        logger.info(f"Transcribed correction: '{corrected_text}'")

        if not corrected_text:
            raise HTTPException(status_code=400, detail="Could not transcribe correction audio")

        # 2. Extract reference from original
        ref_path = extract_ref_audio(original_path)

        # 3. Clone with OmniVoice (same Bulbul v3 voice)
        omni_model = get_omni_model()
        if omni_model is None:
            raise HTTPException(
                status_code=503,
                detail=_omnivoice_unavailable_detail(),
            )

        logger.info("Generating correction in Bulbul v3 voice (first run may download large HF models)...")
        gen_audio = omni_model.generate(text=corrected_text, ref_audio=ref_path)

        corrected_gen_path = os.path.join(base_dir, "corrected_cloned.wav")
        sf.write(corrected_gen_path, gen_audio[0], 24000)

        # 4. Splice with crossfade
        original_seg = AudioSegment.from_file(original_path)
        correction_seg = AudioSegment.from_file(corrected_gen_path).set_frame_rate(22050)

        start_ms = int(mistake_start_sec * 1000)
        end_ms = int(mistake_end_sec * 1000)

        before = original_seg[:start_ms]
        after = original_seg[end_ms:]

        cross_ms = 50
        if len(before) > cross_ms:
            before = before.fade_out(cross_ms)
        if len(correction_seg) > cross_ms:
            correction_seg = correction_seg.fade_in(cross_ms)

        final_seg = before + correction_seg + after

        final_path = os.path.join(base_dir, "final_corrected.wav")
        final_seg.export(final_path, format="wav")

        logger.info(f"âœ… Correction complete in {time.time() - start_time:.2f}s")

        with open(final_path, "rb") as f:
            content = f.read()
        shutil.rmtree(base_dir, ignore_errors=True)
        from fastapi.responses import Response
        return Response(content=content, media_type="audio/wav", headers={"Content-Disposition": "attachment; filename=corrected_tts.wav"})

    except HTTPException:
        raise
    except FileNotFoundError as e:
        logger.error(f"Validator error: {e}")
        raise HTTPException(
            status_code=503,
            detail=(
                "Audio processing needs ffmpeg/ffprobe. Run: pip install imageio-ffmpeg "
                "then restart the backend."
            ),
        )
    except Exception as e:
        logger.error(f"Validator error: {e}")
        try:
            raise_if_sarvam_auth_error(e)
        except HTTPException:
            raise
        err = str(e)
        if "WinError 2" in err or "ffprobe" in err.lower() or "ffmpeg" in err.lower():
            raise HTTPException(
                status_code=503,
                detail=(
                    "Audio processing needs ffmpeg/ffprobe. Run: pip install imageio-ffmpeg "
                    "then restart the backend."
                ),
            )
        raise HTTPException(status_code=500, detail=err)


@router.post("/delete-clip")
async def delete_clip(
    request: Request,
    api_key: str = Security(api_key_header),
    original_audio: UploadFile = File(...),
    delete_start_sec: float = Form(...),
    delete_end_sec: float = Form(...),
    language: str = Form("English"),
    include_deleted_clip: bool = Form(False),
):
    """Remove [delete_start_sec, delete_end_sec] from original_audio; return trimmed WAV."""
    verify_api_key(request, api_key)
    start_time = time.time()
    client_ip = get_client_ip(request)
    uid = str(uuid.uuid4())[:8]
    logger.info(
        "[DELETE-CLIP START] from=%s | uid=%s | language=%s | region=%.3fs-%.3fs",
        client_ip, uid, language, delete_start_sec, delete_end_sec,
    )

    base_dir = os.path.join(str(BACKEND_ROOT), "temp_tts", uid)
    os.makedirs(base_dir, exist_ok=True)

    try:
        raw = await original_audio.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty audio file")

        orig_ext = (original_audio.filename or "audio.wav").rsplit(".", 1)[-1].lower()
        if orig_ext not in ("wav", "mp3", "m4a", "flac", "ogg"):
            orig_ext = "wav"

        orig_path = os.path.join(base_dir, f"original.{orig_ext}")
        with open(orig_path, "wb") as f:
            f.write(raw)

        audio = AudioSegment.from_file(orig_path, format=orig_ext)
        duration_sec = len(audio) / 1000.0

        if delete_start_sec < 0 or delete_end_sec <= delete_start_sec:
            raise HTTPException(
                status_code=400,
                detail="delete_start_sec must be >= 0 and less than delete_end_sec.",
            )
        if delete_start_sec >= duration_sec:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"delete_start_sec ({delete_start_sec:.3f}s) exceeds audio "
                    f"duration ({duration_sec:.3f}s)."
                ),
            )

        clamped_end = min(delete_end_sec, duration_sec)
        start_ms = int(delete_start_sec * 1000)
        end_ms = int(clamped_end * 1000)

        deleted_clip = audio[start_ms:end_ms]
        trimmed = audio[:start_ms] + audio[end_ms:]

        logs_dir = os.path.join(str(BACKEND_ROOT), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        deleted_clip_path = os.path.join(logs_dir, f"deleted_clip_{uid}.wav")
        updated_audio_path = os.path.join(logs_dir, f"updated_audio_{uid}.wav")
        deleted_clip.export(deleted_clip_path, format="wav")
        trimmed.export(updated_audio_path, format="wav")

        logger.info(
            "[DELETE-CLIP] uid=%s | deleted region=%.3fs-%.3fs (%.3fs) | "
            "original_duration=%.3fs | updated_duration=%.3fs",
            uid,
            delete_start_sec,
            clamped_end,
            clamped_end - delete_start_sec,
            duration_sec,
            len(trimmed) / 1000.0,
        )

        trimmed_path = os.path.join(base_dir, "trimmed.wav")
        trimmed.export(trimmed_path, format="wav")
        with open(trimmed_path, "rb") as f:
            content = f.read()

        deleted_buf = BytesIO()
        deleted_clip.export(deleted_buf, format="wav")
        deleted_bytes = deleted_buf.getvalue()

        shutil.rmtree(base_dir, ignore_errors=True)

        logger.info(
            "[DELETE-CLIP END] uid=%s | language=%s | time=%.2fs",
            uid, language, time.time() - start_time,
        )

        if include_deleted_clip:
            return JSONResponse(
                {
                    "trimmed_audio_base64": base64.b64encode(content).decode("ascii"),
                    "deleted_audio_base64": base64.b64encode(deleted_bytes).decode("ascii"),
                    "media_type": "audio/wav",
                }
            )

        return Response(
            content=content,
            media_type="audio/wav",
            headers={"Content-Disposition": f'attachment; filename="trimmed_{uid}.wav"'},
        )

    except HTTPException:
        shutil.rmtree(base_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(base_dir, ignore_errors=True)
        logger.error("[DELETE-CLIP ERROR] uid=%s | %s", uid, e)
        err = str(e)
        if "WinError 2" in err or "ffprobe" in err.lower() or "ffmpeg" in err.lower():
            raise HTTPException(
                status_code=503,
                detail=(
                    "Audio processing needs ffmpeg/ffprobe. Run: pip install imageio-ffmpeg "
                    "then restart the backend."
                ),
            ) from e
        raise HTTPException(status_code=500, detail=err) from e


# ----------------------------
# Health Check
# ----------------------------
@router.get("/")
def tts_health():
    return {
        "status": "ok",
        "clone_ready": _omni_model is not None,
        "clone_error": _omni_last_error,
        "sarvam_configured": bool((SARVAM_API_KEY or "").strip()),
        "ffmpeg_ready": ffmpeg_available(),
    }
