# Start ASR API from back_end (same pattern as Git-TTS-final)
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$Python = Join-Path $Root "venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Host "ERROR: venv not found. Run: python -m venv venv"
    exit 1
}

$venvActivate = Join-Path $Root "venv\Scripts\Activate.ps1"
if (Test-Path $venvActivate) {
    . $venvActivate
}

& $Python -m pip install -q "imageio-ffmpeg>=0.5.0" 2>$null

Write-Host "Clearing port 8000 if needed..."
$conn = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

$env:PYTHONUNBUFFERED = "1"
Write-Host "Starting ASR API at http://127.0.0.1:8000 (Ctrl+C to stop)" -ForegroundColor Cyan
Write-Host "Wait for: Application startup complete" -ForegroundColor DarkGray
& $Python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
