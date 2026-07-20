import uuid

from sqlalchemy import Boolean, Column, Date, DateTime, String, Uuid, func

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    firstname = Column(String(128), nullable=False)
    lastname = Column(String(128), nullable=False)
    contactno = Column(String(32), nullable=True)
    dob = Column(Date, nullable=True)
    place = Column(String(128), nullable=True)
    city = Column(String(128), nullable=True)
    state = Column(String(128), nullable=True)
    pincode = Column(String(16), nullable=True)
    gender = Column(String(32), nullable=True)
    role = Column(String(32), nullable=False, default="user", server_default="user")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
