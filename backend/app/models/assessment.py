"""
Assessment, AssessmentInput, Prediction, and Report models.
Every record is owner-scoped. Historical report snapshots are preserved independently
of the current model version.
"""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from sqlalchemy import (
    DateTime, Enum, Float, ForeignKey, Integer, JSON, String, Text, func
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base
import enum


class AssessmentStatus(str, enum.Enum):
    created = "created"          # Just created, no inputs yet
    voice_uploaded = "voice_uploaded"    # Voice recorded/uploaded
    gait_uploaded = "gait_uploaded"     # Gait data uploaded (fusion path)
    processing = "processing"    # Inference running
    complete = "complete"        # Results available
    failed = "failed"            # Inference failed
    cancelled = "cancelled"      # User cancelled


class AssessmentPathway(str, enum.Enum):
    voice_only = "voice_only"
    voice_gait_fusion = "voice_gait_fusion"


class Assessment(Base):
    __tablename__ = "assessments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pathway: Mapped[AssessmentPathway | None] = mapped_column(Enum(AssessmentPathway))
    status: Mapped[AssessmentStatus] = mapped_column(
        Enum(AssessmentStatus), default=AssessmentStatus.created
    )
    consent_given: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Relationships
    owner: Mapped[User] = relationship(back_populates="assessments")
    voice_input: Mapped[VoiceInput | None] = relationship(back_populates="assessment", cascade="all, delete-orphan")
    gait_input: Mapped[GaitInput | None] = relationship(back_populates="assessment", cascade="all, delete-orphan")
    prediction: Mapped[Prediction | None] = relationship(back_populates="assessment", cascade="all, delete-orphan")
    report: Mapped[Report | None] = relationship(back_populates="assessment", cascade="all, delete-orphan")


class VoiceInput(Base):
    __tablename__ = "voice_inputs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assessments.id", ondelete="CASCADE"), unique=True
    )
    audio_file_path: Mapped[str | None] = mapped_column(Text)  # File stored at a private path, never exposed directly
    audio_duration_seconds: Mapped[float | None] = mapped_column(Float)
    audio_format: Mapped[str | None] = mapped_column(String(20))
    extracted_features: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    feature_extraction_version: Mapped[str | None] = mapped_column(String(50))
    quality_warnings: Mapped[list[str] | None] = mapped_column(JSON)  # list of warning strings
    is_valid: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    upload_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    assessment: Mapped[Assessment] = relationship(back_populates="voice_input")


class GaitInput(Base):
    __tablename__ = "gait_inputs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assessments.id", ondelete="CASCADE"), unique=True
    )
    gait_file_path: Mapped[str | None] = mapped_column(Text)
    original_filename: Mapped[str | None] = mapped_column(String(255))
    n_rows: Mapped[int | None] = mapped_column(Integer)
    n_cols: Mapped[int | None] = mapped_column(Integer)
    quality_warnings: Mapped[list[str] | None] = mapped_column(JSON)
    is_valid: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assessment: Mapped[Assessment] = relationship(back_populates="gait_input")


class Prediction(Base):
    """
    Stores the actual model output. Snapshot is frozen at prediction time.
    Never regenerate historical predictions from the current model.
    """
    __tablename__ = "predictions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assessments.id", ondelete="CASCADE"), unique=True
    )
    model_name: Mapped[str] = mapped_column(String(100))           # e.g. "voice_rf_v1"
    model_version: Mapped[str] = mapped_column(String(50))         # e.g. "1.0.0"
    pathway: Mapped[AssessmentPathway] = mapped_column(Enum(AssessmentPathway))
    motor_updrs_estimate: Mapped[float | None] = mapped_column(Float)  # None if inference failed
    inference_error: Mapped[str | None] = mapped_column(Text)  # error message if failed
    preprocessing_version: Mapped[str | None] = mapped_column(String(50))
    raw_output: Mapped[dict[str, Any] | None] = mapped_column(JSON)  # full model output for audit
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assessment: Mapped[Assessment] = relationship(back_populates="prediction")


class Report(Base):
    """
    Snapshot of the full report at generation time.
    Preserved independently of model updates.
    """
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assessments.id", ondelete="CASCADE"), unique=True
    )
    report_json: Mapped[dict[str, Any]] = mapped_column(JSON)  # full report content snapshot
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assessment: Mapped[Assessment] = relationship(back_populates="report")


from app.models.user import User  # noqa: E402
