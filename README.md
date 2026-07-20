# ASR Validator Studio

React UI at the repo root, Python API in `back_end/`. Includes **login, registration, and per-user history** (same pattern as the TTS Validator project).

## Project structure

```text
ETV/
  src/                 # React UI (Vite)
    App.jsx            # Login gate → StudioApp
    StudioApp.jsx      # Transcribe + History (after sign-in)
    pages/             # LoginPage, RegisterPage
    components/auth/   # Auth forms (login, register, forgot password)
  index.html
  package.json
  vite.config.js       # Proxies /asr, /english, /hindi, /telugu, /api, /health
  .env.local           # VITE_API_AUTH_KEY (Hindi/Telugu only)
  back_end/
    main.py            # FastAPI — uvicorn entrypoint
    requirements.txt
    .env               # API_AUTH_KEY, DATABASE_URL, AUTH_JWT_SECRET, SARVAM_API_KEY
    eng_asr_api.py
    hin_asr_api.py
    tel_asr_api.py
    api/routes/        # /api/auth, /api/users, /asr/history, /health
    app/
      auth/            # JWT, passwords, OTP email
      models/          # User, AsrHistoryEntry, PasswordResetOtp
```

## Authentication overview

| Feature | How it works |
|--------|----------------|
| **Sign up / sign in** | Email + password → JWT (`Authorization: Bearer …`) |
| **History** | Requires login; each user sees only their own saves |
| **Hindi / Telugu transcribe** | `x-api-key` header (`API_AUTH_KEY` / `VITE_API_AUTH_KEY`) |
| **English transcribe** | No API key |
| **Forgot password** | OTP email if SMTP is set; otherwise OTP is logged in the API terminal |

## Environment variables

### `back_end/.env` (copy from `back_end/.env.example`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes (for login + history) | PostgreSQL, e.g. `postgresql+psycopg2://USER:PASSWORD@localhost:5432/ASR` |
| `AUTH_JWT_SECRET` | Yes (production) | Long random string for signing login tokens |
| `AUTH_TOKEN_HOURS` | No (default `24`) | JWT lifetime |
| `API_AUTH_KEY` | For Hindi/Telugu | Shared secret; must match frontend `VITE_API_AUTH_KEY` |
| `SARVAM_API_KEY` | For Hindi/Telugu | Sarvam cloud API key |
| `SMTP_*` | No | Send password-reset OTP by email |

### Root `.env.local` (copy from `.env.local.example`)

| Variable | Purpose |
|----------|---------|
| `VITE_API_AUTH_KEY` | Must match `API_AUTH_KEY` for Hindi/Telugu |

Auth API calls use `/api` (proxied to the backend in dev). No extra frontend env var is needed unless you call the API directly: `VITE_AUTH_API_BASE_URL`.

## Run backend

Same entrypoint as **Git-TTS-final**: thin `main.py` → `app/main.py`.

Uses **Python 3.11–3.14** with `audioop-lts` for pydub on 3.13+.

```powershell
cd ETV
.\scripts\start-api.ps1
```

Or manually:

```powershell
cd back_end
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt imageio-ffmpeg
# Create database ASR in pgAdmin; set DATABASE_URL and AUTH_JWT_SECRET in .env
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

If startup looks stuck after `Will watch for changes`:

1. Run `.\scripts\kill-stale-api.ps1` (clears port 8000).
2. End extra `python.exe` tasks in Task Manager from old failed starts.
3. Run `.\scripts\start-api.ps1` again and wait for `Application startup complete`.
4. English Whisper loads on **first transcribe**, not at startup (unlike old ASR layout).

On startup, the API creates `users`, `password_reset_otps`, and `asr_history` tables (and adds `user_id` to existing `asr_history` if needed).

First start downloads the English Whisper model (several minutes). For **MP3/M4A** on Windows, install bundled ffmpeg in the venv:

```powershell
pip install imageio-ffmpeg
```

Then restart the API (`uvicorn main:app --reload`). Or install system [FFmpeg](https://ffmpeg.org/) on PATH.

## Run frontend (separate terminal)

```powershell
cd ETV
npm install
copy .env.local.example .env.local
# Set VITE_API_AUTH_KEY to match back_end\.env API_AUTH_KEY
npm run dev
```

Open http://localhost:5173 → **Register** or **Sign in** → use Transcribe and History.

## Quick API test (optional)

With the API running and PostgreSQL configured:

```powershell
# Register
$body = '{"firstname":"Ada","lastname":"Lovelace","email":"you@example.com","password":"yourpass123"}'
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/auth/register -Method POST -ContentType "application/json" -Body $body

# Login
$login = Invoke-RestMethod -Uri http://127.0.0.1:8000/api/auth/token-login -Method POST -ContentType "application/json" -Body '{"email":"you@example.com","password":"yourpass123"}'
$token = $login.access_token

# Profile
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/users/me -Headers @{ Authorization = "Bearer $token" }
```

## Legacy Streamlit UI

```powershell
cd back_end
streamlit run app.py
```

## Docker (recommended for deployment)

Stack: **PostgreSQL** + **FastAPI backend** (CPU PyTorch + Whisper) + **nginx** (React UI + API proxy).

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose v2)
- Sarvam API key for Hindi/Telugu transcription

### Quick start

```powershell
cd ETV
copy .env.docker.example .env
# Set API_AUTH_KEY, VITE_API_AUTH_KEY (same value), SARVAM_API_KEY, AUTH_JWT_SECRET

docker compose up --build
```

| URL | Service |
|-----|---------|
| http://localhost:8080 | Web UI (use this in the browser) |
| http://localhost:8000 | API only (optional) |
| localhost:5432 | PostgreSQL (internal; exposed via compose for debugging) |

**First startup** can take 10–20+ minutes while the backend image installs dependencies and downloads the English Whisper model. Watch logs: `docker compose logs -f backend`.

### Useful commands

```powershell
docker compose up --build -d    # run in background
docker compose logs -f backend
docker compose down             # stop
docker compose down -v          # stop and remove DB + model cache volumes
```

### Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Orchestrates db, backend, frontend; passes `AUTH_JWT_SECRET` |
| `Dockerfile` | Builds React app and serves with nginx |
| `nginx.conf` | Proxies `/asr`, `/english`, `/hindi`, `/telugu`, `/health`, `/api` |
| `back_end/Dockerfile` | Python API image (ffmpeg + CPU torch) |
| `back_end/requirements-docker.txt` | Python deps for Docker (torch installed separately) |
| `.env.docker.example` | Template for `.env` used by Compose |

`VITE_API_AUTH_KEY` is embedded at **frontend build time**; if you change `API_AUTH_KEY`, rebuild: `docker compose build frontend --no-cache`.

## Troubleshooting

- **“Cannot reach the API” on login** — Start `uvicorn` in `back_end` and ensure `npm run dev` is running (Vite proxies `/api` to port 8000).
- **503 on register/login** — Check `DATABASE_URL`, PostgreSQL is running, and database `ASR` exists.
- **History empty after login** — Old history rows without `user_id` are not shown; save new transcriptions while signed in.
- **Hindi/Telugu fails** — Set matching `API_AUTH_KEY` and `VITE_API_AUTH_KEY`.
- **English transcribe 500 / “Expecting value”** — Install ffmpeg: `pip install imageio-ffmpeg` in `back_end` venv, restart API. MP3/M4A need ffmpeg; WAV usually works without it.
- **Password reset email** — Configure `SMTP_*` in `back_end/.env`; otherwise read the OTP in the API server logs.
