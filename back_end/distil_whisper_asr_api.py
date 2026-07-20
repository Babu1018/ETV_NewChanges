# whisper_turbo_asr_api.py
"""
Ground-truth ASR engine — Distil-Whisper (distil-large-v3) for English.

This is a standalone ASR engine for English that is treated as the GROUND TRUTH
transcript to compare against the production model.

Ground truth model : distil-whisper/distil-large-v3
Decoding: Whisper model generation, loaded lazily.

NOTE: `eng_asr_api.py` now routes English through SarvamAI (saaras:v3) and no
longer hosts a local Distil-Whisper model, so the ground-truth model is
self-contained in this file (only generic audio helpers — wav normalization
and chunking — are still imported from eng_asr_api.py).
"""
import os
import time
import uuid
import shutil
import logging
import threading
from typing import List

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request, Security
from fastapi.responses import JSONResponse

from app.deps import api_key_header, verify_api_key, get_client_ip
from app.utils.user_messages import sanitize_user_message

from eng_asr_api import (
    _prepare_wav as _eng_normalize_to_wav,
    split_audio as _eng_split_audio,
    _sarvam_client,
    merge_json_transcriptions,
)

logger = logging.getLogger("WhisperTurboASR")

router = APIRouter(prefix="/distil-whisper", tags=["Distil-Whisper (Ground Truth)"])

GROUND_TRUTH_MODEL_ID = "distil-whisper/distil-large-v3"
TARGET_SR = 16000
CHUNK_MS = 30_000

SUPPORTED_UPLOAD_FORMATS = ["mp3", "wav", "mp4", "m4a", "flac", "ogg", "webm"]

# -----------------------------------------------------
# Lazy model load — Distil-Whisper (GROUND TRUTH)
# -----------------------------------------------------
_model_lock = threading.Lock()
_gt_processor = None
_gt_model = None
_gt_device: str = "cpu"
_gt_model_dtype = None


def _ensure_whisper_turbo_model() -> None:
    """Lazily loads the Distil-Whisper ground-truth model.

    NOTE: kept as `_ensure_whisper_turbo_model` (name unchanged) for backward
    compatibility with callers that import it under that name (e.g.
    asr_transcribe.py) — it loads Distil-Whisper.
    """
    global _gt_processor, _gt_model, _gt_device, _gt_model_dtype
    if _gt_processor is not None and _gt_model is not None:
        return
    with _model_lock:
        if _gt_processor is not None and _gt_model is not None:
            return
        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

        _gt_device = "cuda" if torch.cuda.is_available() else "cpu"
        _gt_model_dtype = torch.float16 if _gt_device == "cuda" else torch.float32
        logger.info("Loading Distil-Whisper ground-truth model (first English ground-truth request)...")

        from huggingface_hub import constants
        # Increase timeout for large model downloads
        hf_timeout = int(os.environ.get("HF_HUB_DOWNLOAD_TIMEOUT", "300"))
        constants.HF_HUB_DOWNLOAD_TIMEOUT = hf_timeout

        model_kwargs = {
            "local_files_only": False,
            "torch_dtype": _gt_model_dtype,
        }

        hf_token = (
            os.getenv("HF_TOKEN")
            or os.getenv("HUGGING_FACE_HUB_TOKEN")
            or os.getenv("HUGGINGFACEHUB_API_TOKEN")
        )
        if hf_token:
            model_kwargs["token"] = hf_token.strip()

        _gt_processor = AutoProcessor.from_pretrained(GROUND_TRUTH_MODEL_ID)
        _gt_model = AutoModelForSpeechSeq2Seq.from_pretrained(
            GROUND_TRUTH_MODEL_ID,
            **model_kwargs
        ).to(_gt_device)

        logger.info(
            "Distil-Whisper ground-truth model ready on %s (dtype=%s)",
            _gt_device,
            _gt_model_dtype,
        )


def _transcribe_chunk_ground_truth(chunk_path: str) -> str:
    """Run one audio chunk through Distil-Whisper (ground truth).

    Audio loading uses librosa (via soundfile) instead of torchaudio.load()
    to avoid the torchcodec dependency introduced in torchaudio >= 2.1.

    NOTE: kept as `_transcribe_chunk_ground_truth` (name unchanged) for
    backward compatibility with callers that import it from this module.
    """
    import gc
    import torch
    import numpy as np
    import librosa

    _ensure_whisper_turbo_model()

    # librosa.load returns a float32 numpy array resampled to TARGET_SR, mono.
    speech_array, _sr = librosa.load(chunk_path, sr=TARGET_SR, mono=True)
    speech_array = np.ascontiguousarray(speech_array, dtype=np.float32)

    inputs = _gt_processor(
        speech_array,
        sampling_rate=TARGET_SR,
        return_tensors="pt",
    )

    input_features = inputs.input_features.to(device=_gt_device, dtype=_gt_model_dtype)

    with torch.no_grad():
        generated_ids = _gt_model.generate(input_features, max_new_tokens=128)

    text = _gt_processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

    del inputs, input_features, generated_ids
    if _gt_device == "cuda":
        torch.cuda.empty_cache()
    gc.collect()

    return text.strip()


def _run_sarvam_comparison(chunk_paths: List[str], output_dir: str) -> str:
    """Comparison pass for English — reuses English module's lazy Sarvam client."""
    os.makedirs(output_dir, exist_ok=True)

    job = _sarvam_client().speech_to_text_job.create_job(
        model="saaras:v3",
        mode="transcribe",
        language_code="en-IN",
        with_timestamps=True,
        with_diarization=True,
    )
    job.upload_files(file_paths=chunk_paths)
    job.start()
    job.wait_until_complete()
    if job.is_failed():
        raise HTTPException(status_code=502, detail="Comparison model job failed")

    job.download_outputs(output_dir=output_dir)
    final_text_path = merge_json_transcriptions(output_dir)
    if not final_text_path:
        return ""
    with open(final_text_path, "r", encoding="utf-8") as f:
        return f.read().strip()


# -----------------------------------------------------
# Routes
# -----------------------------------------------------
@router.get("/ready")
def whisper_turbo_ready():
    return {
        "model_loaded": _gt_model is not None,
        "device": _gt_device,
        "model_id": GROUND_TRUTH_MODEL_ID,
    }


@router.post("/transcribe")
async def whisper_turbo_transcribe(
    request: Request,
    api_key: str = Security(api_key_header),
    file: UploadFile = File(...),
    language: str = Form(...),
    compare: bool = Form(True),
):
    """
    Ground-truth transcription for English (Distil-Whisper).
 
    Form fields:
      file      — audio upload (mp3/wav/mp4/m4a/flac/ogg/webm)
      language  — Must be "English"
      compare   — also run the production model for that language (default True)
    """
    verify_api_key(request, api_key)

    language = (language or "").strip().title()
    if language != "English":
        raise HTTPException(status_code=400, detail="Distil-Whisper ground truth only supports language English")

    start_time = time.time()
    client_ip = get_client_ip(request)
    filename = file.filename or "upload.wav"

    logger.info(
        "[ENGLISH GROUND TRUTH START] From: %s | File: %s | Language: %s",
        client_ip,
        filename,
        language,
    )

    req_id = uuid.uuid4().hex
    base_dir = f"./temp_whisperturbo_{req_id}"
    input_dir = os.path.join(base_dir, "input")
    chunk_dir = os.path.join(base_dir, "chunks")
    os.makedirs(input_dir, exist_ok=True)
    os.makedirs(chunk_dir, exist_ok=True)

    try:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "wav"
        if ext not in SUPPORTED_UPLOAD_FORMATS:
            raise HTTPException(
                status_code=400,
                detail=f"Supported formats: {'/'.join(SUPPORTED_UPLOAD_FORMATS)}",
            )

        input_path = os.path.join(input_dir, f"input.{ext}")
        with open(input_path, "wb") as f:
            f.write(await file.read())

        # Normalize to WAV and split
        wav_path = os.path.join(input_dir, "input.wav")
        work_path = _eng_normalize_to_wav(input_path, ext, wav_path)
        chunk_paths = _eng_split_audio(work_path, CHUNK_MS, chunk_dir)
        if not chunk_paths:
            raise HTTPException(status_code=400, detail="Could not read audio for transcription.")

        # Ground truth — Distil-Whisper
        gt_texts = []
        for cp in chunk_paths:
            try:
                gt_texts.append(_transcribe_chunk_ground_truth(cp))
            except Exception as exc:
                logger.error("Distil-Whisper ground truth chunk failed: %s", exc)
                raise HTTPException(
                    status_code=500,
                    detail=sanitize_user_message(f"Ground truth transcription failed: {exc}"),
                )

        ground_truth = " ".join(t for t in gt_texts if t).strip()
        if not ground_truth:
            raise HTTPException(
                status_code=500, detail="Ground truth transcription produced no output."
            )

        # 2) Comparison — Sarvam (English)
        model_transcript = ""
        if compare:
            try:
                model_transcript = _run_sarvam_comparison(
                    chunk_paths, os.path.join(base_dir, "sarvam_output")
                )
            except HTTPException as exc:
                logger.warning("Comparison model failed: %s", exc.detail)
            except Exception as exc:
                logger.warning("Comparison model failed: %s", exc)

        processing_time = round((time.time() - start_time) / 60, 2)
        logger.info(
            "[ENGLISH GROUND TRUTH END] File: %s | Processing Time: %s mins | Client: %s",
            filename,
            processing_time,
            client_ip,
        )

        return JSONResponse(
            {
                "status": "success",
                "language": language,
                "processing_time_mins": processing_time,
                "ground_truth": ground_truth,
                "ground_truth_model": "Distil-Whisper (distil-large-v3)",
                "model_transcript": model_transcript,
                "model_name": "Sarvam saaras:v3",
                "unofficial_language": False,
            }
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Ground truth transcription failed")
        return JSONResponse(
            {"detail": sanitize_user_message(f"Ground truth transcription failed: {exc}")},
            status_code=500,
        )
    finally:
        shutil.rmtree(base_dir, ignore_errors=True)