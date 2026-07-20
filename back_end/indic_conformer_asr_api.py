# # indic_conformer_asr_api.py
# """
# Ground-truth ASR engine — AI4Bharat IndicConformer-600M-Multilingual.

# This is a 4th, standalone ASR engine (alongside English/Hindi/Telugu) that the
# validator picks explicitly. It serves all three app languages (English, Hindi,
# Telugu) and is treated as the GROUND TRUTH transcript: every request also runs
# the production model this app already uses for that language — Distil-Whisper
# for English, Sarvam saaras:v3 for Hindi/Telugu — so the validator can compare
# "ground truth" vs "model output" side by side.

# Model: hybrid CTC + RNNT Conformer, 600M params, MIT licensed.
#   https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual
# Decoding: RNNT only (per product requirement), loaded lazily via
#   transformers.AutoModel.from_pretrained(..., trust_remote_code=True) —
#   same lazy-load-on-first-request pattern as the English Whisper engine, so
#   API startup stays fast and the ~600M weights only download/load when this
#   engine is actually used.

# IMPORTANT CAVEAT: IndicConformer is officially trained on India's 22
# scheduled languages (Hindi, Telugu, etc.) and does NOT officially include
# English. We still route English audio through it (language code "en") since
# the product needs one ground-truth engine across all three app languages —
# but English ground-truth quality is not guaranteed by AI4Bharat. We surface
# this to the validator via `unofficial_language` in the response rather than
# hiding it.
# """
# import os
# import time
# import uuid
# import shutil
# import logging
# import threading
# from typing import List

# from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request, Security
# from fastapi.responses import JSONResponse

# from app.deps import api_key_header, verify_api_key, get_client_ip
# from app.utils.user_messages import sanitize_user_message

# # Reuse the English engine's generic audio utilities (normalize-to-wav + chunker)
# # and its Whisper chunk-transcribe function for the English comparison pass —
# # no changes needed to eng_asr_api.py, these are already module-level helpers.
# from eng_asr_api import (
#     _normalize_to_wav as _eng_normalize_to_wav,
#     split_audio as _eng_split_audio,
#     transcribe_chunk as _whisper_transcribe_chunk,
# )

# logger = logging.getLogger("IndicConformerASR")

# # ---------------------------------------------------------------------------
# # Patch torchaudio.load to use soundfile/librosa instead of torchcodec.
# #
# # torchaudio 2.9+ rewrote torchaudio.load() to call load_with_torchcodec()
# # which requires the separate torchcodec package. We monkey-patch it here so
# # any code path — including the IndicConformer model's own trust_remote_code
# # internals — gets a working implementation without torchcodec.
# # ---------------------------------------------------------------------------
# def _torchaudio_load_via_soundfile(
#     uri,
#     frame_offset: int = 0,
#     num_frames: int = -1,
#     normalize: bool = True,
#     channels_first: bool = True,
#     format=None,
#     buffer_size: int = 4096,
#     backend=None,
# ):
#     """Drop-in replacement for torchaudio.load that uses soundfile + torch."""
#     import torch
#     import soundfile as _sf

#     data, sr = _sf.read(uri, dtype="float32", always_2d=True)
#     # data shape: [frames, channels] → transpose to [channels, frames]
#     import numpy as _np
#     wav = torch.from_numpy(_np.ascontiguousarray(data.T))
#     if not channels_first:
#         wav = wav.T
#     if frame_offset > 0:
#         wav = wav[:, frame_offset:] if channels_first else wav[frame_offset:, :]
#     if num_frames > 0:
#         wav = wav[:, :num_frames] if channels_first else wav[:num_frames, :]
#     return wav, sr


# try:
#     import torchaudio as _torchaudio
#     _torchaudio.load = _torchaudio_load_via_soundfile
#     logger.info(
#         "torchaudio.load patched to use soundfile (torchaudio %s, torchcodec not required)",
#         getattr(_torchaudio, "__version__", "unknown"),
#     )
# except Exception as _patch_err:
#     logger.debug("torchaudio patch skipped: %s", _patch_err)

# router = APIRouter(prefix="/indicconformer", tags=["IndicConformer (Ground Truth)"])

# MODEL_ID = "ai4bharat/indic-conformer-600m-multilingual"
# TARGET_SR = 16000
# DECODING = "rnnt"
# CHUNK_MS = 30_000  # mirrors the English engine's default chunk size

# LANGUAGE_CODE_MAP = {
#     "English": "en",
#     "Hindi": "hi",
#     "Telugu": "te",
# }

# # English is not part of IndicConformer's official IN-22 training set.
# UNOFFICIAL_LANGUAGES = {"English"}

# COMPARISON_MODEL_NAME = {
#     "English": "Distil-Whisper (distil-large-v3)",
#     "Hindi": "Sarvam saaras:v3",
#     "Telugu": "Sarvam saaras:v3",
# }

# SUPPORTED_UPLOAD_FORMATS = ["mp3", "wav", "mp4", "m4a", "flac", "ogg", "webm"]

# # -----------------------------------------------------
# # Lazy model load (first /indicconformer/transcribe request only)
# # -----------------------------------------------------
# _model_lock = threading.Lock()
# _ic_model = None
# _ic_device: str = "cpu"


# def _ensure_indic_conformer_model() -> None:
#     global _ic_model, _ic_device
#     if _ic_model is not None:
#         return
#     with _model_lock:
#         if _ic_model is not None:
#             return
#         import torch
#         from transformers import AutoModel

#         _ic_device = "cuda" if torch.cuda.is_available() else "cpu"
#         logger.info(
#             "Loading IndicConformer-600M-Multilingual (first ground-truth request; "
#             "downloads ~2.4GB on first run)..."
#         )
#         from huggingface_hub import constants

#         # Increase timeout for large model downloads (default is often 60s)
#         hf_timeout = int(os.environ.get("HF_HUB_DOWNLOAD_TIMEOUT", "300"))
#         constants.HF_HUB_DOWNLOAD_TIMEOUT = hf_timeout

#         # Use float16 for CUDA to save VRAM and speed up inference
#         model_kwargs = {
#             "trust_remote_code": True,
#             "resume_download": True,
#             "local_files_only": False,
#         }
#         if _ic_device == "cuda":
#             model_kwargs["torch_dtype"] = torch.float16

#         hf_token = (
#             os.getenv("HF_TOKEN")
#             or os.getenv("HUGGING_FACE_HUB_TOKEN")
#             or os.getenv("HUGGINGFACEHUB_API_TOKEN")
#         )
#         if hf_token:
#             model_kwargs["token"] = hf_token.strip()

#         try:
#             _ic_model = AutoModel.from_pretrained(MODEL_ID, **model_kwargs).to(_ic_device)
#         except OSError as exc:
#             err = str(exc).lower()
#             if "gated" in err or "401" in err:
#                 raise OSError(
#                     "IndicConformer is a gated Hugging Face model. Request access at "
#                     "https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual "
#                     "then set HF_TOKEN in back_end/.env and restart the API."
#                 ) from exc
#             raise
#         logger.info(
#             "IndicConformer ready on %s (dtype=%s, decoding=%s)",
#             _ic_device,
#             "float16" if _ic_device == "cuda" else "float32",
#             DECODING,
#         )


# def _transcribe_chunk_ground_truth(chunk_path: str, lang_code: str) -> str:
#     """Run one audio chunk through IndicConformer with RNNT decoding.

#     Audio loading uses librosa (via soundfile) instead of torchaudio.load()
#     to avoid the torchcodec dependency introduced in torchaudio >= 2.1.
#     The chunks are already normalised 16-bit mono WAV files produced by
#     _eng_normalize_to_wav + _eng_split_audio, so librosa reads them cleanly.
#     """
#     import torch
#     import numpy as np
#     import librosa

#     _ensure_indic_conformer_model()

#     # librosa.load returns a float32 numpy array resampled to TARGET_SR, mono.
#     # This avoids torchaudio.load() which may call torchcodec under the hood.
#     speech_array, _sr = librosa.load(chunk_path, sr=TARGET_SR, mono=True)
#     speech_array = np.ascontiguousarray(speech_array, dtype=np.float32)

#     # IndicConformer expects shape [1, T] — batch dim of 1, sequence of samples.
#     wav = torch.from_numpy(speech_array).unsqueeze(0).to(_ic_device)

#     with torch.no_grad():
#         result = _ic_model(wav, lang_code, DECODING)

#     if isinstance(result, (list, tuple)):
#         result = result[0] if result else ""
#     return str(result or "").strip()


# def _run_whisper_comparison(chunk_paths: List[str]) -> str:
#     """Comparison pass for English — reuses the already-loaded Distil-Whisper model."""
#     texts = []
#     for cp in chunk_paths:
#         try:
#             texts.append(_whisper_transcribe_chunk(cp).strip())
#         except Exception as exc:
#             logger.warning("Whisper comparison chunk failed: %s", exc)
#     return "\n\n".join(t for t in texts if t)


# def _run_sarvam_comparison(chunk_paths: List[str], language: str, output_dir: str) -> str:
#     """Comparison pass for Hindi/Telugu — reuses each language module's lazy Sarvam
#     client and JSON merger; duplicates only the short batch-job orchestration so
#     hin_asr_api.py / tel_asr_api.py stay untouched."""
#     if language == "Hindi":
#         from hin_asr_api import _sarvam_client, merge_json_transcriptions
#         lang_code = "hi-IN"
#     else:
#         from tel_asr_api import _sarvam_client, merge_json_transcriptions
#         lang_code = "te-IN"

#     os.makedirs(output_dir, exist_ok=True)

#     job = _sarvam_client().speech_to_text_job.create_job(
#         model="saaras:v3",
#         mode="transcribe",
#         language_code=lang_code,
#         with_timestamps=True,
#         with_diarization=True,
#     )
#     job.upload_files(file_paths=chunk_paths)
#     job.start()
#     job.wait_until_complete()
#     if job.is_failed():
#         raise HTTPException(status_code=502, detail="Comparison model job failed")

#     job.download_outputs(output_dir=output_dir)
#     final_text_path = merge_json_transcriptions(output_dir)
#     if not final_text_path:
#         return ""
#     with open(final_text_path, "r", encoding="utf-8") as f:
#         return f.read().strip()


# # -----------------------------------------------------
# # Routes
# # -----------------------------------------------------
# @router.get("/ready")
# def indic_conformer_ready():
#     return {"model_loaded": _ic_model is not None, "device": _ic_device, "decoding": DECODING}


# @router.post("/transcribe")
# async def indic_conformer_transcribe(
#     request: Request,
#     api_key: str = Security(api_key_header),
#     file: UploadFile = File(...),
#     language: str = Form(...),
#     compare: bool = Form(True),
# ):
#     """
#     Ground-truth transcription + comparison.

#     Form fields:
#       file      — audio upload (mp3/wav/mp4/m4a/flac/ogg/webm)
#       language  — "English" | "Hindi" | "Telugu"
#       compare   — also run the production model for that language (default True)

#     Returns ground_truth (IndicConformer/RNNT) and model_transcript (the
#     existing engine's output) so the validator can compare them.
#     """
#     verify_api_key(request, api_key)

#     language = (language or "").strip().title()
#     if language not in LANGUAGE_CODE_MAP:
#         raise HTTPException(status_code=400, detail="language must be English, Hindi, or Telugu")

#     lang_code = LANGUAGE_CODE_MAP[language]
#     is_unofficial = language in UNOFFICIAL_LANGUAGES
#     start_time = time.time()
#     client_ip = get_client_ip(request)
#     filename = file.filename or "upload.wav"

#     logger.info(
#         "[GROUND TRUTH START] From: %s | File: %s | Language: %s | Compare: %s",
#         client_ip,
#         filename,
#         language,
#         compare,
#     )

#     req_id = uuid.uuid4().hex
#     base_dir = f"./temp_indicconformer_{req_id}"
#     input_dir = os.path.join(base_dir, "input")
#     chunk_dir = os.path.join(base_dir, "chunks")
#     os.makedirs(input_dir, exist_ok=True)
#     os.makedirs(chunk_dir, exist_ok=True)

#     try:
#         ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "wav"
#         if ext not in SUPPORTED_UPLOAD_FORMATS:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Supported formats: {'/'.join(SUPPORTED_UPLOAD_FORMATS)}",
#             )

#         input_path = os.path.join(input_dir, f"input.{ext}")
#         with open(input_path, "wb") as f:
#             f.write(await file.read())

#         # Normalize once to 16-bit mono WAV and chunk once — both the ground-truth
#         # model and the comparison model run on the exact same chunks.
#         wav_path = os.path.join(input_dir, "input.wav")
#         _eng_normalize_to_wav(input_path, ext, wav_path)
#         chunk_paths = _eng_split_audio(wav_path, CHUNK_MS, chunk_dir)
#         if not chunk_paths:
#             raise HTTPException(status_code=400, detail="Could not read audio for transcription.")

#         # 1) Ground truth — IndicConformer, RNNT decoding
#         gt_texts = []
#         for cp in chunk_paths:
#             try:
#                 gt_texts.append(_transcribe_chunk_ground_truth(cp, lang_code))
#             except Exception as exc:
#                 logger.error("IndicConformer chunk failed (lang=%s): %s", lang_code, exc)
#                 if is_unofficial:
#                     raise HTTPException(
#                         status_code=503,
#                         detail=sanitize_user_message(
#                             "IndicConformer does not officially support English audio "
#                             "(it's trained on India's 22 scheduled languages). The model "
#                             f"rejected this request: {exc}"
#                         ),
#                     )
#                 raise HTTPException(
#                     status_code=500,
#                     detail=sanitize_user_message(f"Ground truth transcription failed: {exc}"),
#                 )

#         ground_truth = "\n\n".join(t for t in gt_texts if t).strip()
#         if not ground_truth:
#             raise HTTPException(
#                 status_code=500, detail="Ground truth transcription produced no output."
#             )

#         # 2) Comparison — the model this app already uses for `language` (best-effort;
#         #    a comparison failure should not hide a successful ground-truth result)
#         model_transcript = ""
#         if compare:
#             try:
#                 if language == "English":
#                     model_transcript = _run_whisper_comparison(chunk_paths)
#                 else:
#                     model_transcript = _run_sarvam_comparison(
#                         chunk_paths, language, os.path.join(base_dir, "sarvam_output")
#                     )
#             except HTTPException as exc:
#                 logger.warning("Comparison model failed: %s", exc.detail)
#             except Exception as exc:
#                 logger.warning("Comparison model failed: %s", exc)

#         processing_time = round((time.time() - start_time) / 60, 2)
#         logger.info(
#             "[GROUND TRUTH END] File: %s | Processing Time: %s mins | Client: %s",
#             filename,
#             processing_time,
#             client_ip,
#         )

#         return JSONResponse(
#             {
#                 "status": "success",
#                 "language": language,
#                 "decoding": DECODING,
#                 "processing_time_mins": processing_time,
#                 "ground_truth": ground_truth,
#                 "ground_truth_model": "IndicConformer-600M-Multilingual",
#                 "model_transcript": model_transcript,
#                 "model_name": COMPARISON_MODEL_NAME.get(language, ""),
#                 "unofficial_language": is_unofficial,
#             }
#         )

#     except HTTPException:
#         raise
#     except Exception as exc:
#         logger.exception("Ground truth transcription failed")
#         return JSONResponse(
#             {"detail": sanitize_user_message(f"Ground truth transcription failed: {exc}")},
#             status_code=500,
#         )
#     finally:
#         shutil.rmtree(base_dir, ignore_errors=True)


# indic_conformer_asr_api.py
"""
Ground-truth ASR engine — AI4Bharat IndicConformer-600M-Multilingual.
 
This is a 4th, standalone ASR engine (alongside English/Hindi/Telugu) that the
validator picks explicitly. It serves all three app languages (English, Hindi,
Telugu) and is treated as the GROUND TRUTH transcript: every request also runs
the production model this app already uses for that language — Distil-Whisper
for English, Sarvam saaras:v3 for Hindi/Telugu — so the validator can compare
"ground truth" vs "model output" side by side.
 
Model: hybrid CTC + RNNT Conformer, 600M params, MIT licensed.
  https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual
Decoding: RNNT only (per product requirement), loaded lazily via
  transformers.AutoModel.from_pretrained(..., trust_remote_code=True) —
  same lazy-load-on-first-request pattern as the English Whisper engine, so
  API startup stays fast and the ~600M weights only download/load when this
  engine is actually used.
 
IMPORTANT CAVEAT: IndicConformer is officially trained on India's 22
scheduled languages (Hindi, Telugu, etc.) and does NOT officially include
English. We still route English audio through it (language code "en") since
the product needs one ground-truth engine across all three app languages —
but English ground-truth quality is not guaranteed by AI4Bharat. We surface
this to the validator via `unofficial_language` in the response rather than
hiding it.
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
 
# Reuse the English engine's generic audio utilities (normalize-to-wav + chunker)
# and its Whisper chunk-transcribe function for the English comparison pass —
# no changes needed to eng_asr_api.py, these are already module-level helpers.
from eng_asr_api import (
    _prepare_wav as _eng_prepare_wav,
    split_audio as _eng_split_audio,
)
 
logger = logging.getLogger("IndicConformerASR")
 
# ---------------------------------------------------------------------------
# Patch torchaudio.load to use soundfile/librosa instead of torchcodec.
#
# torchaudio 2.9+ rewrote torchaudio.load() to call load_with_torchcodec()
# which requires the separate torchcodec package. We monkey-patch it here so
# any code path — including the IndicConformer model's own trust_remote_code
# internals — gets a working implementation without torchcodec.
# ---------------------------------------------------------------------------
def _torchaudio_load_via_soundfile(
    uri,
    frame_offset: int = 0,
    num_frames: int = -1,
    normalize: bool = True,
    channels_first: bool = True,
    format=None,
    buffer_size: int = 4096,
    backend=None,
):
    """Drop-in replacement for torchaudio.load that uses soundfile + torch."""
    import torch
    import soundfile as _sf
 
    data, sr = _sf.read(uri, dtype="float32", always_2d=True)
    # data shape: [frames, channels] → transpose to [channels, frames]
    import numpy as _np
    wav = torch.from_numpy(_np.ascontiguousarray(data.T))
    if not channels_first:
        wav = wav.T
    if frame_offset > 0:
        wav = wav[:, frame_offset:] if channels_first else wav[frame_offset:, :]
    if num_frames > 0:
        wav = wav[:, :num_frames] if channels_first else wav[:num_frames, :]
    return wav, sr
 
 
try:
    import torchaudio as _torchaudio
    _torchaudio.load = _torchaudio_load_via_soundfile
    logger.info(
        "torchaudio.load patched to use soundfile (torchaudio %s, torchcodec not required)",
        getattr(_torchaudio, "__version__", "unknown"),
    )
except Exception as _patch_err:
    logger.debug("torchaudio patch skipped: %s", _patch_err)
 
router = APIRouter(prefix="/indicconformer", tags=["IndicConformer (Ground Truth)"])
 
MODEL_ID = "ai4bharat/indic-conformer-600m-multilingual"
TARGET_SR = 16000
DECODING = "rnnt"
CHUNK_MS = 30_000  # mirrors the English engine's default chunk size
 
LANGUAGE_CODE_MAP = {
    "Hindi": "hi",
    "Telugu": "te",
}

COMPARISON_MODEL_NAME = {
    "Hindi": "Sarvam saaras:v3",
    "Telugu": "Sarvam saaras:v3",
}
 
SUPPORTED_UPLOAD_FORMATS = ["mp3", "wav", "mp4", "m4a", "flac", "ogg", "webm"]
 
# -----------------------------------------------------
# Lazy model load (first /indicconformer/transcribe request only)
# -----------------------------------------------------
_model_lock = threading.Lock()
_ic_model = None
_ic_device: str = "cpu"
 
 
def _ensure_indic_conformer_model() -> None:
    global _ic_model, _ic_device
    if _ic_model is not None:
        return
    with _model_lock:
        if _ic_model is not None:
            return
        import torch
        from transformers import AutoModel
 
        _ic_device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(
            "Loading IndicConformer-600M-Multilingual (first ground-truth request; "
            "downloads ~2.4GB on first run)..."
        )
        from huggingface_hub import constants
 
        # Increase timeout for large model downloads (default is often 60s)
        hf_timeout = int(os.environ.get("HF_HUB_DOWNLOAD_TIMEOUT", "300"))
        constants.HF_HUB_DOWNLOAD_TIMEOUT = hf_timeout
 
        # Use float16 for CUDA to save VRAM and speed up inference
        model_kwargs = {
            "trust_remote_code": True,
            "local_files_only": False,
        }
        if _ic_device == "cuda":
            model_kwargs["torch_dtype"] = torch.float16
 
        hf_token = (
            os.getenv("HF_TOKEN")
            or os.getenv("HUGGING_FACE_HUB_TOKEN")
            or os.getenv("HUGGINGFACEHUB_API_TOKEN")
        )
        if hf_token:
            model_kwargs["token"] = hf_token.strip()
 
        try:
            _ic_model = AutoModel.from_pretrained(MODEL_ID, **model_kwargs).to(_ic_device)
        except OSError as exc:
            err = str(exc).lower()
            if "gated" in err or "401" in err:
                raise OSError(
                    "IndicConformer is a gated Hugging Face model. Request access at "
                    "https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual "
                    "then set HF_TOKEN in back_end/.env and restart the API."
                ) from exc
            raise
        logger.info(
            "IndicConformer ready on %s (dtype=%s, decoding=%s)",
            _ic_device,
            "float16" if _ic_device == "cuda" else "float32",
            DECODING,
        )
 
 
def _transcribe_chunk_ground_truth(chunk_path: str, lang_code: str) -> str:
    """Run one audio chunk through IndicConformer with RNNT decoding.
 
    Audio loading uses librosa (via soundfile) instead of torchaudio.load()
    to avoid the torchcodec dependency introduced in torchaudio >= 2.1.
    The chunks are already normalised 16-bit mono WAV files produced by
    _eng_normalize_to_wav + _eng_split_audio, so librosa reads them cleanly.
    """
    import torch
    import numpy as np
    import librosa
 
    _ensure_indic_conformer_model()
 
    # librosa.load returns a float32 numpy array resampled to TARGET_SR, mono.
    # This avoids torchaudio.load() which may call torchcodec under the hood.
    speech_array, _sr = librosa.load(chunk_path, sr=TARGET_SR, mono=True)
    speech_array = np.ascontiguousarray(speech_array, dtype=np.float32)
 
    # IndicConformer expects shape [1, T] — batch dim of 1, sequence of samples.
    wav = torch.from_numpy(speech_array).unsqueeze(0).to(_ic_device)
 
    with torch.no_grad():
        result = _ic_model(wav, lang_code, DECODING)
 
    if isinstance(result, (list, tuple)):
        result = result[0] if result else ""
    return str(result or "").strip()
 
 
def _run_sarvam_comparison(chunk_paths: List[str], language: str, output_dir: str) -> str:
    """Comparison pass for Hindi/Telugu — reuses each language module's lazy Sarvam
    client and JSON merger; duplicates only the short batch-job orchestration so
    hin_asr_api.py / tel_asr_api.py stay untouched."""
    if language == "Hindi":
        from hin_asr_api import _sarvam_client, merge_json_transcriptions
        lang_code = "hi-IN"
    else:
        from tel_asr_api import _sarvam_client, merge_json_transcriptions
        lang_code = "te-IN"
 
    os.makedirs(output_dir, exist_ok=True)
 
    job = _sarvam_client().speech_to_text_job.create_job(
        model="saaras:v3",
        mode="transcribe",
        language_code=lang_code,
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
def indic_conformer_ready():
    return {"model_loaded": _ic_model is not None, "device": _ic_device, "decoding": DECODING}
 
 
@router.post("/transcribe")
async def indic_conformer_transcribe(
    request: Request,
    api_key: str = Security(api_key_header),
    file: UploadFile = File(...),
    language: str = Form(...),
    compare: bool = Form(True),
):
    """
    Ground-truth transcription + comparison.
 
    Form fields:
      file      — audio upload (mp3/wav/mp4/m4a/flac/ogg/webm)
      language  — "English" | "Hindi" | "Telugu"
      compare   — also run the production model for that language (default True)
 
    Returns ground_truth (IndicConformer/RNNT) and model_transcript (the
    existing engine's output) so the validator can compare them.
    """
    verify_api_key(request, api_key)
 
    language = (language or "").strip().title()
    if language not in ("Hindi", "Telugu"):
        raise HTTPException(
            status_code=400,
            detail="IndicConformer supports only Hindi and Telugu."
        )
 
    lang_code = LANGUAGE_CODE_MAP[language]
    start_time = time.time()
    client_ip = get_client_ip(request)
    filename = file.filename or "upload.wav"
 
    logger.info(
        "[GROUND TRUTH START] From: %s | File: %s | Language: %s | Compare: %s",
        client_ip,
        filename,
        language,
        compare,
    )
 
    req_id = uuid.uuid4().hex
    base_dir = f"./temp_indicconformer_{req_id}"
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
 
        # Normalize once to 16-bit mono WAV and chunk once — both the ground-truth
        # model and the comparison model run on the exact same chunks.
        wav_path = os.path.join(input_dir, "input.wav")
        work_path = _eng_prepare_wav(input_path, ext, wav_path)
        chunk_paths = _eng_split_audio(work_path, CHUNK_MS, chunk_dir)
        if not chunk_paths:
            raise HTTPException(status_code=400, detail="Could not read audio for transcription.")
 
        # 1) Ground truth — IndicConformer, RNNT decoding
        gt_texts = []
        for cp in chunk_paths:
            try:
                gt_texts.append(_transcribe_chunk_ground_truth(cp, lang_code))
            except Exception as exc:
                logger.error("IndicConformer chunk failed (lang=%s): %s", lang_code, exc)
                raise HTTPException(
                    status_code=500,
                    detail=sanitize_user_message(f"Ground truth transcription failed: {exc}"),
                )
 
        ground_truth = "\n\n".join(t for t in gt_texts if t).strip()
        if not ground_truth:
            raise HTTPException(
                status_code=500, detail="Ground truth transcription produced no output."
            )
 
        # 2) Comparison — the model this app already uses for `language` (best-effort;
        #    a comparison failure should not hide a successful ground-truth result)
        model_transcript = ""
        if compare:
            try:
                model_transcript = _run_sarvam_comparison(
                    chunk_paths, language, os.path.join(base_dir, "sarvam_output")
                )
            except HTTPException as exc:
                logger.warning("Comparison model failed: %s", exc.detail)
            except Exception as exc:
                logger.warning("Comparison model failed: %s", exc)
 
        processing_time = round((time.time() - start_time) / 60, 2)
        logger.info(
            "[GROUND TRUTH END] File: %s | Processing Time: %s mins | Client: %s",
            filename,
            processing_time,
            client_ip,
        )
 
        return JSONResponse(
            {
                "status": "success",
                "language": language,
                "decoding": DECODING,
                "processing_time_mins": processing_time,
                "ground_truth": ground_truth,
                "ground_truth_model": "IndicConformer-600M-Multilingual",
                "model_transcript": model_transcript,
                "model_name": COMPARISON_MODEL_NAME.get(language, ""),
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
 
 