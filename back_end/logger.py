# """
# Centralized logging for ETV validator APIs.

# Validator log files (download from back_end/logs/):
#   - asr_validator.log  — EnglishASR, HindiASR, TeluguASR transcribe flow only
#   - tts_validator.log  — TTS generate / clone flow only

# App/system logs (auth, DB, activity API) use the ASR logger → console only.
# """
# import logging
# import os
# from logging.handlers import RotatingFileHandler

# LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
# LOG_FILE_ASR = os.path.join(LOG_DIR, "asr_validator.log")
# LOG_FILE_TTS = os.path.join(LOG_DIR, "tts_validator.log")
# MAX_BYTES = 10 * 1024 * 1024
# BACKUP_COUNT = 5
# LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

# FILE_FORMAT = "%(asctime)s,%(msecs)03d [%(levelname)s] %(name)s - %(message)s"
# CONSOLE_FORMAT = FILE_FORMAT
# DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# ASR_VALIDATOR_LOGGERS = ("EnglishASR", "HindiASR", "TeluguASR")
# TTS_VALIDATOR_LOGGERS = ("TTS",)


# class _ColorFormatter(logging.Formatter):
#     COLORS = {
#         logging.DEBUG: "\033[36m",
#         logging.INFO: "\033[32m",
#         logging.WARNING: "\033[33m",
#         logging.ERROR: "\033[31m",
#         logging.CRITICAL: "\033[35m",
#     }
#     RESET = "\033[0m"

#     def format(self, record: logging.LogRecord) -> str:
#         color = self.COLORS.get(record.levelno, self.RESET)
#         original_level = record.levelname
#         record.levelname = f"{color}{original_level}{self.RESET}"
#         try:
#             return super().format(record)
#         finally:
#             record.levelname = original_level


# def _make_file_formatter() -> logging.Formatter:
#     return logging.Formatter(FILE_FORMAT, datefmt=DATE_FORMAT)


# def _make_console_formatter() -> logging.Formatter:
#     return _ColorFormatter(CONSOLE_FORMAT, datefmt=DATE_FORMAT)


# def _has_file_handler(log: logging.Logger, abs_log_file: str) -> bool:
#     return any(
#         isinstance(h, RotatingFileHandler)
#         and os.path.abspath(getattr(h, "baseFilename", "")) == abs_log_file
#         for h in log.handlers
#     )


# def _has_console_handler(log: logging.Logger) -> bool:
#     return any(
#         isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler)
#         for h in log.handlers
#     )


# def _add_console_handler(log: logging.Logger, level: int) -> None:
#     if _has_console_handler(log):
#         return
#     console_handler = logging.StreamHandler()
#     console_handler.setLevel(level)
#     console_handler.setFormatter(_make_console_formatter())
#     log.addHandler(console_handler)


# def _configure_validator_file_logger(name: str, log_file: str, level: int) -> None:
#     """Route transcribe / generate flow logs to a rotating validator log file."""
#     log = logging.getLogger(name)
#     abs_log_file = os.path.abspath(log_file)

#     log.setLevel(level)
#     log.propagate = False

#     if not _has_file_handler(log, abs_log_file):
#         try:
#             file_handler = RotatingFileHandler(
#                 abs_log_file,
#                 maxBytes=MAX_BYTES,
#                 backupCount=BACKUP_COUNT,
#                 encoding="utf-8",
#             )
#             file_handler.setLevel(level)
#             file_handler.setFormatter(_make_file_formatter())
#             log.addHandler(file_handler)
#         except OSError as exc:
#             # Common in Docker when /app/logs is bind-mounted from a root-owned host dir.
#             sys_log = logging.getLogger("ASR")
#             sys_log.warning(
#                 "Validator log file not writable (%s); using console only. %s",
#                 abs_log_file,
#                 exc,
#             )

#     _add_console_handler(log, level)


# def _configure_console_logger(name: str, level: int) -> None:
#     """App/system logs — console only, never written to validator log files."""
#     log = logging.getLogger(name)
#     log.setLevel(level)
#     log.propagate = False
#     _add_console_handler(log, level)


# def setup_logging() -> None:
#     try:
#         os.makedirs(LOG_DIR, exist_ok=True)
#     except OSError as exc:
#         logging.getLogger("ASR").warning(
#             "Could not create log directory %s (%s); file logging disabled.",
#             LOG_DIR,
#             exc,
#         )
#     level = getattr(logging, LOG_LEVEL, logging.INFO)

#     _configure_console_logger("ASR", level)

#     for asr_logger_name in ASR_VALIDATOR_LOGGERS:
#         _configure_validator_file_logger(asr_logger_name, LOG_FILE_ASR, level)

#     for tts_logger_name in TTS_VALIDATOR_LOGGERS:
#         _configure_validator_file_logger(tts_logger_name, LOG_FILE_TTS, level)

#     for noisy in ("httpx", "httpcore", "urllib3", "multipart", "transformers"):
#         logging.getLogger(noisy).setLevel(logging.WARNING)


"""
Centralized logging for ETV validator APIs.
 
Validator log files (download from back_end/logs/):
  - asr_validator.log  — EnglishASR, HindiASR, TeluguASR transcribe flow only
  - tts_validator.log  — TTS generate / clone flow only
 
App/system logs (auth, DB, activity API) use the ASR logger → console only.
"""
import logging
import os
from logging.handlers import RotatingFileHandler
 
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
LOG_FILE_ASR = os.path.join(LOG_DIR, "asr_validator.log")
LOG_FILE_TTS = os.path.join(LOG_DIR, "tts_validator.log")
MAX_BYTES = 10 * 1024 * 1024
BACKUP_COUNT = 5
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
 
FILE_FORMAT = "%(asctime)s,%(msecs)03d [%(levelname)s] %(name)s - %(message)s"
CONSOLE_FORMAT = FILE_FORMAT
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
 
ASR_VALIDATOR_LOGGERS = (
    "EnglishASR",
    "HindiASR",
    "TeluguASR",
    "IndicConformerASR",
    "WhisperTurboASR",
    "ASR.Transcribe",
)
TTS_VALIDATOR_LOGGERS = ("TTS",)
 
 
class _ColorFormatter(logging.Formatter):
    COLORS = {
        logging.DEBUG: "\033[36m",
        logging.INFO: "\033[32m",
        logging.WARNING: "\033[33m",
        logging.ERROR: "\033[31m",
        logging.CRITICAL: "\033[35m",
    }
    RESET = "\033[0m"
 
    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelno, self.RESET)
        original_level = record.levelname
        record.levelname = f"{color}{original_level}{self.RESET}"
        try:
            return super().format(record)
        finally:
            record.levelname = original_level
 
 
def _make_file_formatter() -> logging.Formatter:
    return logging.Formatter(FILE_FORMAT, datefmt=DATE_FORMAT)
 
 
def _make_console_formatter() -> logging.Formatter:
    return _ColorFormatter(CONSOLE_FORMAT, datefmt=DATE_FORMAT)
 
 
def _has_file_handler(log: logging.Logger, abs_log_file: str) -> bool:
    return any(
        isinstance(h, RotatingFileHandler)
        and os.path.abspath(getattr(h, "baseFilename", "")) == abs_log_file
        for h in log.handlers
    )
 
 
def _has_console_handler(log: logging.Logger) -> bool:
    return any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler)
        for h in log.handlers
    )
 
 
def _add_console_handler(log: logging.Logger, level: int) -> None:
    if _has_console_handler(log):
        return
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(_make_console_formatter())
    log.addHandler(console_handler)
 
 
def _configure_validator_file_logger(name: str, log_file: str, level: int) -> None:
    """Route transcribe / generate flow logs to a rotating validator log file."""
    log = logging.getLogger(name)
    abs_log_file = os.path.abspath(log_file)
 
    log.setLevel(level)
    log.propagate = False
 
    if not _has_file_handler(log, abs_log_file):
        try:
            file_handler = RotatingFileHandler(
                abs_log_file,
                maxBytes=MAX_BYTES,
                backupCount=BACKUP_COUNT,
                encoding="utf-8",
            )
            file_handler.setLevel(level)
            file_handler.setFormatter(_make_file_formatter())
            log.addHandler(file_handler)
        except OSError as exc:
            # Common in Docker when /app/logs is bind-mounted from a root-owned host dir.
            sys_log = logging.getLogger("ASR")
            sys_log.warning(
                "Validator log file not writable (%s); using console only. %s",
                abs_log_file,
                exc,
            )
 
    _add_console_handler(log, level)
 
 
def _configure_console_logger(name: str, level: int) -> None:
    """App/system logs — console only, never written to validator log files."""
    log = logging.getLogger(name)
    log.setLevel(level)
    log.propagate = False
    _add_console_handler(log, level)
 
 
def setup_logging() -> None:
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
    except OSError as exc:
        logging.getLogger("ASR").warning(
            "Could not create log directory %s (%s); file logging disabled.",
            LOG_DIR,
            exc,
        )
    level = getattr(logging, LOG_LEVEL, logging.INFO)
 
    _configure_console_logger("ASR", level)
 
    for asr_logger_name in ASR_VALIDATOR_LOGGERS:
        _configure_validator_file_logger(asr_logger_name, LOG_FILE_ASR, level)
 
    for tts_logger_name in TTS_VALIDATOR_LOGGERS:
        _configure_validator_file_logger(tts_logger_name, LOG_FILE_TTS, level)
 
    for noisy in ("httpx", "httpcore", "urllib3", "multipart", "transformers"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
 
 