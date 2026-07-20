# ASR Validator Studio — Full project file list for GitHub PR

Use this document in your **Pull Request description**: each row is one file, what it does in the project, and what changed in this release.

**Legend — Status**

| Status | Meaning |
|--------|---------|
| **Modified** | File was edited in this release |
| **New** | File added in this release |
| **Unchanged** | Part of the project; no edits in this release (still list it so reviewers know what it is) |

**Do not push to GitHub** (add to `.gitignore` or keep local only):

- `node_modules/`, `dist/`, `back_end/venv/`, `back_end/temp/`, `back_end/temp_english_*/`
- `back_end/.env`, `.env.local` (secrets — use `.env.example` / `.env.local.example` only)
- `PR_CHANGELOG.md` — optional; include only if you want docs in the repo

---

## PR summary (high level)

1. **History tab** — Checkboxes, search, pagination (20/page), preview modal, delete confirmation, bulk download (`.txt` zip), bulk delete, `Download (N)` / `Delete (N)`.
2. **Sanitization** — Vendor model names removed from all user-visible text (frontend + backend errors).
3. **Transcribe tab** — Audio/transcript panels stay 50/50; language dropdown sizing; Replace file on the right.
4. **Docker** — Full stack: PostgreSQL + FastAPI + nginx React UI.
5. **Core app** — English (local Whisper), Hindi/Telugu (Sarvam API), history stored in **PostgreSQL**.

---

## Root — project config & docs

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `README.md` | Project overview, local run steps, Docker quick start | **Modified** | Added Docker section and compose commands |
| `package.json` | npm dependencies and scripts (`dev`, `build`) | **Modified** | Added `jszip` for history zip download |
| `package-lock.json` | Locked npm dependency versions | **Modified** | Lockfile update for `jszip` |
| `index.html` | Vite HTML shell; mounts React root `#root` | Unchanged | — |
| `vite.config.js` | Vite dev server (port 5173) and API proxy to backend `:8000` | Unchanged | Proxies `/asr`, `/english`, `/hindi`, `/telugu`, `/health` |
| `.gitignore` | Git ignore rules (`node_modules`, `dist`, `venv`, temp folders) | Unchanged | — |
| `.env.local.example` | Template for frontend API key (`VITE_API_AUTH_KEY`) | Unchanged | Copy to `.env.local` for local dev |
| `PR_CHANGELOG.md` | This file — PR / file reference for reviewers | **New** | Documentation for GitHub PR |

---

## Root — Docker (deployment)

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `docker-compose.yml` | Runs PostgreSQL, backend API, and nginx frontend together | **New** | Full stack orchestration |
| `Dockerfile` | Builds React production bundle and serves it with nginx | **New** | Multi-stage frontend image |
| `nginx.conf` | Serves static UI; reverse-proxies API routes to backend | **New** | `/asr`, `/english`, `/hindi`, `/telugu`, `/health` |
| `.dockerignore` | Files excluded from frontend Docker build context | **New** | Skips `node_modules`, `dist`, secrets |
| `.env.docker.example` | Template env vars for `docker compose` | **New** | `API_AUTH_KEY`, `DATABASE_URL`, `SARVAM_API_KEY`, etc. |

---

## Frontend — entry & shell

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `src/main.jsx` | React entry: renders `App`, loads Bootstrap CSS and `index.css` | Unchanged | — |
| `src/App.jsx` | Main layout: Transcribe / History tabs, history state, API calls, navigation | **Modified** | Bulk delete handler; removed Clear all; sanitize errors and transcripts from history |
| `src/index.css` | Global and component styles (studio UI, history, transcribe) | **Modified** | History search/pagination/modals; 50/50 transcribe layout; language field; toolbar styles |

---

## Frontend — components

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `src/components/TranscribeTab.jsx` | Upload audio, pick language, run transcription, edit/save transcript, waveform | **Modified** | Sanitize fields/errors; fixed 50/50 dashboard; language dropdown width |
| `src/components/HistoryTab.jsx` | History table: list, search, select, download, delete, preview modal | **Modified** | Checkboxes, search, pagination, modals, bulk zip/delete, button counts |
| `src/components/AudioPlayer.jsx` | WaveSurfer audio player with regions/timeline for transcribe tab | Unchanged | — |
| `src/components/StudioSelect.jsx` | Styled dropdown used in the studio UI | Unchanged | — |
| `src/components/StudioIcon.jsx` | SVG icon wrapper for toolbar and buttons | Unchanged | — |
| `src/components/StudioToast.jsx` | Toast notification provider and display | **Modified** | Sanitize toast messages before display |
| `src/components/AudioAddMenu.jsx` | Menu for adding/replacing audio in transcribe flow | Unchanged | — |

---

## Frontend — utilities

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `src/utils/config.js` | Reads `VITE_API_BASE_URL` and `VITE_API_AUTH_KEY` from env | Unchanged | Default base URL `/asr` |
| `src/utils/asrApi.js` | Calls `/english`, `/hindi`, `/telugu` transcribe endpoints | **Modified** | Sanitize transcription text shown in UI |
| `src/utils/historyApi.js` | List/delete/fetch history from `/asr/history` API | **Modified** | Preview helpers, batch delete, sanitize list fields |
| `src/utils/historyZip.js` | Builds zip of selected history transcripts | **New** | `.txt` files only (no audio in zip) |
| `src/utils/apiError.js` | Parses and formats API/network errors for display | **Modified** | `sanitizeUserMessage()` / `sanitizeDisplayValue()` — strip vendor names |
| `src/utils/waveform.js` | WaveSurfer setup, regions, zoom, and waveform helpers | **Modified** | Comment cleanup only |
| `src/utils/audioFormat.js` | Audio MIME types and format normalization (wav, mp3, m4a, etc.) | Unchanged | — |

---

## Frontend — assets (SVG icons)

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `src/assets/Nav-Generate.svg` | Nav icon — Transcribe tab | Unchanged | — |
| `src/assets/Nav-History.svg` | Nav icon — History tab | Unchanged | — |
| `src/assets/Upload.svg` | Upload audio icon | Unchanged | — |
| `src/assets/WAV or MP3.svg` | Supported formats hint icon | Unchanged | — |
| `src/assets/Language.svg` | Language field icon | Unchanged | — |
| `src/assets/Save.svg` | Save transcript icon | Unchanged | — |
| `src/assets/Trash.svg` | Delete icon | Unchanged | — |
| `src/assets/Edit_pen-to-square-regular.svg` | Edit transcript icon | Unchanged | — |
| `src/assets/Generate.svg` | Generate / transcribe action icon | Unchanged | — |
| `src/assets/Speaker.svg` | Speaker-related UI icon | Unchanged | — |
| `src/assets/Gender.svg` | Gender-related UI icon (legacy/layout) | Unchanged | — |
| `src/assets/background.jpeg` | App background image (referenced in `App.jsx`) | Unchanged | Ensure this file is committed if used |

---

## Backend — API entry & routes

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `back_end/main.py` | **FastAPI app entrypoint** — run with `uvicorn main:app`; registers all routers, CORS, DB init on startup | Unchanged | Wires health, history, English/Hindi/Telugu transcribe routers |
| `back_end/api/routes/health.py` | `GET /health` — service health check | Unchanged | — |
| `back_end/api/routes/history.py` | `GET/POST/DELETE /asr/history` — save, list, download audio, delete history rows (PostgreSQL) | Unchanged | Stores audio + transcript in DB |

---

## Backend — database & config

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `back_end/app/db.py` | SQLAlchemy engine, sessions, `init_db()` — connects via `DATABASE_URL` (PostgreSQL) | Unchanged | — |
| `back_end/app/models/asr_history.py` | `AsrHistoryEntry` table model (audio blob, transcript, metadata) | Unchanged | — |
| `back_end/app/models/__init__.py` | Python package marker for models | Unchanged | — |
| `back_end/app/deps.py` | API key verification (`x-api-key` header) for protected routes | Unchanged | — |
| `back_end/app/config.py` | `BACKEND_ROOT` path for loading `.env` | Unchanged | — |
| `back_end/app/utils/user_messages.py` | Sanitize strings before sending to website UI | **New** | Strips vendor model names from error messages |

---

## Backend — ASR engines (transcription)

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `back_end/eng_asr_api.py` | English ASR: local Whisper model, `/english/transcribe`, temp dir per request | **Modified** | Sanitize error responses to client; uses `temp_english_{uuid}/` |
| `back_end/hin_asr_api.py` | Hindi ASR: Sarvam API, `/hindi/transcribe`, temp dir `./temp/{uuid}/` | **Modified** | Sanitize error responses to client |
| `back_end/tel_asr_api.py` | Telugu ASR: Sarvam API, `/telugu/transcribe`, temp dir `./temp/{uuid}/` | **Modified** | Sanitize error responses to client |
| `back_end/asr_wrapper.py` | Sync wrapper around async transcribe functions (used by tests/tools) | Unchanged | — |
| `back_end/check_wrapper.py` | Dev script: prints wrapper function source for debugging | Unchanged | Not used in production |

---

## Backend — legacy UI & dependencies

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `back_end/app.py` | Legacy **Streamlit** ASR UI (optional; not the React app) | **Modified** | Sanitize transcription failure messages shown in Streamlit |
| `back_end/requirements.txt` | Python packages for **local** venv (`pip install -r requirements.txt`) | Unchanged | FastAPI, torch, whisper, sqlalchemy, etc. |
| `back_end/.env.example` | Template for `API_AUTH_KEY`, `SARVAM_API_KEY`, `DATABASE_URL` | Unchanged | Copy to `back_end/.env` — do not commit real `.env` |
| `back_end/.env` | Local secrets (local dev only) | — | **Do not commit** |

---

## Backend — Docker

| File | Purpose | Status | Changes in this release |
|------|---------|--------|-------------------------|
| `back_end/Dockerfile` | API container: Python, ffmpeg, CPU PyTorch, uvicorn on port 8000 | **New** | Production API image |
| `back_end/requirements-docker.txt` | Python deps for Docker image (torch installed in Dockerfile) | **New** | Slimmer/requirements split for container build |
| `back_end/.dockerignore` | Excludes `venv`, `temp`, `.env` from API image build | **New** | — |

---

## Files generated at runtime (do not commit)

| Path | Purpose |
|------|---------|
| `node_modules/` | npm install output |
| `dist/` | `npm run build` production bundle |
| `back_end/venv/` | Local Python virtual environment |
| `back_end/temp/` | Hindi/Telugu transcribe working files (per request) |
| `back_end/temp_english_*/` | English transcribe working files (per request) |
| `back_end/data/` | Legacy SQLite path (if present); history now uses PostgreSQL |

---

## Copy-paste for GitHub PR description

Paste the block below into your PR **Description** (edit Status/Changes if your branch differs).

```markdown
## Summary
ASR Validator Studio: React UI + FastAPI backend for English/Hindi/Telugu transcription with PostgreSQL history, plus Docker deployment.

## Files changed / included

### Modified
- `src/components/HistoryTab.jsx` — History UI: checkboxes, search, pagination, modals, bulk download/delete
- `src/components/TranscribeTab.jsx` — Sanitize UI text; 50/50 layout; language dropdown
- `src/components/StudioToast.jsx` — Sanitize toast messages
- `src/App.jsx` — Bulk history delete; sanitize errors/transcripts
- `src/index.css` — History + transcribe styles
- `src/utils/historyApi.js` — History API helpers + sanitization
- `src/utils/apiError.js` — Error sanitization helpers
- `src/utils/asrApi.js` — Sanitize transcription output
- `src/utils/waveform.js` — Comment cleanup
- `package.json` / `package-lock.json` — Added jszip
- `back_end/eng_asr_api.py`, `hin_asr_api.py`, `tel_asr_api.py` — Sanitize API error messages
- `back_end/app.py` — Sanitize Streamlit errors
- `README.md` — Docker instructions

### New
- `src/utils/historyZip.js` — Zip export of selected transcripts (.txt only)
- `back_end/app/utils/user_messages.py` — Backend message sanitizer
- `docker-compose.yml`, `Dockerfile`, `nginx.conf`, `.dockerignore`, `.env.docker.example`
- `back_end/Dockerfile`, `back_end/requirements-docker.txt`, `back_end/.dockerignore`
- `PR_CHANGELOG.md` — Full file list (this document)

### Unchanged (core project — no edits this release)
- `back_end/main.py` — FastAPI entrypoint (uvicorn)
- `back_end/api/routes/history.py`, `health.py` — History and health APIs
- `back_end/app/db.py`, `models/asr_history.py`, `deps.py`, `config.py` — PostgreSQL history
- `src/main.jsx`, `vite.config.js`, `index.html`
- `src/components/AudioPlayer.jsx`, `StudioSelect.jsx`, `StudioIcon.jsx`, `AudioAddMenu.jsx`
- `src/utils/config.js`, `audioFormat.js`
- `back_end/requirements.txt`, `asr_wrapper.py`, assets SVGs

## Test plan
- [ ] `npm run dev` + `uvicorn main:app` — transcribe EN/HI/TE, save to history
- [ ] History: search, pagination, select, download zip, delete
- [ ] No vendor model names visible in UI or API errors
- [ ] Optional: `docker compose up --build` with `.env` from `.env.docker.example`
```

---

## How to run (for reviewers)

**Local**

```powershell
# Terminal 1 — backend
cd back_end
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
# Set back_end\.env from .env.example (DATABASE_URL, API_AUTH_KEY, SARVAM_API_KEY)
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — frontend
cd ..
npm install
# .env.local from .env.local.example (VITE_API_AUTH_KEY matches API_AUTH_KEY)
npm run dev
```

Open http://localhost:5173

**Docker**

```powershell
copy .env.docker.example .env
# Edit .env, then:
docker compose up --build
```

UI: http://localhost:8080 · API: http://localhost:8000
