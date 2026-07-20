# """
# Unified ASR transcription endpoint.

# POST /asr/transcribe
#   - Routes English → Distil-Whisper, Hindi/Telugu → Sarvam saaras:v3
#   - Simultaneously fires IndicConformer ground-truth in a background thread
#     (best-effort timeout — never blocks the response)
#   - Returns word-level mismatch highlights for the UI

# POST /asr/word-edit, /asr/word-revoke, /asr/save-transcript
#   - Validator edit logging (fire-and-forget from frontend)
# """
# import os
# import time
# import uuid
# import shutil
# import unicodedata
# import logging
# import re
# import json
# from typing import List, Tuple

# import natsort

# from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Security, UploadFile
# from fastapi.responses import JSONResponse
# from sqlalchemy.orm import Session

# from app.deps import api_key_header, sarvam_api_key_header, verify_api_key
# from app.sarvam_client import require_sarvam_api_key, raise_if_sarvam_auth_error
# from app.auth.deps import get_optional_user
# from app.db import get_db
# from app.activity_log_service import record_studio_activity_log
# from app.models.user import User
# from app.utils.user_messages import sanitize_user_message
# from app.config import BACKEND_ROOT

# from eng_asr_api import (
#     _normalize_to_wav as _eng_normalize_to_wav,
#     split_audio as _eng_split_audio,
#     transcribe_chunk as _whisper_transcribe_chunk,
# )
# from hin_asr_api import (
#     _sarvam_client as _hin_sarvam_client,
#     merge_json_transcriptions as _hin_merge_json,
#     split_audio as _hin_split_audio,
# )
# from tel_asr_api import (
#     _sarvam_client as _tel_sarvam_client,
#     merge_json_transcriptions as _tel_merge_json,
#     split_audio as _tel_split_audio,
# )
# from indic_conformer_asr_api import (
#     _transcribe_chunk_ground_truth,
#     _ensure_indic_conformer_model,
# )

# logger = logging.getLogger("ASR.Transcribe")

# router = APIRouter(prefix="/asr", tags=["ASR Unified"])

# SUPPORTED_FORMATS = ["mp3", "wav", "mp4", "m4a", "flac", "ogg", "webm"]

# SARVAM_TRANSCRIPT_LOG = str(BACKEND_ROOT / "logs" / "sarvam_transcripts.txt")
# IC_TRANSCRIPT_LOG = str(BACKEND_ROOT / "logs" / "indic_conformer_transcripts.txt")

# LANGUAGE_CODE_MAP = {
#     "English": "en",
#     "Hindi": "hi",
#     "Telugu": "te",
# }

# SARVAM_LANG_CODE = {
#     "Hindi": "hi-IN",
#     "Telugu": "te-IN",
# }

# CHUNK_MS_ENGLISH = 30_000
# CHUNK_MS_SARVAM = 300_000
# CHUNK_MS_SARVAM_LONG = 900_000
# IC_TIMEOUT_SECS = 600


# def _append_transcript_log(filepath: str, validator: str, filename: str,
#                             language: str, transcript: str) -> None:
#     import datetime
#     os.makedirs(os.path.dirname(filepath), exist_ok=True)
#     ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
#     separator = "=" * 80
#     entry = (
#         f"\n{separator}\n"
#         f"Timestamp : {ts}\n"
#         f"Validator : {validator or 'anonymous'}\n"
#         f"File      : {filename}\n"
#         f"Language  : {language}\n"
#         f"{separator}\n"
#         f"{transcript}\n"
#     )
#     try:
#         with open(filepath, "a", encoding="utf-8") as f:
#             f.write(entry)
#     except Exception as exc:
#         logger.warning("Could not write transcript log %s: %s", filepath, exc)


# def _normalize_token(token: str) -> str:
#     token = unicodedata.normalize("NFC", token.lower())
#     token = re.sub(r"[^\w\u0900-\u097F\u0C00-\u0C7F]", "", token, flags=re.UNICODE)
#     return token


# def _collapse_ws(text: str) -> str:
#     return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text or "")).strip()


# def compare_words(hypothesis: str, reference: str) -> List[dict]:
#     """Align hypothesis against IndicConformer reference; flag mismatches."""
#     hypothesis = _collapse_ws(hypothesis)
#     reference = _collapse_ws(reference)
#     hyp_words = [w for w in hypothesis.split() if w]
#     if not hyp_words:
#         return []
#     if not reference.strip():
#         return [{"word": w, "index": i, "mismatch": False} for i, w in enumerate(hyp_words)]

#     ref_words = [w for w in reference.split() if w]
#     hyp_norm = [_normalize_token(w) for w in hyp_words]
#     ref_norm = [_normalize_token(w) for w in ref_words]

#     try:
#         mismatches = _compare_with_rapidfuzz(hyp_norm, ref_norm)
#     except ImportError:
#         mismatches = _compare_with_difflib(hyp_norm, ref_norm)

#     return [
#         {"word": hyp_words[i], "index": i, "mismatch": mismatches[i]}
#         for i in range(len(hyp_words))
#     ]


# def _compare_with_rapidfuzz(hyp_norm: List[str], ref_norm: List[str]) -> List[bool]:
#     from rapidfuzz import fuzz

#     if not ref_norm:
#         return [True] * len(hyp_norm)

#     mismatches = [True] * len(hyp_norm)
#     ref_pos = 0
#     for i, h in enumerate(hyp_norm):
#         if ref_pos >= len(ref_norm):
#             break
#         best_ratio = 0.0
#         best_j = ref_pos
#         for j in range(ref_pos, min(ref_pos + 5, len(ref_norm))):
#             ratio = fuzz.ratio(h, ref_norm[j]) / 100.0
#             if ratio > best_ratio:
#                 best_ratio = ratio
#                 best_j = j
#         if best_ratio >= 0.85:
#             mismatches[i] = False
#             ref_pos = best_j + 1

#     return mismatches


# def _compare_with_difflib(hyp_norm: List[str], ref_norm: List[str]) -> List[bool]:
#     from difflib import SequenceMatcher

#     mismatches = [True] * len(hyp_norm)
#     if not ref_norm:
#         return mismatches

#     matcher = SequenceMatcher(None, hyp_norm, ref_norm, autojunk=False)
#     for tag, i1, i2, j1, j2 in matcher.get_opcodes():
#         if tag == "equal":
#             for i in range(i1, i2):
#                 mismatches[i] = False
#         elif tag == "replace":
#             from difflib import SequenceMatcher as SM
#             for offset in range(min(i2 - i1, j2 - j1)):
#                 ratio = SM(None, hyp_norm[i1 + offset], ref_norm[j1 + offset]).ratio()
#                 if ratio >= 0.85:
#                     mismatches[i1 + offset] = False
#     return mismatches


# def _run_english_asr(input_path: str, ext: str, base_dir: str) -> Tuple[str, List[dict]]:
#     from pydub import AudioSegment

#     wav_path = os.path.join(base_dir, "eng_input.wav")
#     _eng_normalize_to_wav(input_path, ext, wav_path)
#     chunk_dir = os.path.join(base_dir, "eng_chunks")
#     chunk_paths = _eng_split_audio(wav_path, CHUNK_MS_ENGLISH, chunk_dir)

#     texts = []
#     all_words: List[dict] = []
#     offset = 0.0
#     for cp in chunk_paths:
#         try:
#             text = _whisper_transcribe_chunk(cp).strip()
#         except Exception as exc:
#             logger.warning("[ASR] Whisper chunk failed: %s", exc)
#             text = ""
#         if text:
#             texts.append(text)
#         try:
#             chunk_dur = len(AudioSegment.from_file(cp)) / 1000.0
#         except Exception:
#             chunk_dur = CHUNK_MS_ENGLISH / 1000.0
#         if text:
#             all_words.extend(_distribute_segment_words(text, offset, offset + chunk_dur))
#         offset += chunk_dur

#     for i, w in enumerate(all_words):
#         w["index"] = i
#     return "\n\n".join(t for t in texts if t).strip(), all_words


# def _run_sarvam_asr(
#     input_path: str, language: str, base_dir: str, sarvam_api_key: str
# ) -> Tuple[str, List[dict]]:
#     from pydub import AudioSegment

#     chunk_dir = os.path.join(base_dir, "sarvam_chunks")
#     output_dir = os.path.join(base_dir, "sarvam_output")
#     os.makedirs(output_dir, exist_ok=True)

#     audio = AudioSegment.from_file(input_path)
#     duration_min = len(audio) / (1000 * 60)
#     chunk_ms = CHUNK_MS_SARVAM if duration_min < 60 else CHUNK_MS_SARVAM_LONG

#     if language == "Hindi":
#         chunk_paths = _hin_split_audio(input_path, chunk_ms, chunk_dir)
#         client = _hin_sarvam_client(sarvam_api_key)
#         lang_code = SARVAM_LANG_CODE["Hindi"]
#         merge_fn = _hin_merge_json
#     else:
#         chunk_paths = _tel_split_audio(input_path, chunk_ms, chunk_dir)
#         client = _tel_sarvam_client(sarvam_api_key)
#         lang_code = SARVAM_LANG_CODE["Telugu"]
#         merge_fn = _tel_merge_json

#     try:
#         job = client.speech_to_text_job.create_job(
#             model="saaras:v3",
#             mode="transcribe",
#             language_code=lang_code,
#             with_timestamps=True,
#             with_diarization=True,
#         )
#         job.upload_files(file_paths=chunk_paths)
#         job.start()
#         job.wait_until_complete()
#     except Exception as exc:
#         raise_if_sarvam_auth_error(exc)
#         raise

#     if job.is_failed():
#         raise RuntimeError("Sarvam STT job failed")

#     job.download_outputs(output_dir=output_dir)
#     word_timings = extract_sarvam_word_timestamps(output_dir, chunk_paths)

#     final_text_path = merge_fn(output_dir)
#     raw = ""
#     if final_text_path:
#         with open(final_text_path, "r", encoding="utf-8") as f:
#             raw = f.read().strip()
#     return raw, word_timings


# def _run_indic_conformer(input_path: str, ext: str, language: str, base_dir: str) -> str:
#     lang_code = LANGUAGE_CODE_MAP.get(language, "te")
#     wav_path = os.path.join(base_dir, "ic_input.wav")
#     _eng_normalize_to_wav(input_path, ext, wav_path)
#     chunk_dir = os.path.join(base_dir, "ic_chunks")
#     chunk_paths = _eng_split_audio(wav_path, CHUNK_MS_ENGLISH, chunk_dir)

#     _ensure_indic_conformer_model()
#     texts = []
#     for cp in chunk_paths:
#         try:
#             texts.append(_transcribe_chunk_ground_truth(cp, lang_code).strip())
#         except Exception as exc:
#             logger.warning("[GROUND TRUTH] IC chunk failed (lang=%s): %s", lang_code, exc)

#     return " ".join(t for t in texts if t).strip()


# def _extract_plain_text(transcript: str) -> str:
#     lines = transcript.split("\n")
#     plain_parts = []
#     speaker_re = re.compile(r"^\[SPEAKER_[^\]]+\]\s*\([^)]+\):\s*", re.IGNORECASE)
#     for line in lines:
#         line = line.strip()
#         if not line:
#             continue
#         cleaned = speaker_re.sub("", line).strip()
#         if cleaned:
#             plain_parts.append(cleaned)
#     return " ".join(plain_parts) if plain_parts else transcript.strip()


# def _chunk_start_offsets(chunk_paths: List[str]) -> List[float]:
#     from pydub import AudioSegment

#     offsets: List[float] = []
#     t = 0.0
#     for cp in chunk_paths:
#         offsets.append(t)
#         try:
#             t += len(AudioSegment.from_file(cp)) / 1000.0
#         except Exception:
#             t += CHUNK_MS_SARVAM / 1000.0
#     return offsets


# def _distribute_segment_words(text: str, start: float, end: float) -> List[dict]:
#     parts = [w for w in text.split() if w]
#     if not parts:
#         return []
#     span = max(float(end) - float(start), 0.001)
#     if len(parts) == 1:
#         return [{"word": parts[0], "start_sec": round(start, 3), "end_sec": round(end, 3)}]
#     out: List[dict] = []
#     for i, word in enumerate(parts):
#         w_start = start + (i / len(parts)) * span
#         w_end = start + ((i + 1) / len(parts)) * span
#         out.append({"word": word, "start_sec": round(w_start, 3), "end_sec": round(w_end, 3)})
#     return out


# def _words_from_timestamps_obj(ts: dict, offset: float) -> List[dict]:
#     words_raw = ts.get("words") or ts.get("chunks") or []
#     starts = ts.get("start_time_seconds") or []
#     ends = ts.get("end_time_seconds") or []
#     out: List[dict] = []
#     for i, item in enumerate(words_raw):
#         item = str(item).strip()
#         if not item:
#             continue
#         s = float(starts[i]) + offset if i < len(starts) else offset
#         e = float(ends[i]) + offset if i < len(ends) else s
#         sub = item.split()
#         if len(sub) == 1:
#             out.append({"word": sub[0], "start_sec": round(s, 3), "end_sec": round(e, 3)})
#         else:
#             out.extend(_distribute_segment_words(item, s, e))
#     return out


# def extract_sarvam_word_timestamps(output_dir: str, chunk_paths: List[str]) -> List[dict]:
#     """Build word list with start/end seconds from Sarvam saaras:v3 JSON outputs."""
#     if not os.path.isdir(output_dir):
#         return []

#     offsets = _chunk_start_offsets(chunk_paths)
#     json_files = natsort.natsorted(
#         [f for f in os.listdir(output_dir) if f.endswith(".json")]
#     )
#     all_words: List[dict] = []

#     for idx, jf in enumerate(json_files):
#         offset = offsets[idx] if idx < len(offsets) else 0.0
#         chunk_end = offsets[idx + 1] if idx + 1 < len(offsets) else offset + 30.0
#         try:
#             with open(os.path.join(output_dir, jf), encoding="utf-8") as f:
#                 data = json.load(f)
#         except Exception as exc:
#             logger.warning("[ASR] Could not read Sarvam JSON %s: %s", jf, exc)
#             continue

#         chunk_words: List[dict] = []
#         ts = data.get("timestamps")
#         if isinstance(ts, dict) and ts:
#             chunk_words = _words_from_timestamps_obj(ts, offset)

#         if not chunk_words:
#             diarized = data.get("diarized_transcript") or {}
#             entries = diarized.get("entries", []) if isinstance(diarized, dict) else diarized
#             if isinstance(entries, list):
#                 for entry in entries:
#                     if not isinstance(entry, dict):
#                         continue
#                     text = str(entry.get("transcript", "")).strip()
#                     if not text:
#                         continue
#                     s = float(entry.get("start_time_seconds", 0)) + offset
#                     e = float(entry.get("end_time_seconds", s)) + offset
#                     chunk_words.extend(_distribute_segment_words(text, s, e))

#         if not chunk_words:
#             text = str(data.get("transcript", "")).strip()
#             if text:
#                 chunk_words = _distribute_segment_words(text, offset, chunk_end)

#         all_words.extend(chunk_words)

#     for i, w in enumerate(all_words):
#         w["index"] = i
#     return all_words


# def _merge_words_with_mismatches(timings: List[dict], mismatches: List[bool]) -> List[dict]:
#     words: List[dict] = []
#     for i, t in enumerate(timings):
#         words.append({
#             "word": t["word"],
#             "index": i,
#             "mismatch": bool(mismatches[i]) if i < len(mismatches) else False,
#             "start_sec": t.get("start_sec"),
#             "end_sec": t.get("end_sec"),
#         })
#     return words


# @router.post("/transcribe")
# async def unified_transcribe(
#     request: Request,
#     api_key: str = Security(api_key_header),
#     sarvam_key: str = Security(sarvam_api_key_header),
#     file: UploadFile = File(...),
#     language: str = Form(...),
#     validator_name: str = Form(""),
#     sarvam_api_key: str = Form(""),
#     current_user: User | None = Depends(get_optional_user),
#     db: Session = Depends(get_db),
# ):
#     """
#     Unified transcription: Sarvam/Whisper output with IndicConformer mismatch highlights.
#     """
#     verify_api_key(request, api_key)

#     language = (language or "").strip().title()
#     if language not in LANGUAGE_CODE_MAP:
#         raise HTTPException(status_code=400, detail="language must be English, Hindi, or Telugu")

#     validator = (validator_name or "").strip()
#     filename = file.filename or "upload.wav"
#     file_bytes = await file.read()
#     file_size = len(file_bytes)

#     start_time = time.time()

#     logger.info(
#         "[TRANSCRIBE START] validator=%s | file=%s | language=%s | size=%dB",
#         validator or "anonymous",
#         filename,
#         language,
#         file_size,
#     )

#     req_id = uuid.uuid4().hex
#     base_dir = f"./temp_unified_{req_id}"
#     input_dir = os.path.join(base_dir, "input")
#     os.makedirs(input_dir, exist_ok=True)

#     try:
#         ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "wav"
#         if ext not in SUPPORTED_FORMATS:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Supported formats: {', '.join(SUPPORTED_FORMATS)}",
#             )

#         input_path = os.path.join(input_dir, f"input.{ext}")
#         with open(input_path, "wb") as f:
#             f.write(file_bytes)

#         wav_path = os.path.join(input_dir, "input.wav")
#         _eng_normalize_to_wav(input_path, ext, wav_path)

#         asr_start = time.time()
#         word_timings: List[dict] = []
#         if language == "English":
#             raw_transcript, word_timings = _run_english_asr(input_path, ext, base_dir)
#             model_label = "Whisper"
#         else:
#             resolved_sarvam_key = require_sarvam_api_key(
#                 request, header_key=sarvam_key, form_key=sarvam_api_key
#             )
#             raw_transcript, word_timings = _run_sarvam_asr(
#                 input_path, language, base_dir, resolved_sarvam_key
#             )
#             model_label = "Sarvam"
#         asr_elapsed = time.time() - asr_start

#         if word_timings:
#             plain_transcript = " ".join(t["word"] for t in word_timings)
#         else:
#             plain_transcript = _extract_plain_text(raw_transcript)
#         word_count_asr = len(plain_transcript.split())

#         logger.info(
#             "[ASR OUTPUT] validator=%s | file=%s | language=%s | model=%s | words=%d | time=%.1fs",
#             validator or "anonymous",
#             filename,
#             language,
#             model_label,
#             word_count_asr,
#             asr_elapsed,
#         )

#         _append_transcript_log(
#             SARVAM_TRANSCRIPT_LOG, validator, filename, language, plain_transcript
#         )

#         gt_text = ""
#         gt_status = "not_started"
#         gt_start = time.time()

#         ic_dir = f"./temp_ic_{req_id}"
#         os.makedirs(ic_dir, exist_ok=True)

#         try:
#             gt_text = _run_indic_conformer(input_path, ext, language, ic_dir)
#             gt_status = "ok" if gt_text.strip() else "empty"
#         except Exception as exc:
#             err = str(exc).lower()
#             if "gated" in err or "401" in err or "authenticated" in err:
#                 gt_status = "auth_required"
#             elif "onnxruntime" in err:
#                 gt_status = "missing_onnxruntime"
#             else:
#                 gt_status = "failed"
#             logger.warning(
#                 "[GROUND TRUTH] validator=%s | file=%s | language=%s | status=%s | error=%s",
#                 validator or "anonymous",
#                 filename,
#                 language,
#                 gt_status,
#                 exc,
#             )
#         finally:
#             shutil.rmtree(ic_dir, ignore_errors=True)

#         if gt_status == "empty":
#             logger.warning(
#                 "[GROUND TRUTH] validator=%s | file=%s | language=%s | status=empty",
#                 validator or "anonymous",
#                 filename,
#                 language,
#             )

#         gt_elapsed = time.time() - gt_start
#         gt_word_count = len(gt_text.split()) if gt_text else 0

#         logger.info(
#             "[GROUND TRUTH] validator=%s | file=%s | language=%s | status=%s | words=%d | time=%.1fs",
#             validator or "anonymous",
#             filename,
#             language,
#             gt_status,
#             gt_word_count,
#             gt_elapsed,
#         )

#         if gt_text and gt_status == "ok":
#             _append_transcript_log(
#                 IC_TRANSCRIPT_LOG, validator, filename, language, gt_text
#             )

#         ground_truth_available = bool(gt_text and gt_status == "ok")

#         if word_timings:
#             hyp_words = [t["word"] for t in word_timings]
#             if ground_truth_available:
#                 ref_words = [w for w in _collapse_ws(gt_text).split() if w]
#                 hyp_norm = [_normalize_token(w) for w in hyp_words]
#                 ref_norm = [_normalize_token(w) for w in ref_words]
#                 try:
#                     mismatches = _compare_with_rapidfuzz(hyp_norm, ref_norm)
#                 except ImportError:
#                     mismatches = _compare_with_difflib(hyp_norm, ref_norm)
#                 while len(mismatches) < len(hyp_words):
#                     mismatches.append(False)
#                 words = _merge_words_with_mismatches(word_timings, mismatches)
#             else:
#                 words = [
#                     {
#                         "word": t["word"],
#                         "index": i,
#                         "mismatch": False,
#                         "start_sec": t.get("start_sec"),
#                         "end_sec": t.get("end_sec"),
#                     }
#                     for i, t in enumerate(word_timings)
#                 ]
#         elif ground_truth_available:
#             words = compare_words(plain_transcript, gt_text)
#         else:
#             words = [
#                 {"word": w, "index": i, "mismatch": False}
#                 for i, w in enumerate(plain_transcript.split())
#                 if w
#             ]

#         total_words = len(words)
#         mismatch_count = sum(1 for w in words if w["mismatch"])
#         accuracy = round((total_words - mismatch_count) / total_words, 4) if total_words else 1.0

#         logger.info(
#             "[COMPARISON] validator=%s | file=%s | language=%s | total_words=%d | mismatches=%d | accuracy=%.1f%%",
#             validator or "anonymous",
#             filename,
#             language,
#             total_words,
#             mismatch_count,
#             accuracy * 100,
#         )

#         activity_log_id = None
#         if current_user is not None and os.path.isfile(wav_path):
#             with open(wav_path, "rb") as audio_f:
#                 audio_bytes = audio_f.read()
#             if audio_bytes:
#                 log_name = (filename or "recording").rsplit(".", 1)[0]
#                 activity_log_id = record_studio_activity_log(
#                     db,
#                     current_user,
#                     activity_type="asr",
#                     text_content=plain_transcript,
#                     language=language,
#                     audio_bytes=audio_bytes,
#                     audio_format="wav",
#                     file_name=log_name,
#                 )

#         processing_time = round((time.time() - start_time) / 60, 4)

#         logger.info(
#             "[TRANSCRIBE END] validator=%s | file=%s | language=%s | total_time=%.1fs",
#             validator or "anonymous",
#             filename,
#             language,
#             time.time() - start_time,
#         )

#         return JSONResponse({
#             "transcript": plain_transcript,
#             "words": words,
#             "mismatch_count": mismatch_count,
#             "total_words": total_words,
#             "accuracy": accuracy,
#             "language": language,
#             "processing_time_mins": processing_time,
#             "ground_truth_available": ground_truth_available,
#             "ground_truth_status": gt_status,
#             "ground_truth": gt_text if ground_truth_available else "",
#             "has_word_timestamps": any(
#                 w.get("start_sec") is not None for w in words
#             ),
#             "activity_log_id": str(activity_log_id) if activity_log_id else None,
#         })

#     except HTTPException:
#         raise
#     except Exception as exc:
#         logger.exception(
#             "[TRANSCRIBE ERROR] validator=%s | file=%s | error=%s",
#             validator or "anonymous",
#             filename,
#             exc,
#         )
#         return JSONResponse(
#             {"detail": sanitize_user_message(f"Transcription failed: {exc}")},
#             status_code=500,
#         )
#     finally:
#         shutil.rmtree(base_dir, ignore_errors=True)



# @router.post("/word-delete")
# async def log_word_delete(
#     request: Request,
#     api_key: str = Security(api_key_header),
# ):
#     verify_api_key(request, api_key)

#     try:
#         body = await request.json()
#     except Exception:
#         raise HTTPException(status_code=400, detail="Invalid JSON body")

#     word_index = int(body.get("word_index", -1))
#     deleted_word = str(body.get("deleted_word", ""))
#     display_word = str(body.get("display_word", deleted_word))
#     validator_name = str(body.get("validator_name", ""))
#     file_name = str(body.get("file_name", ""))
#     language = str(body.get("language", ""))

#     logger.info(
#         '[WORD DELETE] validator=%s | file=%s | language=%s | position=%d | deleted="%s" | displayed="%s"',
#         validator_name or "anonymous",
#         file_name,
#         language,
#         word_index,
#         deleted_word,
#         display_word,
#     )

#     return JSONResponse({"status": "ok", "word_index": word_index})


# @router.post("/word-edit")
# async def log_word_edit(
#     request: Request,
#     api_key: str = Security(api_key_header),
# ):
#     verify_api_key(request, api_key)

#     try:
#         body = await request.json()
#     except Exception:
#         raise HTTPException(status_code=400, detail="Invalid JSON body")

#     word_index = int(body.get("word_index", -1))
#     original_word = str(body.get("original_word", ""))
#     corrected_word = str(body.get("corrected_word", ""))
#     validator_name = str(body.get("validator_name", ""))
#     file_name = str(body.get("file_name", ""))
#     language = str(body.get("language", ""))

#     logger.info(
#         '[WORD EDIT] validator=%s | file=%s | language=%s | position=%d | original="%s" | corrected="%s"',
#         validator_name or "anonymous",
#         file_name,
#         language,
#         word_index,
#         original_word,
#         corrected_word,
#     )

#     return JSONResponse({"status": "ok", "word_index": word_index})


# @router.post("/save-transcript")
# async def log_save_transcript(
#     request: Request,
#     api_key: str = Security(api_key_header),
# ):
#     verify_api_key(request, api_key)

#     try:
#         body = await request.json()
#     except Exception:
#         raise HTTPException(status_code=400, detail="Invalid JSON body")

#     validator_name = str(body.get("validator_name", ""))
#     file_name = str(body.get("file_name", ""))
#     language = str(body.get("language", ""))
#     edit_count = int(body.get("edit_count", 0))
#     mismatch_count = int(body.get("mismatch_count", 0))
#     accuracy = float(body.get("accuracy", 1.0))

#     logger.info(
#         "[SAVE] validator=%s | file=%s | language=%s | edits=%d | mismatches=%d | accuracy=%.1f%%",
#         validator_name or "anonymous",
#         file_name,
#         language,
#         edit_count,
#         mismatch_count,
#         accuracy * 100,
#     )

#     return JSONResponse({"status": "ok"})


# @router.post("/word-revoke")
# async def log_word_revoke(
#     request: Request,
#     api_key: str = Security(api_key_header),
# ):
#     verify_api_key(request, api_key)

#     try:
#         body = await request.json()
#     except Exception:
#         raise HTTPException(status_code=400, detail="Invalid JSON body")

#     word_index = int(body.get("word_index", -1))
#     revoked_word = str(body.get("revoked_word", ""))
#     restored_word = str(body.get("restored_word", ""))
#     validator_name = str(body.get("validator_name", ""))
#     file_name = str(body.get("file_name", ""))
#     language = str(body.get("language", ""))

#     if word_index == -1:
#         logger.info(
#             "[REVOKE] validator=%s | file=%s | language=%s | mode=edit-mode | revoked_preview=\"%s\" | restored_preview=\"%s\"",
#             validator_name or "anonymous",
#             file_name,
#             language,
#             revoked_word[:60],
#             restored_word[:60],
#         )
#     else:
#         logger.info(
#             '[REVOKE] validator=%s | file=%s | language=%s | position=%d | revoked="%s" | restored="%s"',
#             validator_name or "anonymous",
#             file_name,
#             language,
#             word_index,
#             revoked_word,
#             restored_word,
#         )

#     return JSONResponse({"status": "ok", "word_index": word_index})

"""
Unified ASR transcription endpoint.
 
POST /asr/transcribe
  - Routes English, Hindi, Telugu → Sarvam saaras:v3
  - Simultaneously fires ground-truth (Distil-Whisper for English, IndicConformer
    for Hindi/Telugu) in a background thread (best-effort timeout — never blocks
    the response)
  - Returns word-level mismatch highlights for the UI
 
POST /asr/word-edit, /asr/word-revoke, /asr/save-transcript
  - Validator edit logging (fire-and-forget from frontend)
"""
import os
import time
import uuid
import shutil
import threading
import unicodedata
import logging
import re
import json
from typing import List, Optional, Tuple
 
import natsort
 
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Security, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
 
from app.deps import api_key_header, sarvam_api_key_header, verify_api_key
from app.sarvam_client import require_sarvam_api_key, raise_if_sarvam_auth_error
from app.auth.deps import get_optional_user
from app.db import get_db
from app.activity_log_service import record_studio_activity_log
from app.models.user import User
from app.utils.user_messages import sanitize_user_message
from app.config import BACKEND_ROOT
 
from eng_asr_api import (
    _prepare_wav as _eng_normalize_to_wav,
    split_audio as _eng_split_audio,
    _sarvam_client as _eng_sarvam_client,
    merge_json_transcriptions as _eng_merge_json,
)
from hin_asr_api import (
    _sarvam_client as _hin_sarvam_client,
    merge_json_transcriptions as _hin_merge_json,
    split_audio as _hin_split_audio,
)
from tel_asr_api import (
    _sarvam_client as _tel_sarvam_client,
    merge_json_transcriptions as _tel_merge_json,
    split_audio as _tel_split_audio,
)
from indic_conformer_asr_api import (
    _transcribe_chunk_ground_truth,
    _ensure_indic_conformer_model,
)
from distil_whisper_asr_api import (
    _transcribe_chunk_ground_truth as _turbo_transcribe_chunk,
    _ensure_whisper_turbo_model,
)
 
logger = logging.getLogger("ASR.Transcribe")
 
router = APIRouter(prefix="/asr", tags=["ASR Unified"])
 
SUPPORTED_FORMATS = ["mp3", "wav", "mp4", "m4a", "flac", "ogg", "webm"]
 
SARVAM_TRANSCRIPT_LOG = str(BACKEND_ROOT / "logs" / "sarvam_transcripts.txt")
IC_TRANSCRIPT_LOG = str(BACKEND_ROOT / "logs" / "indic_conformer_transcripts.txt")
TURBO_TRANSCRIPT_LOG = str(BACKEND_ROOT / "logs" / "whisper_turbo_transcripts.txt")
 
LANGUAGE_CODE_MAP = {
    "English": "en",
    "Hindi": "hi",
    "Telugu": "te",
}
 
SARVAM_LANG_CODE = {
    "English": "en-IN",
    "Hindi": "hi-IN",
    "Telugu": "te-IN",
}
 
CHUNK_MS_ENGLISH = 30_000
CHUNK_MS_SARVAM = 300_000
CHUNK_MS_SARVAM_LONG = 900_000
IC_TIMEOUT_SECS = 600

# How long an idle editing session is kept around before it's purged.
# Expiry is checked lazily (on create/get), not via a background thread.
SESSION_TTL_SECONDS = 30 * 60


class _SessionStore:
    """In-memory store that holds the authoritative transcript state for an
    active editing session, keyed by activity_log_id.

    Single source of truth: only `words` (each with word/start_sec/end_sec/
    mismatch) is stored. There is no separately-stored `transcript` string —
    it's always derived with `_rebuild_transcript(words)`, and mismatch
    count/accuracy are always derived with `_compute_stats(words)`. This
    means the transcript, word list, and accuracy can never drift out of
    sync with each other.

    /asr/transcribe creates a session here. /asr/word-edit, /asr/word-delete
    and /asr/word-revoke all read and mutate `words` in place, so the
    frontend never has to resend the transcript. /asr/save-transcript closes
    the session once the final transcript has been persisted.

    Thread safety: `self.lock` (an RLock) guards every read/mutate below,
    which is sufficient for a single-process, multi-threaded/async worker.
    It does NOT share state across multiple OS processes/workers (e.g.
    `uvicorn --workers 4` or multiple pods) — a request that lands on a
    different worker than the one holding the session will get a 404. If
    you run more than one worker, swap `_sessions` for Redis or a DB table
    behind this same interface.
    """

    def __init__(self):
        self._sessions: dict = {}
        self.lock = threading.RLock()

    def _purge_expired_locked(self) -> None:
        cutoff = time.time() - SESSION_TTL_SECONDS
        expired = [sid for sid, s in self._sessions.items() if s["last_updated"] < cutoff]
        for sid in expired:
            del self._sessions[sid]

    def create(
        self,
        session_id: str,
        *,
        words: List[dict],
        ground_truth: str,
        language: str,
        validator: str,
        filename: str,
    ) -> dict:
        now = time.time()
        session = {
            "activity_log_id": session_id,
            # Deep-copy word dicts so later mutation of the session never
            # aliases the list returned to the caller of /transcribe.
            "words": [dict(w) for w in words],
            # Kept so edits/deletes/revokes can re-score mismatches against
            # the same ground truth used at transcription time.
            "ground_truth": ground_truth or "",
            "language": language,
            "validator": validator,
            "filename": filename,
            "operations": [],
            "next_operation_id": 1,
            "created_at": now,
            "last_updated": now,
        }
        with self.lock:
            self._purge_expired_locked()
            self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> dict:
        with self.lock:
            self._purge_expired_locked()
            session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        return session

    def touch(self, session: dict) -> None:
        session["last_updated"] = time.time()

    def add_operation(
        self, session: dict, op_type: str, word_index: int, before, after
    ) -> dict:
        op = {
            "operation_id": session["next_operation_id"],
            "type": op_type,
            "word_index": word_index,
            "before": before,
            "after": after,
            "timestamp": time.time(),
            "revoked": False,
        }
        session["next_operation_id"] += 1
        session["operations"].append(op)
        self.touch(session)
        return op

    def find_operation(
        self,
        session: dict,
        operation_id: Optional[int] = None,
        word_index: Optional[int] = None,
        op_type: Optional[str] = None,
    ) -> Optional[dict]:
        ops = session["operations"]
        if operation_id is not None:
            for op in reversed(ops):
                if op["operation_id"] == operation_id:
                    return op
            return None
        # No operation_id given: fall back to the most recent non-revoked
        # operation matching word_index/type (used by callers that only
        # know "undo the edit/delete at this position").
        for op in reversed(ops):
            if op["revoked"]:
                continue
            if word_index is not None and op["word_index"] != word_index:
                continue
            if op_type is not None and op["type"] != op_type:
                continue
            return op
        return None

    def close(self, session_id: str) -> Optional[dict]:
        with self.lock:
            return self._sessions.pop(session_id, None)


SESSION_STORE = _SessionStore()


def _reindex_words(words: List[dict]) -> None:
    for i, w in enumerate(words):
        w["index"] = i


def _rebuild_transcript(words: List[dict]) -> str:
    """The transcript is never stored — it's always derived from `words`,
    so it can never disagree with the word list."""
    return " ".join(str(w["word"]) for w in words)


def _compute_stats(words: List[dict]) -> Tuple[int, int, float]:
    """Derive (total_words, mismatch_count, accuracy) from `words`."""
    total_words = len(words)
    mismatch_count = sum(1 for w in words if w.get("mismatch"))
    accuracy = round((total_words - mismatch_count) / total_words, 4) if total_words else 1.0
    return total_words, mismatch_count, accuracy


def _recompute_mismatches(words: List[dict], ground_truth: str) -> None:
    """Re-run the hypothesis/ground-truth alignment after an edit, delete,
    or revoke and update each word's `mismatch` flag in place.

    Without this, a corrected word (e.g. "helo" -> "hello") would still be
    flagged as a mismatch forever, and accuracy would never reflect the
    edits the validator just made.
    """
    hyp_words = [str(w["word"]) for w in words]
    ground_truth = ground_truth or ""

    if not hyp_words:
        return

    if not ground_truth.strip():
        for w in words:
            w["mismatch"] = False
        return

    ref_words = [w for w in _collapse_ws(ground_truth).split() if w]
    hyp_norm = [_normalize_token(w) for w in hyp_words]
    ref_norm = [_normalize_token(w) for w in ref_words]

    try:
        mismatches = _compare_with_rapidfuzz(hyp_norm, ref_norm)
    except ImportError:
        mismatches = _compare_with_difflib(hyp_norm, ref_norm)

    while len(mismatches) < len(hyp_words):
        mismatches.append(False)

    for w, mismatch in zip(words, mismatches):
        w["mismatch"] = bool(mismatch)


def _load_session(activity_log_id) -> dict:
    if activity_log_id is None or str(activity_log_id).strip() == "":
        raise HTTPException(status_code=400, detail="activity_log_id is required")
    try:
        return SESSION_STORE.get(str(activity_log_id))
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail="No active transcript session for this activity_log_id. Please re-transcribe.",
        )


def _append_transcript_log(filepath: str, validator: str, filename: str,
                            language: str, transcript: str) -> None:
    import datetime
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    separator = "=" * 80
    entry = (
        f"\n{separator}\n"
        f"Timestamp : {ts}\n"
        f"Validator : {validator or 'anonymous'}\n"
        f"File      : {filename}\n"
        f"Language  : {language}\n"
        f"{separator}\n"
        f"{transcript}\n"
    )
    try:
        with open(filepath, "a", encoding="utf-8") as f:
            f.write(entry)
    except Exception as exc:
        logger.warning("Could not write transcript log %s: %s", filepath, exc)
 
 
def _normalize_token(token: str) -> str:
    token = unicodedata.normalize("NFC", token.lower())
    token = re.sub(r"[^\w\u0900-\u097F\u0C00-\u0C7F]", "", token, flags=re.UNICODE)
    return token
 
 
def _collapse_ws(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text or "")).strip()
 
 
def compare_words(hypothesis: str, reference: str) -> List[dict]:
    """Align hypothesis against IndicConformer reference; flag mismatches."""
    hypothesis = _collapse_ws(hypothesis)
    reference = _collapse_ws(reference)
    hyp_words = [w for w in hypothesis.split() if w]
    if not hyp_words:
        return []
    if not reference.strip():
        return [{"word": w, "index": i, "mismatch": False} for i, w in enumerate(hyp_words)]
 
    ref_words = [w for w in reference.split() if w]
    hyp_norm = [_normalize_token(w) for w in hyp_words]
    ref_norm = [_normalize_token(w) for w in ref_words]
 
    try:
        mismatches = _compare_with_rapidfuzz(hyp_norm, ref_norm)
    except ImportError:
        mismatches = _compare_with_difflib(hyp_norm, ref_norm)
 
    return [
        {"word": hyp_words[i], "index": i, "mismatch": mismatches[i]}
        for i in range(len(hyp_words))
    ]
 
 
def _compare_with_rapidfuzz(hyp_norm: List[str], ref_norm: List[str]) -> List[bool]:
    from rapidfuzz import fuzz
 
    if not ref_norm:
        return [True] * len(hyp_norm)
 
    mismatches = [True] * len(hyp_norm)
    ref_pos = 0
    for i, h in enumerate(hyp_norm):
        if ref_pos >= len(ref_norm):
            break
        best_ratio = 0.0
        best_j = ref_pos
        for j in range(ref_pos, min(ref_pos + 5, len(ref_norm))):
            ratio = fuzz.ratio(h, ref_norm[j]) / 100.0
            if ratio > best_ratio:
                best_ratio = ratio
                best_j = j
        if best_ratio >= 0.85:
            mismatches[i] = False
            ref_pos = best_j + 1
 
    return mismatches
 
 
def _compare_with_difflib(hyp_norm: List[str], ref_norm: List[str]) -> List[bool]:
    from difflib import SequenceMatcher
 
    mismatches = [True] * len(hyp_norm)
    if not ref_norm:
        return mismatches
 
    matcher = SequenceMatcher(None, hyp_norm, ref_norm, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for i in range(i1, i2):
                mismatches[i] = False
        elif tag == "replace":
            from difflib import SequenceMatcher as SM
            for offset in range(min(i2 - i1, j2 - j1)):
                ratio = SM(None, hyp_norm[i1 + offset], ref_norm[j1 + offset]).ratio()
                if ratio >= 0.85:
                    mismatches[i1 + offset] = False
    return mismatches
 
 
def _run_sarvam_asr(
    input_path: str, language: str, base_dir: str, sarvam_api_key: str
) -> Tuple[str, List[dict]]:
    from pydub import AudioSegment
 
    chunk_dir = os.path.join(base_dir, "sarvam_chunks")
    output_dir = os.path.join(base_dir, "sarvam_output")
    os.makedirs(output_dir, exist_ok=True)
 
    audio = AudioSegment.from_file(input_path)
    duration_min = len(audio) / (1000 * 60)
    chunk_ms = CHUNK_MS_SARVAM if duration_min < 60 else CHUNK_MS_SARVAM_LONG
 
    if language == "Hindi":
        chunk_paths = _hin_split_audio(input_path, chunk_ms, chunk_dir)
        client = _hin_sarvam_client(sarvam_api_key)
        lang_code = SARVAM_LANG_CODE["Hindi"]
        merge_fn = _hin_merge_json
    elif language == "Telugu":
        chunk_paths = _tel_split_audio(input_path, chunk_ms, chunk_dir)
        client = _tel_sarvam_client(sarvam_api_key)
        lang_code = SARVAM_LANG_CODE["Telugu"]
        merge_fn = _tel_merge_json
    else:
        chunk_paths = _eng_split_audio(input_path, chunk_ms, chunk_dir)
        client = _eng_sarvam_client(sarvam_api_key)
        lang_code = SARVAM_LANG_CODE["English"]
        merge_fn = _eng_merge_json
 
    try:
        job = client.speech_to_text_job.create_job(
            model="saaras:v3",
            mode="transcribe",
            language_code=lang_code,
            with_timestamps=True,
            with_diarization=True,
        )
        job.upload_files(file_paths=chunk_paths)
        job.start()
        job.wait_until_complete()
    except Exception as exc:
        raise_if_sarvam_auth_error(exc)
        raise
 
    if job.is_failed():
        raise RuntimeError("Sarvam STT job failed")
 
    job.download_outputs(output_dir=output_dir)
    word_timings = extract_sarvam_word_timestamps(output_dir, chunk_paths)
 
    final_text_path = merge_fn(output_dir)
    raw = ""
    if final_text_path:
        with open(final_text_path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
    return raw, word_timings
 
 
def _run_indic_conformer(input_path: str, ext: str, language: str, base_dir: str) -> str:
    lang_code = LANGUAGE_CODE_MAP.get(language, "te")
    wav_path = os.path.join(base_dir, "ic_input.wav")
    work_path = _eng_normalize_to_wav(input_path, ext, wav_path)
    chunk_dir = os.path.join(base_dir, "ic_chunks")
    chunk_paths = _eng_split_audio(work_path, CHUNK_MS_ENGLISH, chunk_dir)
 
    _ensure_indic_conformer_model()
    texts = []
    for cp in chunk_paths:
        try:
            texts.append(_transcribe_chunk_ground_truth(cp, lang_code).strip())
        except Exception as exc:
            logger.warning("[GROUND TRUTH] IC chunk failed (lang=%s): %s", lang_code, exc)
 
    return " ".join(t for t in texts if t).strip()
 
 
def _run_whisper_turbo(input_path: str, ext: str, base_dir: str) -> str:
    wav_path = os.path.join(base_dir, "turbo_input.wav")
    work_path = _eng_normalize_to_wav(input_path, ext, wav_path)
    chunk_dir = os.path.join(base_dir, "turbo_chunks")
    chunk_paths = _eng_split_audio(work_path, CHUNK_MS_ENGLISH, chunk_dir)
 
    _ensure_whisper_turbo_model()
    texts = []
    for cp in chunk_paths:
        try:
            texts.append(_turbo_transcribe_chunk(cp).strip())
        except Exception as exc:
            logger.warning("[GROUND TRUTH] Distil-Whisper chunk failed: %s", exc)
 
    return " ".join(t for t in texts if t).strip()
 
 
 
def _extract_plain_text(transcript: str) -> str:
    lines = transcript.split("\n")
    plain_parts = []
    speaker_re = re.compile(r"^\[SPEAKER_[^\]]+\]\s*\([^)]+\):\s*", re.IGNORECASE)
    for line in lines:
        line = line.strip()
        if not line:
            continue
        cleaned = speaker_re.sub("", line).strip()
        if cleaned:
            plain_parts.append(cleaned)
    return " ".join(plain_parts) if plain_parts else transcript.strip()
 
 
def _chunk_start_offsets(chunk_paths: List[str]) -> List[float]:
    from pydub import AudioSegment
 
    offsets: List[float] = []
    t = 0.0
    for cp in chunk_paths:
        offsets.append(t)
        try:
            t += len(AudioSegment.from_file(cp)) / 1000.0
        except Exception:
            t += CHUNK_MS_SARVAM / 1000.0
    return offsets
 
 
def _distribute_segment_words(text: str, start: float, end: float) -> List[dict]:
    parts = [w for w in text.split() if w]
    if not parts:
        return []
    span = max(float(end) - float(start), 0.001)
    if len(parts) == 1:
        return [{"word": parts[0], "start_sec": round(start, 3), "end_sec": round(end, 3)}]
    out: List[dict] = []
    for i, word in enumerate(parts):
        w_start = start + (i / len(parts)) * span
        w_end = start + ((i + 1) / len(parts)) * span
        out.append({"word": word, "start_sec": round(w_start, 3), "end_sec": round(w_end, 3)})
    return out
 
 
def _words_from_timestamps_obj(ts: dict, offset: float) -> List[dict]:
    words_raw = ts.get("words") or ts.get("chunks") or []
    starts = ts.get("start_time_seconds") or []
    ends = ts.get("end_time_seconds") or []
    out: List[dict] = []
    for i, item in enumerate(words_raw):
        item = str(item).strip()
        if not item:
            continue
        s = float(starts[i]) + offset if i < len(starts) else offset
        e = float(ends[i]) + offset if i < len(ends) else s
        sub = item.split()
        if len(sub) == 1:
            out.append({"word": sub[0], "start_sec": round(s, 3), "end_sec": round(e, 3)})
        else:
            out.extend(_distribute_segment_words(item, s, e))
    return out
 
 
def extract_sarvam_word_timestamps(output_dir: str, chunk_paths: List[str]) -> List[dict]:
    """Build word list with start/end seconds from Sarvam saaras:v3 JSON outputs."""
    if not os.path.isdir(output_dir):
        return []
 
    offsets = _chunk_start_offsets(chunk_paths)
    json_files = natsort.natsorted(
        [f for f in os.listdir(output_dir) if f.endswith(".json")]
    )
    all_words: List[dict] = []
 
    for idx, jf in enumerate(json_files):
        offset = offsets[idx] if idx < len(offsets) else 0.0
        chunk_end = offsets[idx + 1] if idx + 1 < len(offsets) else offset + 30.0
        try:
            with open(os.path.join(output_dir, jf), encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            logger.warning("[ASR] Could not read Sarvam JSON %s: %s", jf, exc)
            continue
 
        chunk_words: List[dict] = []
        ts = data.get("timestamps")
        if isinstance(ts, dict) and ts:
            chunk_words = _words_from_timestamps_obj(ts, offset)
 
        if not chunk_words:
            diarized = data.get("diarized_transcript") or {}
            entries = diarized.get("entries", []) if isinstance(diarized, dict) else diarized
            if isinstance(entries, list):
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    text = str(entry.get("transcript", "")).strip()
                    if not text:
                        continue
                    s = float(entry.get("start_time_seconds", 0)) + offset
                    e = float(entry.get("end_time_seconds", s)) + offset
                    chunk_words.extend(_distribute_segment_words(text, s, e))
 
        if not chunk_words:
            text = str(data.get("transcript", "")).strip()
            if text:
                chunk_words = _distribute_segment_words(text, offset, chunk_end)
 
        all_words.extend(chunk_words)
 
    for i, w in enumerate(all_words):
        w["index"] = i
    return all_words
 
 
def _merge_words_with_mismatches(timings: List[dict], mismatches: List[bool]) -> List[dict]:
    words: List[dict] = []
    for i, t in enumerate(timings):
        words.append({
            "word": t["word"],
            "index": i,
            "mismatch": bool(mismatches[i]) if i < len(mismatches) else False,
            "start_sec": t.get("start_sec"),
            "end_sec": t.get("end_sec"),
        })
    return words
 
 
@router.post("/transcribe")
async def unified_transcribe(
    request: Request,
    api_key: str = Security(api_key_header),
    sarvam_key: str = Security(sarvam_api_key_header),
    file: UploadFile = File(...),
    language: str = Form(...),
    validator_name: str = Form(""),
    sarvam_api_key: str = Form(""),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """
    Unified transcription: Sarvam saaras:v3 output with ground-truth mismatch highlights.
    """
    verify_api_key(request, api_key)
 
    language = (language or "").strip().title()
    if language not in LANGUAGE_CODE_MAP:
        raise HTTPException(status_code=400, detail="language must be English, Hindi, or Telugu")
 
    validator = (validator_name or "").strip()
    filename = file.filename or "upload.wav"
    file_bytes = await file.read()
    file_size = len(file_bytes)
 
    start_time = time.time()
 
    logger.info(
        "[TRANSCRIBE START] validator=%s | file=%s | language=%s | size=%dB",
        validator or "anonymous",
        filename,
        language,
        file_size,
    )
 
    req_id = uuid.uuid4().hex
    base_dir = f"./temp_unified_{req_id}"
    input_dir = os.path.join(base_dir, "input")
    os.makedirs(input_dir, exist_ok=True)
 
    try:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "wav"
        if ext not in SUPPORTED_FORMATS:
            raise HTTPException(
                status_code=400,
                detail=f"Supported formats: {', '.join(SUPPORTED_FORMATS)}",
            )
 
        input_path = os.path.join(input_dir, f"input.{ext}")
        with open(input_path, "wb") as f:
            f.write(file_bytes)
 
        wav_path = os.path.join(input_dir, "input.wav")
        _eng_normalize_to_wav(input_path, ext, wav_path)
 
        asr_start = time.time()
        word_timings: List[dict] = []
        resolved_sarvam_key = require_sarvam_api_key(
            request, header_key=sarvam_key, form_key=sarvam_api_key
        )
        raw_transcript, word_timings = _run_sarvam_asr(
            input_path, language, base_dir, resolved_sarvam_key
        )
        model_label = "Sarvam"
        asr_elapsed = time.time() - asr_start
 
        if word_timings:
            plain_transcript = " ".join(t["word"] for t in word_timings)
        else:
            plain_transcript = _extract_plain_text(raw_transcript)
        word_count_asr = len(plain_transcript.split())
 
        logger.info(
            "[ASR OUTPUT] validator=%s | file=%s | language=%s | model=%s | words=%d | time=%.1fs",
            validator or "anonymous",
            filename,
            language,
            model_label,
            word_count_asr,
            asr_elapsed,
        )
 
        _append_transcript_log(
            SARVAM_TRANSCRIPT_LOG, validator, filename, language, plain_transcript
        )
 
        gt_text = ""
        gt_status = "not_started"
        gt_start = time.time()
 
        ic_dir = f"./temp_ic_{req_id}"
        os.makedirs(ic_dir, exist_ok=True)
 
        try:
            if language == "English":
                gt_text = _run_whisper_turbo(input_path, ext, ic_dir)
            else:
                gt_text = _run_indic_conformer(input_path, ext, language, ic_dir)
            gt_status = "ok" if gt_text.strip() else "empty"
        except Exception as exc:
            err = str(exc).lower()
            if "gated" in err or "401" in err or "authenticated" in err:
                gt_status = "auth_required"
            elif "onnxruntime" in err:
                gt_status = "missing_onnxruntime"
            else:
                gt_status = "failed"
            logger.warning(
                "[GROUND TRUTH] validator=%s | file=%s | language=%s | status=%s | error=%s",
                validator or "anonymous",
                filename,
                language,
                gt_status,
                exc,
            )
        finally:
            shutil.rmtree(ic_dir, ignore_errors=True)
 
        if gt_status == "empty":
            logger.warning(
                "[GROUND TRUTH] validator=%s | file=%s | language=%s | status=empty",
                validator or "anonymous",
                filename,
                language,
            )
 
        gt_elapsed = time.time() - gt_start
        gt_word_count = len(gt_text.split()) if gt_text else 0
 
        logger.info(
            "[GROUND TRUTH] validator=%s | file=%s | language=%s | status=%s | words=%d | time=%.1fs",
            validator or "anonymous",
            filename,
            language,
            gt_status,
            gt_word_count,
            gt_elapsed,
        )
 
        if gt_text and gt_status == "ok":
            log_path = TURBO_TRANSCRIPT_LOG if language == "English" else IC_TRANSCRIPT_LOG
            _append_transcript_log(
                log_path, validator, filename, language, gt_text
            )
 
        ground_truth_available = bool(gt_text and gt_status == "ok")
 
        if word_timings:
            hyp_words = [t["word"] for t in word_timings]
            if ground_truth_available:
                ref_words = [w for w in _collapse_ws(gt_text).split() if w]
                hyp_norm = [_normalize_token(w) for w in hyp_words]
                ref_norm = [_normalize_token(w) for w in ref_words]
                try:
                    mismatches = _compare_with_rapidfuzz(hyp_norm, ref_norm)
                except ImportError:
                    mismatches = _compare_with_difflib(hyp_norm, ref_norm)
                while len(mismatches) < len(hyp_words):
                    mismatches.append(False)
                words = _merge_words_with_mismatches(word_timings, mismatches)
            else:
                words = [
                    {
                        "word": t["word"],
                        "index": i,
                        "mismatch": False,
                        "start_sec": t.get("start_sec"),
                        "end_sec": t.get("end_sec"),
                    }
                    for i, t in enumerate(word_timings)
                ]
        elif ground_truth_available:
            words = compare_words(plain_transcript, gt_text)
        else:
            words = [
                {"word": w, "index": i, "mismatch": False}
                for i, w in enumerate(plain_transcript.split())
                if w
            ]
 
        total_words = len(words)
        mismatch_count = sum(1 for w in words if w["mismatch"])
        accuracy = round((total_words - mismatch_count) / total_words, 4) if total_words else 1.0
 
        logger.info(
            "[COMPARISON] validator=%s | file=%s | language=%s | total_words=%d | mismatches=%d | accuracy=%.1f%%",
            validator or "anonymous",
            filename,
            language,
            total_words,
            mismatch_count,
            accuracy * 100,
        )
 
        activity_log_id = None
        if current_user is not None and os.path.isfile(wav_path):
            with open(wav_path, "rb") as audio_f:
                audio_bytes = audio_f.read()
            if audio_bytes:
                log_name = (filename or "recording").rsplit(".", 1)[0]
                activity_log_id = record_studio_activity_log(
                    db,
                    current_user,
                    activity_type="asr",
                    text_content=plain_transcript,
                    language=language,
                    audio_bytes=audio_bytes,
                    audio_format="wav",
                    file_name=log_name,
                )
 
        # activity_log_id is only set for authenticated users (see above). Every
        # transcription still needs an editing session key, so unauthenticated
        # requests get a synthetic one. Either way this becomes the id the
        # frontend must send back on every subsequent word-edit/word-delete/
        # word-revoke/save-transcript call — the transcript itself never
        # needs to be resent.
        session_id = str(activity_log_id) if activity_log_id else f"anon-{uuid.uuid4().hex}"
        SESSION_STORE.create(
            session_id,
            words=words,
            ground_truth=gt_text if ground_truth_available else "",
            language=language,
            validator=validator,
            filename=filename,
        )

        processing_time = round((time.time() - start_time) / 60, 4)
 
        logger.info(
            "[TRANSCRIBE END] validator=%s | file=%s | language=%s | total_time=%.1fs",
            validator or "anonymous",
            filename,
            language,
            time.time() - start_time,
        )
 
        return JSONResponse({
            "transcript": plain_transcript,
            "words": words,
            "mismatch_count": mismatch_count,
            "total_words": total_words,
            "accuracy": accuracy,
            "language": language,
            "processing_time_mins": processing_time,
            "ground_truth_available": ground_truth_available,
            "ground_truth_status": gt_status,
            "ground_truth": gt_text if ground_truth_available else "",
            "has_word_timestamps": any(
                w.get("start_sec") is not None for w in words
            ),
            "activity_log_id": session_id,
        })
 
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "[TRANSCRIBE ERROR] validator=%s | file=%s | error=%s",
            validator or "anonymous",
            filename,
            exc,
        )
        return JSONResponse(
            {"detail": sanitize_user_message(f"Transcription failed: {exc}")},
            status_code=500,
        )
    finally:
        shutil.rmtree(base_dir, ignore_errors=True)
 
 
 
@router.post("/word-delete")
async def log_word_delete(
    request: Request,
    api_key: str = Security(api_key_header),
):
    verify_api_key(request, api_key)
 
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
 
    activity_log_id = body.get("activity_log_id")
    word_index = int(body.get("word_index", -1))
 
    session = _load_session(activity_log_id)
 
    with SESSION_STORE.lock:
        words = session["words"]
        if word_index < 0 or word_index >= len(words):
            raise HTTPException(status_code=400, detail="word_index out of range")
 
        removed = words.pop(word_index)
        deleted_word = str(removed["word"])
        _reindex_words(words)
 
        # Store the full removed word dict (word + timestamps) so a later
        # word-revoke can reinsert it intact, not just the bare string.
        SESSION_STORE.add_operation(session, "delete", word_index, before=removed, after=None)
 
        _recompute_mismatches(words, session["ground_truth"])
        SESSION_STORE.touch(session)
        transcript = _rebuild_transcript(words)
        total_words, mismatch_count, accuracy = _compute_stats(words)
 
    logger.info(
        '[WORD DELETE] validator=%s | file=%s | language=%s | position=%d | deleted="%s"',
        session["validator"] or "anonymous",
        session["filename"],
        session["language"],
        word_index,
        deleted_word,
    )
 
    return JSONResponse({
        "status": "ok",
        "word_index": word_index,
        "deleted_word": deleted_word,
        "words": words,
        "transcript": transcript,
        "total_words": total_words,
        "mismatch_count": mismatch_count,
        "accuracy": accuracy,
    })
 
 
@router.post("/word-edit")
async def log_word_edit(
    request: Request,
    api_key: str = Security(api_key_header),
):
    verify_api_key(request, api_key)
 
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
 
    activity_log_id = body.get("activity_log_id")
    word_index = int(body.get("word_index", -1))
    corrected_word = str(body.get("corrected_word", ""))
 
    session = _load_session(activity_log_id)
 
    with SESSION_STORE.lock:
        words = session["words"]
        if word_index < 0 or word_index >= len(words):
            raise HTTPException(status_code=400, detail="word_index out of range")
 
        original_word = str(words[word_index]["word"])
        # Only the "word" key changes — start_sec/end_sec/mismatch on this
        # entry are left untouched so timing info survives the edit.
        words[word_index]["word"] = corrected_word
 
        SESSION_STORE.add_operation(
            session, "edit", word_index, before=original_word, after=corrected_word
        )
 
        _recompute_mismatches(words, session["ground_truth"])
        SESSION_STORE.touch(session)
        transcript = _rebuild_transcript(words)
        total_words, mismatch_count, accuracy = _compute_stats(words)
 
    logger.info(
        '[WORD EDIT] validator=%s | file=%s | language=%s | position=%d | original="%s" | corrected="%s"',
        session["validator"] or "anonymous",
        session["filename"],
        session["language"],
        word_index,
        original_word,
        corrected_word,
    )
 
    return JSONResponse({
        "status": "ok",
        "word_index": word_index,
        "original_word": original_word,
        "corrected_word": corrected_word,
        "words": words,
        "transcript": transcript,
        "total_words": total_words,
        "mismatch_count": mismatch_count,
        "accuracy": accuracy,
    })
 
 
@router.post("/save-transcript")
async def log_save_transcript(
    request: Request,
    api_key: str = Security(api_key_header),
):
    verify_api_key(request, api_key)
 
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
 
    activity_log_id = body.get("activity_log_id")
    session = _load_session(activity_log_id)
 
    with SESSION_STORE.lock:
        words = session["words"]
        transcript = _rebuild_transcript(words)
        validator_name = session["validator"]
        file_name = session["filename"]
        language = session["language"]
        edit_count = sum(1 for op in session["operations"] if not op["revoked"])
        total_words, mismatch_count, accuracy = _compute_stats(words)
 
    logger.info(
        "[SAVE] validator=%s | file=%s | language=%s | edits=%d | mismatches=%d | accuracy=%.1f%%",
        validator_name or "anonymous",
        file_name,
        language,
        edit_count,
        mismatch_count,
        accuracy * 100,
    )
 
    # TODO: this is the point to persist `transcript`/`words` to permanent
    # storage (e.g. update the studio activity log row for activity_log_id)
    # and write any additional audit/activity-log entries your app already
    # has a helper for. The previous implementation never persisted here
    # either — it only logged — so this preserves existing behavior while
    # giving you a single place to wire in real persistence.
    SESSION_STORE.close(str(activity_log_id))
 
    return JSONResponse({
        "status": "ok",
        "activity_log_id": str(activity_log_id),
        "transcript": transcript,
        "words": words,
        "edit_count": edit_count,
        "mismatch_count": mismatch_count,
        "accuracy": accuracy,
    })
 
 
@router.post("/word-revoke")
async def log_word_revoke(
    request: Request,
    api_key: str = Security(api_key_header),
):
    """Reverse a previously recorded word-edit or word-delete operation.

    Request body accepts either:
      {"activity_log_id": ..., "operation_id": 18}
    or:
      {"activity_log_id": ..., "word_index": 22, "revoke_type": "delete"}

    The second form revokes the most recent non-revoked operation matching
    that word_index/type — i.e. an "undo the last thing that happened at
    this position" shortcut. Prefer passing operation_id when you have it
    (e.g. straight from an operation history list), since it's unambiguous
    even if other edits happened after it.
    """
    verify_api_key(request, api_key)
 
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
 
    activity_log_id = body.get("activity_log_id")
    operation_id = body.get("operation_id")
    word_index_hint = body.get("word_index")
    revoke_type_hint = body.get("revoke_type")
 
    session = _load_session(activity_log_id)
 
    with SESSION_STORE.lock:
        op = SESSION_STORE.find_operation(
            session,
            operation_id=int(operation_id) if operation_id is not None else None,
            word_index=int(word_index_hint) if word_index_hint is not None else None,
            op_type=str(revoke_type_hint).strip().lower() if revoke_type_hint else None,
        )
        if op is None:
            raise HTTPException(status_code=404, detail="No matching operation found to revoke")
        if op["revoked"]:
            raise HTTPException(status_code=400, detail="Operation already revoked")
 
        words = session["words"]
        word_index = op["word_index"]
 
        if op["type"] == "edit":
            if word_index < 0 or word_index >= len(words):
                raise HTTPException(
                    status_code=400,
                    detail="Stored word_index no longer valid for revoke (transcript has changed since)",
                )
            revoked_word = words[word_index]["word"]
            restored_word = op["before"]
            words[word_index]["word"] = restored_word
        elif op["type"] == "delete":
            insert_at = min(max(word_index, 0), len(words))
            restored_entry = dict(op["before"]) if isinstance(op["before"], dict) else {"word": op["before"]}
            words.insert(insert_at, restored_entry)
            _reindex_words(words)
            revoked_word = None
            restored_word = restored_entry["word"]
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported operation type: {op['type']}")
 
        op["revoked"] = True
        _recompute_mismatches(words, session["ground_truth"])
        SESSION_STORE.touch(session)
        transcript = _rebuild_transcript(words)
        total_words, mismatch_count, accuracy = _compute_stats(words)
 
    logger.info(
        '[REVOKE] validator=%s | file=%s | language=%s | operation_id=%s | type=%s | position=%d | revoked="%s" | restored="%s"',
        session["validator"] or "anonymous",
        session["filename"],
        session["language"],
        op["operation_id"],
        op["type"],
        word_index,
        revoked_word,
        restored_word,
    )
 
    return JSONResponse({
        "status": "ok",
        "operation_id": op["operation_id"],
        "word_index": word_index,
        "restored_word": restored_word,
        "words": words,
        "transcript": transcript,
        "total_words": total_words,
        "mismatch_count": mismatch_count,
        "accuracy": accuracy,
    })