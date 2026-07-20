# Quick check: ffmpeg for ASR English transcribe (MP3/M4A)
$Root = Split-Path $PSScriptRoot -Parent
$Python = Join-Path $Root "venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    Write-Host "ERROR: venv not found at $Root\venv"
    Write-Host "Create it: python -m venv venv"
    exit 1
}

Write-Host "Using: $Python"
Write-Host ""

Write-Host "1) imageio-ffmpeg (skip if already installed)..."
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $Python -m pip install imageio-ffmpeg 2>&1 | ForEach-Object { Write-Host $_ }
$pipOk = $LASTEXITCODE -eq 0
$ErrorActionPreference = $prevEap
if (-not $pipOk) {
    Write-Host "WARNING: pip returned $LASTEXITCODE (often still OK if package is already installed)"
}
Write-Host ""

Write-Host "2) Checking ffmpeg..."
& $Python -c @"
from app.ffmpeg_setup import ensure_ffmpeg_configured, ffmpeg_available, _resolve_ffmpeg_binaries
ensure_ffmpeg_configured()
print('ffmpeg_available:', ffmpeg_available())
ff, fp = _resolve_ffmpeg_binaries()
print('ffmpeg:', ff)
print('ffprobe:', fp)
"@
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "3) MP3->WAV test via ffmpeg (no Whisper, no pydub export)..."
& $Python -c @"
import os, struct, subprocess, tempfile, wave
from app.ffmpeg_setup import ensure_ffmpeg_configured, convert_file_to_wav, _resolve_ffmpeg_binaries
ensure_ffmpeg_configured()
ff, _ = _resolve_ffmpeg_binaries()
p = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
with wave.open(p.name,'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(struct.pack('<' + 'h'*8000, *([0]*8000)))
mp3 = p.name.replace('.wav','.mp3')
subprocess.run([ff, '-y', '-loglevel', 'error', '-i', p.name, mp3], check=True)
out = p.name.replace('.wav','_out.wav')
convert_file_to_wav(mp3, out, 16000)
print('MP3 convert OK, bytes:', os.path.getsize(out))
"@
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "All checks passed. Restart the API:"
Write-Host "  .\scripts\start-api.ps1"
