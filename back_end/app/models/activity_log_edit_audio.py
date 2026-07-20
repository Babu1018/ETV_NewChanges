import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, LargeBinary, String, Uuid, func

from app.db import Base


class ActivityLogEditAudio(Base):
    """Correction audio uploaded/recorded for a TTS edit region (admin logs only)."""

    __tablename__ = "activity_log_edit_audios"
    __table_args__ = (Index("ix_activity_log_edit_audios_log_id", "activity_log_id"),)

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_log_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("activity_logs.id", ondelete="CASCADE"),
        nullable=False,
    )
    start_sec = Column(Float, nullable=False)
    end_sec = Column(Float, nullable=False)
    file_name = Column(String(255), nullable=False)
    download_name = Column(String(512), nullable=False)
    audio_format = Column(String(32), nullable=False)
    mime_type = Column(String(128), nullable=False)
    audio_data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
