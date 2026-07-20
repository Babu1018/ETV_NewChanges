# with router without diarisation

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
# Load environment variables for endpoints
# -----------------------------------------------------
load_dotenv()
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
API_AUTH_KEY = os.getenv("API_AUTH_KEY")

# -----------------------------------------------------
# Logger
# -----------------------------------------------------
logger = logging.getLogger("HindiASR")

router = APIRouter(prefix="/hindi", tags=["Hindi ASR"])

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
    return {"status": "ok", "message": "SarvamAI STT API is healthy"}


# -----------------------------------------------------
# MAIN TRANSCRIPTION ROUTE WITH LOGS
# -----------------------------------------------------
@router.post("/transcribe", dependencies=[Depends(verify_api_key)])
async def hindi_transcription_api(
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
            language_code="hi-IN",
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
                    language="Hindi",
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


# Hindi_asr_api.py with routers with diarisation option

# import os
# import uuid
# import json
# import time
# import shutil
# import logging
# import natsort
# from typing import List
# from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
# from fastapi.responses import JSONResponse
# from pydub import AudioSegment
# from dotenv import load_dotenv
# from sarvamai import SarvamAI
# from datetime import datetime

# # -----------------------------------------------------
# # Load environment variables
# # -----------------------------------------------------
# load_dotenv()
# SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
# API_AUTH_KEY = os.getenv("API_AUTH_KEY")

# # -----------------------------------------------------
# # Logger
# # -----------------------------------------------------
# logger = logging.getLogger("HindiASR")
# logger.setLevel(logging.DEBUG)  # Set to DEBUG to see detailed logs

# router = APIRouter(prefix="/hindi", tags=["Hindi ASR"])

# # -----------------------------------------------------
# # Verify API Key
# # -----------------------------------------------------
# def verify_api_key(request: Request):
#     client_key = request.headers.get("x-api-key")
#     if client_key != API_AUTH_KEY:
#         logger.warning(f"Unauthorized access from {request.client.host}")
#         raise HTTPException(status_code=401, detail="Invalid API Key")

# # -----------------------------------------------------
# # SarvamAI Client (global)
# # -----------------------------------------------------
# client = SarvamAI(api_subscription_key=SARVAM_API_KEY)

# # -----------------------------------------------------
# # AUDIO SPLITTER
# # -----------------------------------------------------
# def split_audio(input_file: str, chunk_length_ms: int, output_dir: str) -> List[str]:
#     logger.info(
#         f"Splitting audio: {input_file} into chunks of {chunk_length_ms / 1000}s each"
#     )

#     os.makedirs(output_dir, exist_ok=True)

#     audio = AudioSegment.from_file(input_file)
#     duration_ms = len(audio)
#     logger.info(f"Audio duration: {duration_ms / 1000:.2f}s")

#     chunk_paths = []
#     start = 0
#     idx = 1

#     while start < duration_ms:
#         end = min(start + chunk_length_ms, duration_ms)
#         chunk = audio[start:end]

#         chunk_path = os.path.join(output_dir, f"chunk_{idx}.wav")
#         chunk.export(chunk_path, format="wav")

#         chunk_paths.append(chunk_path)

#         logger.info(
#             f"Created chunk {idx} | Start: {start/1000:.2f}s | End: {end/1000:.2f}s"
#         )

#         start = end
#         idx += 1

#     logger.info(f"Total chunks created: {len(chunk_paths)}")
#     return chunk_paths


# # -----------------------------------------------------
# # Health Check
# # -----------------------------------------------------
# @router.get("/health")
# def health_check():
#     return {"status": "ok", "message": "SarvamAI STT API is healthy"}


# # -----------------------------------------------------
# # Debug Endpoint - Inspect Sarvam Output
# # -----------------------------------------------------
# @router.post("/debug-output", dependencies=[Depends(verify_api_key)])
# async def debug_sarvam_output(request: Request, file: UploadFile = File(...)):
#     """
#     Debug endpoint that processes a file and returns the raw Sarvam API output
#     without cleanup for inspection
#     """
#     req_id = uuid.uuid4().hex
#     base_dir = f"./temp/debug_{req_id}"
#     input_dir = os.path.join(base_dir, "input")
#     output_dir = os.path.join(base_dir, "output")
#     base_dir_created = False
   
#     try:
#         os.makedirs(input_dir, exist_ok=True)
#         os.makedirs(output_dir, exist_ok=True)
#         base_dir_created = True
        
#         # Save file
#         ext = file.filename.split(".")[-1].lower()
#         input_path = os.path.join(input_dir, f"input.{ext}")
        
#         with open(input_path, "wb") as f:
#             f.write(await file.read())
        
#         # Process with Sarvam
#         job = client.speech_to_text_job.create_job(
#             language_code="hi-IN",
#             model="saarika:v2.5",
#             with_timestamps=True,
#             with_diarization=True
#         )
        
#         job.upload_files(file_paths=[input_path])
#         job.start()
#         job.wait_until_complete()
        
#         if job.is_failed():
#             return JSONResponse({"error": "Job failed"}, status_code=500)
        
#         job.download_outputs(output_dir=output_dir)
        
#         # Read and return all JSON outputs
#         json_files = [f for f in os.listdir(output_dir) if f.endswith('.json')]
#         outputs = {}
        
#         for jf in json_files:
#             with open(os.path.join(output_dir, jf), 'r', encoding='utf-8') as f:
#                 outputs[jf] = json.load(f)
        
#         return JSONResponse({
#             "status": "success",
#             "debug_directory": base_dir,
#             "files_found": json_files,
#             "raw_outputs": outputs
#         })
   
#     except Exception as e:
#         logger.error(f"Debug error: {e}", exc_info=True)
#         return JSONResponse({"error": str(e)}, status_code=500)
#     finally:
#         if base_dir_created and os.path.exists(base_dir):
#             shutil.rmtree(base_dir, ignore_errors=True)
#             logger.info(f"Cleaned debug temp directory: {base_dir}")


# # -----------------------------------------------------
# # MAIN TRANSCRIPTION ROUTE WITH LOGS
# # -----------------------------------------------------
# @router.post("/transcribe", dependencies=[Depends(verify_api_key)])
# async def hindi_transcription_api(request: Request, file: UploadFile = File(...)):

#     start_timestamp = datetime.utcnow().isoformat()
#     start_time = time.time()
#     client_ip = request.client.host
#     filename = file.filename

#     logger.info(
#         f"[START REQUEST] {start_timestamp} | From: {client_ip} | File: {filename}"
#     )

#     base_dir = None
#     try:
#         # -------------------------
#         # Temp directory setup
#         # -------------------------
#         req_id = uuid.uuid4().hex
#         base_dir = f"./temp/{req_id}"
        

#         input_dir = os.path.join(base_dir, "input")
#         chunk_dir = os.path.join(base_dir, "chunks")
#         output_dir = os.path.join(base_dir, "output")
        
#         os.makedirs(input_dir, exist_ok=True)
#         os.makedirs(chunk_dir, exist_ok=True)
#         os.makedirs(output_dir, exist_ok=True)
        
#         logger.info(f"Created temp directory: {base_dir}")

#         # -------------------------
#         # Save uploaded file
#         # -------------------------
#         ext = filename.split(".")[-1].lower()
#         if ext not in ["mp3", "wav", "mp4"]:
#             logger.error("Unsupported file format")
#             raise HTTPException(status_code=400, detail="File must be mp3/wav/mp4")

#         input_path = os.path.join(input_dir, f"input.{ext}")

#         with open(input_path, "wb") as f:
#             f.write(await file.read())

#         logger.info(f"Saved uploaded file → {input_path}")

#         # -------------------------
#         # Determine chunk size
#         # -------------------------
#         audio = AudioSegment.from_file(input_path)
#         duration_min = len(audio) / (1000 * 60)

#         logger.info(f"Audio duration: {duration_min:.2f} minutes")

#         # 5-min chunks if <1hr, 15-min if >=1hr
#         chunk_ms = 300_000 if duration_min < 60 else 900_000
#         logger.info(f"Chunk size selected: {chunk_ms/1000:.0f} seconds")

#         # -------------------------
#         # Split audio
#         # -------------------------
#         chunk_paths = split_audio(input_path, chunk_ms, chunk_dir)

#         # Compute chunk start times (in seconds)
#         chunk_start_times = {}
#         current_offset = 0.0
#         for chunk_path in chunk_paths:
#             chunk_audio = AudioSegment.from_file(chunk_path)
#             chunk_duration_sec = len(chunk_audio) / 1000.0
#             chunk_idx = os.path.basename(chunk_path).split('_')[1].split('.')[0]
#             json_name = f"chunk_{chunk_idx}.json"
#             chunk_start_times[json_name] = current_offset
#             current_offset += chunk_duration_sec

#         logger.info(f"Chunk start times: {chunk_start_times}")

#         # -------------------------
#         # Process with SarvamAI
#         # -------------------------
#         logger.info("Creating SarvamAI STT Job")
        
#         job = client.speech_to_text_job.create_job(
#             language_code="hi-IN",
#             model="saarika:v2.5",
#             with_timestamps=True,
#             with_diarization=True
#         )
        
#         logger.info("Uploading chunks to SarvamAI job")
#         job.upload_files(file_paths=chunk_paths)
        
#         logger.info("Starting SarvamAI job…")
#         job.start()
        
#         logger.info("Waiting for SarvamAI job to finish…")
#         job.wait_until_complete()
        
#         if job.is_failed():
#             logger.error("SarvamAI STT job failed")
#             raise HTTPException(status_code=500, detail="STT job failed")
        
#         # -------------------------
#         # Download output files
#         # -------------------------
#         logger.info("Downloading SarvamAI job output files…")
#         job.download_outputs(output_dir=output_dir)
        
#         # -------------------------
#         # Read and process JSON outputs
#         # -------------------------
#         json_files = [f for f in os.listdir(output_dir) if f.endswith('.json')]
#         logger.info(f"Found {len(json_files)} JSON files")
        
#         combined_text = ""
#         all_diarization = []
        
#         for jf in natsort.natsorted(json_files):
#             json_path = os.path.join(output_dir, jf)
#             logger.info(f"Reading JSON file: {json_path}")
            
#             try:
#                 with open(json_path, 'r', encoding='utf-8') as f:
#                     data = json.load(f)
                    
#                 logger.info(f"JSON keys in {jf}: {list(data.keys())}")
                
#                 # Get regular transcript
#                 transcript = data.get("transcript", "")
#                 if transcript and transcript.strip():
#                     combined_text += transcript.strip() + "\n\n"
                
#                 # Get diarized_transcript
#                 diarized_transcript = data.get("diarized_transcript", {})
#                 if isinstance(diarized_transcript, dict):
#                     entries = diarized_transcript.get("entries", [])
#                     if entries:
#                         logger.info(f"Found {len(entries)} diarized entries in {jf}")
#                         offset = chunk_start_times.get(jf, 0.0)
#                         logger.info(f"Applying offset {offset}s to {jf}")
#                         for entry in entries:
#                             if isinstance(entry, dict):
#                                 entry["start_time_seconds"] = entry.get("start_time_seconds", 0.0) + offset
#                                 entry["end_time_seconds"] = entry.get("end_time_seconds", 0.0) + offset
#                         all_diarization.extend(entries)
#                 elif isinstance(diarized_transcript, list):
#                     if diarized_transcript:
#                         logger.info(f"Found {len(diarized_transcript)} diarized entries in {jf}")
#                         offset = chunk_start_times.get(jf, 0.0)
#                         logger.info(f"Applying offset {offset}s to {jf}")
#                         for entry in diarized_transcript:
#                             if isinstance(entry, dict):
#                                 entry["start_time_seconds"] = entry.get("start_time_seconds", 0.0) + offset
#                                 entry["end_time_seconds"] = entry.get("end_time_seconds", 0.0) + offset
#                         all_diarization.extend(diarized_transcript)
#                 else:
#                     logger.warning(f"No 'diarized_transcript' found in {jf}")
                
#             except Exception as e:
#                 logger.error(f"Error reading JSON {jf}: {e}", exc_info=True)
        
#         # -------------------------
#         # Process diarization data (matching Sarvam's exact structure)
#         # -------------------------
#         speakers_data = []
#         if all_diarization:
#             for entry in all_diarization:
#                 if isinstance(entry, dict):
#                     speaker_data = {
#                         "speaker_id": entry.get("speaker_id", "unknown"),
#                         "start_time_seconds": entry.get("start_time_seconds", 0.0),
#                         "end_time_seconds": entry.get("end_time_seconds", 0.0),
#                         "transcript": entry.get("transcript", "")
#                     }
#                     speakers_data.append(speaker_data)
            
#             # -------------------------
#             # Combine consecutive segments from the same speaker
#             # -------------------------
#             # Note: Speaker IDs reset per chunk (e.g., SPEAKER_00 in each), so combining only works within chunks.
#             # For global speaker tracking across chunks, advanced voice embedding comparison would be needed.
#             if speakers_data:
#                 combined_speakers = []
#                 current_segment = speakers_data[0].copy()
                
#                 for i in range(1, len(speakers_data)):
#                     next_segment = speakers_data[i]
                    
#                     # If same speaker, combine the segments
#                     if next_segment["speaker_id"] == current_segment["speaker_id"]:
#                         # Extend end time and append transcript
#                         current_segment["end_time_seconds"] = next_segment["end_time_seconds"]
#                         current_segment["transcript"] += " " + next_segment["transcript"]
#                     else:
#                         # Different speaker, save current and start new
#                         combined_speakers.append(current_segment)
#                         current_segment = next_segment.copy()
                
#                 # Add the last segment
#                 combined_speakers.append(current_segment)
                
#                 speakers_data = combined_speakers
#                 logger.info(f"Combined into {len(speakers_data)} speaker segments")
#         else:
#             logger.warning("No diarization data found in any JSON file")
        
#         # -------------------------
#         # Calculate processing time
#         # -------------------------
#         processing_time = round((time.time() - start_time) / 60, 2)
#         end_stamp = datetime.utcnow().isoformat()
        
#         logger.info(
#             f"[END REQUEST] {end_stamp} | File: {filename} | "
#             f"Processing Time: {processing_time} mins | Client: {client_ip}"
#         )
        
#         # -------------------------
#         # Build response
#         # -------------------------
#         response_data = {
#             "status": "success",
#             "file_name": filename,
#             "processing_time_mins": processing_time,
#             "transcription": combined_text.strip(),
#             "diarized_transcript": {
#                 "entries": speakers_data
#             }
#         }
        
#         logger.info(f"Response includes {len(speakers_data)} diarized segments")
        
#         return JSONResponse(response_data)
#     except Exception as e:
#         logger.error(f"FATAL ERROR: {e}")
#         return JSONResponse(
#             {"detail": f"Transcription failed: {str(e)}"},
#             status_code=500
#         )
#     finally:
#         if base_dir and os.path.exists(base_dir):
#             shutil.rmtree(base_dir, ignore_errors=True)
#             logger.info(f"Cleaned temp directory: {base_dir}")