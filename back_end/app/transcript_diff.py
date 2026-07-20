"""Language-agnostic transcript diff (insertions / deletions only)."""
from __future__ import annotations

from difflib import SequenceMatcher


def compute_transcript_diff(original: str, edited: str) -> dict:
    """Build segment list for admin UI: equal, add (green), remove (red)."""
    original = original or ""
    edited = edited or ""

    if original == edited:
        if not edited:
            return {"hasEdits": False, "segments": []}
        return {"hasEdits": False, "segments": [{"type": "equal", "text": edited}]}

    matcher = SequenceMatcher(None, original, edited)
    segments: list[dict] = []
    added_parts: list[str] = []
    removed_parts: list[str] = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            text = original[i1:i2]
            if text:
                segments.append({"type": "equal", "text": text})
        elif tag == "delete":
            text = original[i1:i2]
            if text:
                segments.append({"type": "remove", "text": text})
                removed_parts.append(text)
        elif tag == "insert":
            text = edited[j1:j2]
            if text:
                segments.append({"type": "add", "text": text})
                added_parts.append(text)
        elif tag == "replace":
            old_text = original[i1:i2]
            new_text = edited[j1:j2]
            if old_text:
                segments.append({"type": "remove", "text": old_text})
                removed_parts.append(old_text)
            if new_text:
                segments.append({"type": "add", "text": new_text})
                added_parts.append(new_text)

    return {
        "hasEdits": True,
        "segments": segments,
        "added": added_parts,
        "removed": removed_parts,
    }
