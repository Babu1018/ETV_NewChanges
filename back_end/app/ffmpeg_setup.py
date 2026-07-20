"""
Configure ffmpeg/ffprobe for pydub before AudioSegment is imported (avoids import-time warning).
Uses imageio-ffmpeg on Windows when ffmpeg is not on PATH.
"""
from __future__ import annotations

import logging
import os
import shutil

logger = logging.getLogger("ASR")

_configured = False


def _alias_binary(src: str, dest_name: str) -> str:
    dest_path = os.path.join(os.path.dirname(src), dest_name)
    if os.path.isfile(dest_path):
        return dest_path
    try:
        shutil.copy2(src, dest_path)
        logger.info("ffmpeg setup: created %s", dest_path)
        return dest_path
    except OSError as exc:
        logger.warning("ffmpeg setup: could not create %s (%s)", dest_name, exc)
        return src


def _resolve_ffmpeg_binaries() -> tuple[str | None, str | None]:
    ffmpeg_exe = shutil.which("ffmpeg")
    ffprobe_exe = shutil.which("ffprobe")

    if ffmpeg_exe:
        if not ffprobe_exe:
            ffprobe_exe = ffmpeg_exe
        return ffmpeg_exe, ffprobe_exe

    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and os.path.isfile(bundled):
            bundled_dir = os.path.dirname(bundled)
            ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
            probe_name = "ffprobe.exe" if os.name == "nt" else "ffprobe"
            ffmpeg_exe = _alias_binary(bundled, ffmpeg_name)
            probe_path = os.path.join(bundled_dir, probe_name)
            ffprobe_exe = probe_path if os.path.isfile(probe_path) else _alias_binary(bundled, probe_name)

            path_prefix = bundled_dir + os.pathsep
            if bundled_dir not in os.environ.get("PATH", ""):
                os.environ["PATH"] = path_prefix + os.environ.get("PATH", "")
    except Exception as exc:
        logger.warning("Bundled ffmpeg unavailable: %s", exc)

    return ffmpeg_exe, ffprobe_exe


def ensure_ffmpeg_configured() -> None:
    global _configured
    if _configured:
        return

    ffmpeg_exe, ffprobe_exe = _resolve_ffmpeg_binaries()

    if ffmpeg_exe and os.path.isfile(ffmpeg_exe):
        os.environ.setdefault("FFMPEG_BINARY", ffmpeg_exe)
        logger.info("ffmpeg: %s", ffmpeg_exe)
    else:
        logger.warning(
            "ffmpeg not found. Install: pip install imageio-ffmpeg "
            "(in this venv) or winget install Gyan.FFmpeg"
        )

    if ffprobe_exe and os.path.isfile(ffprobe_exe):
        os.environ.setdefault("FFPROBE_BINARY", ffprobe_exe)
        logger.info("ffprobe: %s", ffprobe_exe)

    _configured = True


def configure_pydub_after_import() -> None:
    from pydub import AudioSegment
    import pydub.utils as pydub_utils

    ffmpeg_exe, ffprobe_exe = _resolve_ffmpeg_binaries()

    if ffmpeg_exe and os.path.isfile(ffmpeg_exe):
        AudioSegment.converter = ffmpeg_exe

    if ffprobe_exe and os.path.isfile(ffprobe_exe):
        pydub_utils.get_prober_name = lambda: ffprobe_exe
    elif ffmpeg_exe:
        pydub_utils.get_prober_name = lambda: ffmpeg_exe


def ffmpeg_available() -> bool:
    ffmpeg_exe, _ = _resolve_ffmpeg_binaries()
    return bool(ffmpeg_exe and os.path.isfile(ffmpeg_exe))


def ffmpeg_install_hint() -> str:
    return (
        "Audio conversion needs ffmpeg. In back_end venv run: pip install imageio-ffmpeg "
        "then restart the API. Or install system ffmpeg (winget install Gyan.FFmpeg). "
        "WAV files may work without ffmpeg; MP3/M4A/MP4 require it."
    )


def convert_file_to_wav(input_path: str, wav_path: str, sample_rate: int = 16000) -> None:
    """
    Decode any ffmpeg-supported file to 16-bit mono WAV.
    Uses ffmpeg directly (avoids pydub/ffprobe JSON probe issues on Windows).
    """
    import subprocess

    ffmpeg_exe, _ = _resolve_ffmpeg_binaries()
    if not ffmpeg_exe or not os.path.isfile(ffmpeg_exe):
        raise RuntimeError(ffmpeg_install_hint())

    cmd = [
        ffmpeg_exe,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input_path,
        "-ar",
        str(sample_rate),
        "-ac",
        "1",
        "-acodec",
        "pcm_s16le",
        wav_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not os.path.isfile(wav_path):
        err = (proc.stderr or proc.stdout or "ffmpeg conversion failed").strip()
        raise RuntimeError(err or ffmpeg_install_hint())
