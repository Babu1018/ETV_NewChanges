# Start ASR Validator API (same pattern as Git-TTS-final scripts/start-api.ps1)
$root = Split-Path -Parent $PSScriptRoot
$backEnd = Join-Path $root "back_end"
Set-Location $backEnd

$venvActivate = Join-Path $backEnd "venv\Scripts\Activate.ps1"
if (Test-Path $venvActivate) {
    . $venvActivate
} else {
    Write-Warning "No back_end\venv found. Create it: python -m venv venv"
}

pip install -q "imageio-ffmpeg>=0.5.0" 2>$null

Write-Host "Starting ASR API at http://127.0.0.1:8000 (Ctrl+C to stop)" -ForegroundColor Cyan
Write-Host "First startup may pause briefly while English/Hindi/Telugu routes load." -ForegroundColor DarkGray
uvicorn main:app --reload --host 127.0.0.1 --port 8000
