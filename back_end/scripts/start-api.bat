@echo off
cd /d "%~dp0.."
echo Starting ASR API on http://127.0.0.1:8000
echo If this hangs, open Task Manager and end extra python.exe processes, then run again.
echo.
set PYTHONUNBUFFERED=1
"%~dp0..\venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000
pause
