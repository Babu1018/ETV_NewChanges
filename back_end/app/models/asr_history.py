import uuid

from sqlalchemy import Column, DateTime, ForeignKey, LargeBinary, String, Text, Uuid, func

from app.db import Base


class AsrHistoryEntry(Base):
    __tablename__ = "asr_history"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    file_name = Column(String(255), nullable=False)
    download_name = Column(String(512), nullable=False)
    language = Column(String(64), nullable=False)
    validator_name = Column(String(128), nullable=False, default="")
    audio_format = Column(String(32), nullable=False)
    mime_type = Column(String(128), nullable=False)
    text_preview = Column(String(512), nullable=False)
    transcript_text = Column(Text, nullable=False)
    audio_data = Column(LargeBinary, nullable=False)
