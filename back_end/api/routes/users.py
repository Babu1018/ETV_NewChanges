import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_admin_user, get_current_user
from app.auth.passwords import hash_password
from app.auth.roles import ROLE_ADMIN, ROLE_USER, is_admin_role
from app.db import get_db
from app.models.activity_log import ActivityLog
from app.models.asr_history import AsrHistoryEntry
from app.models.password_reset import PasswordResetOtp
from app.models.tts_history import TtsHistoryEntry
from app.models.user import User

router = APIRouter(prefix="/api/users", tags=["users"])

VALID_ROLES = frozenset({ROLE_USER, ROLE_ADMIN})


class UserProfile(BaseModel):
    id: str
    email: str
    firstname: str
    lastname: str
    contactno: str | None = None
    dob: str | None = None
    place: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    gender: str | None = None
    role: str = "user"

    model_config = {"from_attributes": True}


def user_to_profile(user: User) -> UserProfile:
    return UserProfile(
        id=str(user.id),
        email=user.email,
        firstname=user.firstname,
        lastname=user.lastname,
        contactno=user.contactno,
        dob=user.dob.isoformat() if user.dob else None,
        place=user.place,
        city=user.city,
        state=user.state,
        pincode=user.pincode,
        gender=user.gender,
        role=user.role or "user",
    )


@router.get("/me", response_model=UserProfile)
def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    del db
    return user_to_profile(current_user)


class UserListItem(BaseModel):
    id: str
    email: str
    firstname: str
    lastname: str
    role: str
    is_active: bool
    created_at: str | None = None

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    items: list[UserListItem]
    total: int


class AdminCreateUserBody(BaseModel):
    firstname: str = Field(..., min_length=1, max_length=128)
    lastname: str = Field(..., min_length=1, max_length=128)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    role: str = ROLE_USER


class AdminUpdateUserBody(BaseModel):
    role: str | None = None
    is_active: bool | None = None


def user_to_list_item(user: User) -> UserListItem:
    return UserListItem(
        id=str(user.id),
        email=user.email,
        firstname=user.firstname,
        lastname=user.lastname,
        role=user.role or ROLE_USER,
        is_active=bool(user.is_active),
        created_at=user.created_at.isoformat() if user.created_at else None,
    )


def _normalize_role(role: str) -> str:
    normalized = (role or ROLE_USER).strip().lower()
    if normalized not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Role must be 'user' or 'admin'")
    return normalized


def _get_user_or_404(db: Session, user_id: str) -> User:
    try:
        uid = uuid.UUID(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid user id") from exc
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("", response_model=UserListResponse)
def list_users(
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    users = db.query(User).order_by(User.created_at.desc()).all()
    items = [user_to_list_item(user) for user in users]
    return UserListResponse(items=items, total=len(items))


@router.post("", response_model=UserListItem, status_code=201)
def create_user(
    body: AdminCreateUserBody,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    email = body.email.strip().lower()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    role = _normalize_role(body.role)
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        firstname=body.firstname.strip(),
        lastname=body.lastname.strip(),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_to_list_item(user)


@router.patch("/{user_id}", response_model=UserListItem)
def update_user(
    user_id: str,
    body: AdminUpdateUserBody,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    if body.role is None and body.is_active is None:
        raise HTTPException(status_code=400, detail="No fields to update")

    user = _get_user_or_404(db, user_id)
    is_self = str(user.id) == str(admin.id)

    if body.role is not None:
        new_role = _normalize_role(body.role)
        if is_self and is_admin_role(user.role) and new_role != ROLE_ADMIN:
            raise HTTPException(status_code=400, detail="You cannot remove your own admin role")
        user.role = new_role

    if body.is_active is not None:
        if is_self and not body.is_active:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
        user.is_active = body.is_active

    db.commit()
    db.refresh(user)
    return user_to_list_item(user)


def _purge_user_related_data(db: Session, user: User) -> None:
    display_name = f"{user.firstname or ''} {user.lastname or ''}".strip() or user.email or "—"
    (
        db.query(ActivityLog)
        .filter(ActivityLog.user_id == user.id)
        .update(
            {
                ActivityLog.user_id: None,
                ActivityLog.user_email: user.email,
                ActivityLog.user_name: display_name,
            },
            synchronize_session=False,
        )
    )
    db.query(AsrHistoryEntry).filter(AsrHistoryEntry.user_id == user.id).delete(synchronize_session=False)
    db.query(TtsHistoryEntry).filter(TtsHistoryEntry.user_id == user.id).delete(synchronize_session=False)
    db.query(PasswordResetOtp).filter(PasswordResetOtp.email == user.email).delete(synchronize_session=False)


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: str,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    user = _get_user_or_404(db, user_id)
    if str(user.id) == str(admin.id):
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    if is_admin_role(user.role):
        admin_count = db.query(User).filter(User.role == ROLE_ADMIN).count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the only admin account")

    _purge_user_related_data(db, user)
    db.delete(user)
    db.commit()
    return Response(status_code=204)
