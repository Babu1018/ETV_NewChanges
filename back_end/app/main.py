# """
# ETV unified API — ASR + TTS with shared auth and PostgreSQL (database: ETV).
# Heavy routers (Whisper, Sarvam ASR, OmniVoice TTS) register on startup.
# """
# import os

# from app.ffmpeg_setup import ensure_ffmpeg_configured

# ensure_ffmpeg_configured()

# from fastapi import FastAPI
# from fastapi.middleware.cors import CORSMiddleware

# from logger import setup_logging
# from app.db import init_db
# from api.routes.auth import router as auth_router
# from api.routes.activity_logs import router as activity_logs_router
# from api.routes.admin_logs import router as admin_logs_router
# from api.routes.health import router as health_router
# from api.routes.history import router as asr_history_router
# from api.routes.users import router as users_router

# setup_logging()

# _DEFAULT_CORS_ORIGINS = [
#     "http://localhost:5173",
#     "http://127.0.0.1:5173",
#     "http://localhost:5174",
#     "http://127.0.0.1:5174",
#     "http://localhost:3000",
#     "http://127.0.0.1:3000",
#     "http://localhost:8036",
#     "http://127.0.0.1:8036",
#     "http://localhost:8080",
#     "http://127.0.0.1:8080",
# ]


# def _cors_origins() -> list[str]:
#     extra = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
#     origins = list(_DEFAULT_CORS_ORIGINS)
#     if extra:
#         origins.extend(origin.strip() for origin in extra.split(",") if origin.strip())
#     return origins

# app = FastAPI(
#     title="ETV Validator API",
#     description="ASR and TTS validation studio with shared login and history",
#     version="1.0",
# )

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=_cors_origins(),
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# app.include_router(health_router)
# app.include_router(auth_router)
# app.include_router(users_router)
# app.include_router(admin_logs_router)
# app.include_router(activity_logs_router)
# app.include_router(asr_history_router)


# def _register_heavy_routers() -> None:
#     from eng_asr_api import router as english_router
#     from hin_asr_api import router as hindi_router
#     from tel_asr_api import router as telugu_router
#     from asr_transcribe import router as asr_unified_router
#     from indic_conformer_asr_api import router as indic_conformer_router
#     from api.routes.tts_history import router as tts_history_router
#     from api.routes.tts import router as tts_router

#     app.include_router(english_router)
#     app.include_router(hindi_router)
#     app.include_router(telugu_router)
#     app.include_router(asr_unified_router)
#     app.include_router(indic_conformer_router)
#     app.include_router(tts_history_router)
#     app.include_router(tts_router)


# @app.on_event("startup")
# def _startup_init_db() -> None:
#     init_db()


# _register_heavy_routers()


# @app.get("/")
# async def root():
#     return {
#         "message": "ETV Validator API is running",
#         "asr": {
#             "transcribe": ["/english/transcribe", "/hindi/transcribe", "/telugu/transcribe", "/asr/transcribe"],
#             "history": "/asr/history",
#         },
#         "tts": {
#             "generate": "/tts/generate-tts",
#             "correct": "/tts/correct-tts",
#             "history": "/tts/history",
#         },
#         "auth": "/api/auth",
#     }

"""
ETV unified API — ASR + TTS with shared auth and PostgreSQL (database: ETV).
Heavy routers (Whisper, Sarvam ASR, OmniVoice TTS) register on startup.
"""
import os
 
from app.ffmpeg_setup import ensure_ffmpeg_configured
 
ensure_ffmpeg_configured()
 
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
 
from logger import setup_logging
from app.db import init_db
from api.routes.auth import router as auth_router
from api.routes.activity_logs import router as activity_logs_router
from api.routes.admin_logs import router as admin_logs_router
from api.routes.health import router as health_router
from api.routes.history import router as asr_history_router
from api.routes.users import router as users_router
 
setup_logging()
 
_DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8036",
    "http://127.0.0.1:8036",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]
 
 
def _cors_origins() -> list[str]:
    extra = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    origins = list(_DEFAULT_CORS_ORIGINS)
    if extra:
        origins.extend(origin.strip() for origin in extra.split(",") if origin.strip())
    return origins
 
app = FastAPI(
    title="ETV Validator API",
    description="ASR and TTS validation studio with shared login and history",
    version="1.0",
)
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
 
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(admin_logs_router)
app.include_router(activity_logs_router)
app.include_router(asr_history_router)
 
 
def _register_heavy_routers() -> None:
    from eng_asr_api import router as english_router
    from hin_asr_api import router as hindi_router
    from tel_asr_api import router as telugu_router
    from asr_transcribe import router as asr_unified_router
    from indic_conformer_asr_api import router as indic_conformer_router
    from distil_whisper_asr_api import router as whisper_turbo_router
    from api.routes.tts_history import router as tts_history_router
    from api.routes.tts import router as tts_router
 
    app.include_router(english_router)
    app.include_router(hindi_router)
    app.include_router(telugu_router)
    app.include_router(asr_unified_router)
    app.include_router(indic_conformer_router)
    app.include_router(whisper_turbo_router)
    app.include_router(tts_history_router)
    app.include_router(tts_router)
 
 
@app.on_event("startup")
def _startup_init_db() -> None:
    init_db()
 
 
_register_heavy_routers()
 
 
@app.get("/")
async def root():
    return {
        "message": "ETV Validator API is running",
        "asr": {
            "transcribe": ["/english/transcribe", "/hindi/transcribe", "/telugu/transcribe", "/asr/transcribe"],
            "history": "/asr/history",
        },
        "tts": {
            "generate": "/tts/generate-tts",
            "correct": "/tts/correct-tts",
            "history": "/tts/history",
        },
        "auth": "/api/auth",
    }
 
 