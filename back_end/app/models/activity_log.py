import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, LargeBinary, String, Text, Uuid, func

from app.db import Base


class ActivityLog(Base):
    """Admin-only activity log for ASR transcribe / TTS generate (not user History)."""

    __tablename__ = "activity_logs"
    __table_args__ = (Index("ix_activity_logs_user_id", "user_id"),)

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    user_email = Column(String(255), nullable=True)
    user_name = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    activity_type = Column(String(8), nullable=False)
    file_name = Column(String(255), nullable=False)
    download_name = Column(String(512), nullable=False)
    language = Column(String(64), nullable=False)
    validator_name = Column(String(128), nullable=False, default="")
    gender = Column(String(64), nullable=False, default="")
    speaker = Column(String(16), nullable=False, default="")
    text_preview = Column(String(512), nullable=False)
    text_content = Column(Text, nullable=False)
    original_text_content = Column(Text, nullable=True)
    transcript_edits = Column(Text, nullable=False, default="{}", server_default="{}")
    edit_regions = Column(Text, nullable=False, default="[]", server_default="[]")
    linked_history_id = Column(Uuid(as_uuid=True), nullable=True)
    history_status = Column(String(16), nullable=False, default="unsaved", server_default="unsaved")
    audio_format = Column(String(32), nullable=False)
    mime_type = Column(String(128), nullable=False)
    audio_data = Column(LargeBinary, nullable=False)
