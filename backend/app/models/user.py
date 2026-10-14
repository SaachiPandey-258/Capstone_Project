"""
User account model.
All private records must have an explicit owner_id.
No role separation — all users have identical access to their own data only.
"""
from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, Enum, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base
import enum


class AuthProvider(str, enum.Enum):
    email = "email"
    google = "google"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(200))
    hashed_password: Mapped[str | None] = mapped_column(String(200))  # None for OAuth-only accounts
    auth_provider: Mapped[AuthProvider] = mapped_column(
        Enum(AuthProvider), default=AuthProvider.email
    )
    google_sub: Mapped[str | None] = mapped_column(String(200), unique=True, index=True)  # Google subject id
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Relationships
    assessments: Mapped[list[Assessment]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    consent_records: Mapped[list[ConsentRecord]] = relationship(back_populates="user", cascade="all, delete-orphan")
    audit_logs: Mapped[list[AuditLog]] = relationship(back_populates="user", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<User {self.email}>"


from app.models.assessment import Assessment  # noqa: E402 (avoid circular imports at top)
from app.models.consent import ConsentRecord  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
