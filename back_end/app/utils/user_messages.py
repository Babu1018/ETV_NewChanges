import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.user import User

_BULBUL_PATTERN = re.compile(r"bulbul(?:\s*[_:.]?\s*v?\d+(?:\.\d+)?)?", re.IGNORECASE)


def log_user_label(user: "User | None") -> str:
    if user is None:
        return "—"
    name = f"{user.firstname or ''} {user.lastname or ''}".strip()
    if name and user.email:
        return f"{name} ({user.email})"
    return name or user.email or "—"


def sanitize_user_message(message: str) -> str:
    """Remove vendor model names from text returned to the website UI."""
    if not message:
        return message
    cleaned = _BULBUL_PATTERN.sub("", str(message))
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.;:])", r"\1", cleaned)
    return cleaned.strip()
