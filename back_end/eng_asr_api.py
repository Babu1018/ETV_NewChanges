# #with routers without diarization/eng_asr_api.py 

import os
import uuid
import json
import time
import shutil
import logging
import natsort
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydub import AudioSegment
from sqlalchemy.orm import Session
from dotenv import load_dotenv
from datetime import datetime

from app.ffmpeg_setup import (
    configure_pydub_after_import,
    convert_file_to_wav,
    ensure_ffmpeg_configured,
    ffmpeg_available,
    ffmpeg_install_hint,
)
from app.auth.deps import get_optional_user
from app.db import get_db
from app.activity_log_service import record_studio_activity_log
from app.models.user import User
from app.utils.user_messages import sanitize_user_message, log_user_label

TARGET_SR = 16000


def _prepare_wav(input_path: str, ext: str, wav_path: str) -> str:
    """Decode upload to WAV so pydub does not need ffprobe (Windows MP3 fix)."""
    if ext == "wav":
        return input_path
    ensure_ffmpeg_configured()
    configure_pydub_after_import()
    if not ffmpeg_available():
        raise HTTPException(status_code=503, detail=ffmpeg_install_hint())
    try:
        convert_file_to_wav(input_path, wav_path, TARGET_SR)
        return wav_path
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503, detail=sanitize_user_message(str(exc))
        ) from exc

# -----------------------------------------------------
# Load environment variables
# -----------------------------------------------------
load_dotenv()
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
API_AUTH_KEY = os.getenv("API_AUTH_KEY")

# -----------------------------------------------------
# Logger
# -----------------------------------------------------
logger = logging.getLogger("EnglishASR")

router = APIRouter(prefix="/english", tags=["English ASR"])

# -----------------------------------------------------
# Verify API Key
# -----------------------------------------------------
def verify_api_key(request: Request):
    client_key = request.headers.get("x-api-key")
    if client_key != API_AUTH_KEY:
        logger.warning(f"Unauthorized access from {request.client.host}")
        raise HTTPException(status_code=401, detail="Invalid API Key")

# -----------------------------------------------------
# SarvamAI Client (lazy — avoids blocking API startup)
# -----------------------------------------------------
_client = None


def _sarvam_client(api_key: str | None = None):
    from app.sarvam_client import get_sarvam_client

    if api_key:
        return get_sarvam_client(api_key)
    global _client
    if _client is None:
        _client = get_sarvam_client(SARVAM_API_KEY)
    return _client

# -----------------------------------------------------
# JSON MERGER
# -----------------------------------------------------
def merge_json_transcriptions(output_dir: str) -> str:
    logger.info(f"Merging JSON transcription files in: {output_dir}")

    json_files = natsort.natsorted(
        [f for f in os.listdir(output_dir) if f.endswith(".json")]
    )
    if not json_files:
        logger.error("No JSON output files found!")
        return None

    combined_text = ""

    for jf in json_files:
        try:
            file_path = os.path.join(output_dir, jf)
            logger.info(f"Reading JSON file: {file_path}")

            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            diarized = data.get("diarized_transcript")
            if diarized and isinstance(diarized, dict):
                entries = diarized.get("entries", [])
                if entries:
                    chunk_text = ""
                    for entry in entries:
                        speaker = entry.get("speaker_id", "?")
                        text = entry.get("transcript", "").strip()
                        start = entry.get("start_time_seconds", "")
                        end = entry.get("end_time_seconds", "")
                        if text:
                            chunk_text += f"[SPEAKER_{speaker}] ({start}s – {end}s): {text}\n"
                    if chunk_text:
                        combined_text += chunk_text.strip() + "\n\n"
                    continue

            text = data.get("transcript", "")
            if text and text.strip():
                combined_text += text.strip() + "\n\n"

        except Exception as e:
            logger.error(f"Error reading JSON {jf}: {e}")

    final_path = os.path.join(output_dir, "final_transcription.txt")

    with open(final_path, "w", encoding="utf-8") as out:
        out.write(combined_text.strip())

    logger.info(f"Final merged transcription saved at: {final_path}")
    return final_path


# -----------------------------------------------------
# AUDIO SPLITTER
# -----------------------------------------------------
def split_audio(input_file: str, chunk_length_ms: int, output_dir: str) -> List[str]:
    logger.info(
        f"Splitting audio: {input_file} into chunks of {chunk_length_ms / 1000}s each"
    )

    os.makedirs(output_dir, exist_ok=True)

    audio = AudioSegment.from_file(input_file)
    duration_ms = len(audio)
    logger.info(f"Audio duration: {duration_ms / 1000:.2f}s")

    chunk_paths = []
    start = 0
    idx = 1

    while start < duration_ms:
        end = min(start + chunk_length_ms, duration_ms)
        chunk = audio[start:end]

        chunk_path = os.path.join(output_dir, f"chunk_{idx}.wav")
        chunk.export(chunk_path, format="wav")

        chunk_paths.append(chunk_path)

        logger.info(
            f"Created chunk {idx} | Start: {start/1000:.2f}s | End: {end/1000:.2f}s"
        )

        start = end
        idx += 1

    logger.info(f"Total chunks created: {len(chunk_paths)}")
    return chunk_paths


# -----------------------------------------------------
# Health Check
# -----------------------------------------------------
@router.get("/health")
def health_check():
    return {"status": "ok", "message": "SarvamAI English STT API is healthy"}


# -----------------------------------------------------
# MAIN TRANSCRIPTION ROUTE WITH LOGS
# -----------------------------------------------------
@router.post("/transcribe", dependencies=[Depends(verify_api_key)])
async def english_transcription_api(
    request: Request,
    file: UploadFile = File(...),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):

    start_timestamp = datetime.utcnow().isoformat()
    start_time = time.time()
    client_ip = request.client.host
    filename = file.filename
    log_user = log_user_label(current_user)

    logger.info(
        f"[START REQUEST] {start_timestamp} | From: {client_ip} | User: {log_user}"
    )

    base_dir = None
    try:
        # -------------------------
        # Temp directory setup
        # -------------------------
        req_id = uuid.uuid4().hex
        base_dir = f"./temp/{req_id}"
        input_dir = os.path.join(base_dir, "input")
        chunk_dir = os.path.join(base_dir, "chunks")
        output_dir = os.path.join(base_dir, "output")

        os.makedirs(input_dir, exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)

        logger.info(f"Created temp directory: {base_dir}")

        # -------------------------
        # Save uploaded file
        # -------------------------
        ext = filename.split(".")[-1].lower()
        if ext not in ["mp3", "wav", "mp4"]:
            logger.error("Unsupported file format")
            raise HTTPException(status_code=400, detail="File must be mp3/wav/mp4")

        input_path = os.path.join(input_dir, f"input.{ext}")

        with open(input_path, "wb") as f:
            f.write(await file.read())

        logger.info(f"Saved uploaded file → {input_path}")

        wav_path = os.path.join(input_dir, "input.wav")
        work_path = _prepare_wav(input_path, ext, wav_path)
        if work_path != input_path:
            logger.info(f"Normalized audio → {work_path}")

        # -------------------------
        # Determine chunk size
        # -------------------------
        audio = AudioSegment.from_wav(work_path)
        duration_min = len(audio) / (1000 * 60)

        logger.info(f"Audio duration: {duration_min:.2f} minutes")

        # 5-min chunks if <1hr, 15-min if >=1hr
        chunk_ms = 300_000 if duration_min < 60 else 900_000
        logger.info(f"Chunk size selected: {chunk_ms/1000:.0f} seconds")

        # -------------------------
        # Split audio
        # -------------------------
        chunk_paths = split_audio(work_path, chunk_ms, chunk_dir)

        # -------------------------
        # SarvamAI Job
        # -------------------------
        logger.info("Creating SarvamAI STT Job")

        job = _sarvam_client().speech_to_text_job.create_job(
            language_code="en-IN",
            model="saaras:v3",
            with_timestamps=False,
            with_diarization=False
        )

        logger.info("Uploading chunks to SarvamAI job")
        job.upload_files(file_paths=chunk_paths)

        logger.info("Starting SarvamAI job…")
        job.start()

        logger.info("Waiting for SarvamAI job to finish…")
        job.wait_until_complete()

        if job.is_failed():
            logger.error("SarvamAI STT job failed")
            raise HTTPException(status_code=500, detail="STT job failed")

        # -------------------------
        # Download output files
        # -------------------------
        logger.info("Downloading SarvamAI job output files…")
        job.download_outputs(output_dir=output_dir)

        # -------------------------
        # Merge final text
        # -------------------------
        final_text_path = merge_json_transcriptions(output_dir)

        with open(final_text_path, "r", encoding="utf-8") as f:
            transcription = f.read()

        activity_log_id = None
        if current_user is not None and work_path and os.path.isfile(work_path):
            with open(work_path, "rb") as audio_f:
                audio_bytes = audio_f.read()
            if audio_bytes:
                log_name = (filename or "recording").rsplit(".", 1)[0]
                activity_log_id = record_studio_activity_log(
                    db,
                    current_user,
                    activity_type="asr",
                    text_content=transcription,
                    language="English",
                    audio_bytes=audio_bytes,
                    audio_format="wav",
                    file_name=log_name,
                )

        processing_time = round((time.time() - start_time) / 60, 2)
        end_stamp = datetime.utcnow().isoformat()

        logger.info(
            f"[END REQUEST] {end_stamp} | User: {log_user} | "
            f"Processing Time: {processing_time} mins | Client: {client_ip}"
        )

        return JSONResponse({
            "status": "success",
            "file_name": filename,
            "processing_time_mins": processing_time,
            "transcription": transcription,
            "activity_log_id": str(activity_log_id) if activity_log_id else None,
        })

    except Exception as e:
        logger.error(f"FATAL ERROR: {e}")
        return JSONResponse(
            {"detail": sanitize_user_message(f"Transcription failed: {e}")},
            status_code=500
        )
    finally:
        if base_dir and os.path.exists(base_dir):
            shutil.rmtree(base_dir, ignore_errors=True)
            logger.info(f"Cleaned temp directory: {base_dir}")
