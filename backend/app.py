import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.exceptions import GoogleAuthError
from pydantic import BaseModel, EmailStr, Field

from .audio_features import AudioExtractionError, extract_audio_features
from scripts.feature_contract import VOICE_FEATURE_COLUMNS
from scripts.gait_contract import parse_gait_full, parse_gait_recording
from scripts.gait_features import GaitFeatureError, gait_features
from scripts.inference import (
    ModelNotReadyError,
    _load_fusion_model,
    load_pd_classifier,
    PD_CLASSIFIER_VERSION,
    load_voice_model,
    predict_fusion_features,
    predict_pd_screening,
    predict_pd_screening_audio,
    predict_pd_screening_gait,
    fuse_screenings,
    load_audio_classifier,
    load_gait_classifier,
    predict_voice_features,
    updrs_severity_band,
    voice_model_mae,
    UPDRS_MOTOR_MAX,
    VOICE_MODEL_FILENAME,
    VOICE_MODEL_VERSION,
)
from .specialists import SpecialistServiceError, search_specialists


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("APP_DATA_DIR", ROOT / ".data"))
UPLOAD_DIR = Path(os.getenv("APP_UPLOAD_DIR", ROOT / "uploads"))
DATABASE = DATA_DIR / "portal.sqlite3"
MIGRATIONS_DIR = ROOT / "migrations"
MODEL_ARTIFACTS_DIR = Path(
    os.getenv("MODEL_ARTIFACTS_DIR") or ROOT.parent / "models"
)
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
PATIENT_SEXES = ("female", "male", "other", "prefer_not_to_say")
TOKEN_TTL = timedelta(days=30)

@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title="Multimodal Parkinson's Assessment API", version="1.0.0", lifespan=lifespan
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
bearer = HTTPBearer(auto_error=False)


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class GoogleCredential(BaseModel):
    credential: str = Field(min_length=1)


class VoiceFeatureRequest(BaseModel):
    feature_columns: List[str] = Field(min_length=16, max_length=16)
    features: List[float] = Field(min_length=16, max_length=16)


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(DATABASE), timeout=10, factory=ClosingConnection)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    with connect() as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        migrations = sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.sql"))
        for migration in migrations:
            migration_version = int(migration.name.split("_", 1)[0])
            if migration_version <= version:
                continue
            if migration_version != version + 1:
                raise RuntimeError(
                    f"Database migration sequence has a gap before version {migration_version}."
                )
            script = migration.read_text(encoding="utf-8")
            db.executescript(
                "BEGIN IMMEDIATE;\n"
                f"{script}\n"
                f"PRAGMA user_version = {migration_version};\n"
                "COMMIT;"
            )
            version = migration_version


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def public_user(row: sqlite3.Row) -> Dict[str, str]:
    return {"id": row["id"], "email": row["email"], "name": row["name"]}


def password_digest(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), 310_000
    ).hex()


def new_session(db: sqlite3.Connection, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (
            hashlib.sha256(token.encode()).hexdigest(),
            user_id,
            (utc_now() + TOKEN_TTL).isoformat(),
        ),
    )
    return token


def current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> Dict[str, str]:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    token_hash = hashlib.sha256(credentials.credentials.encode()).hexdigest()
    with connect() as db:
        row = db.execute(
            """SELECT users.* FROM users JOIN sessions ON users.id = sessions.user_id
               WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
            (token_hash, utc_now().isoformat()),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Your session has expired. Sign in again.")
    return public_user(row)


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/models/status")
def model_status() -> Dict[str, object]:
    voice_available = True
    voice_reason = None
    try:
        load_voice_model(str(MODEL_ARTIFACTS_DIR / VOICE_MODEL_FILENAME))
    except ModelNotReadyError as exc:
        voice_available = False
        voice_reason = str(exc)

    screening_available = True
    screening_reason = None
    try:
        load_pd_classifier(str(MODEL_ARTIFACTS_DIR / "pd_classifier.pkl"))
    except ModelNotReadyError as exc:
        screening_available = False
        screening_reason = str(exc)

    audio_screening_available = True
    audio_screening_reason = None
    try:
        load_audio_classifier(str(MODEL_ARTIFACTS_DIR / "pd_audio_classifier.pkl"))
    except ModelNotReadyError as exc:
        audio_screening_available = False
        audio_screening_reason = str(exc)

    gait_screening_available = True
    gait_screening_reason = None
    try:
        load_gait_classifier(str(MODEL_ARTIFACTS_DIR / "pd_gait_classifier.pkl"))
    except ModelNotReadyError as exc:
        gait_screening_available = False
        gait_screening_reason = str(exc)

    fusion_artifacts_available = False
    fusion_reason = "Fusion checkpoint and scaler artifacts are unavailable."
    try:
        _load_fusion_model(str(MODEL_ARTIFACTS_DIR))
        fusion_artifacts_available = True
        fusion_reason = "Compatible fusion checkpoint, scaler, and 200x19 gait contract are available."
    except ModelNotReadyError as exc:
        fusion_reason = f"Fusion inference unavailable: {exc}"
    return {
        "voice": {
            "artifact_available": voice_available,
            "precomputed_features_supported": True,
            "raw_audio_inference_available": True,
            "reason": voice_reason,
        },
        "screening": {
            "artifact_available": screening_available,
            "reason": screening_reason,
            "audio_artifact_available": audio_screening_available,
            "audio_reason": audio_screening_reason,
            "gait_artifact_available": gait_screening_available,
            "gait_reason": gait_screening_reason,
        },
        "fusion": {
            "artifact_files_available": fusion_artifacts_available,
            "portal_inference_available": fusion_artifacts_available,
            "reason": fusion_reason,
        },
    }


@app.post("/api/research/predict-voice-features")
def predict_precomputed_voice_features(
    body: VoiceFeatureRequest,
    _: Dict[str, str] = Depends(current_user),
) -> Dict[str, object]:
    if body.feature_columns != list(VOICE_FEATURE_COLUMNS):
        raise HTTPException(
            status_code=422,
            detail="Voice feature columns must match the documented 16-feature order.",
        )
    try:
        prediction = predict_voice_features(
            [body.features], str(MODEL_ARTIFACTS_DIR / VOICE_MODEL_FILENAME)
        )
    except ModelNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "model": VOICE_MODEL_VERSION,
        "target": "motor_UPDRS",
        "prediction": float(prediction[0]),
        "is_diagnostic": False,
        "notice": (
            "Exploratory research estimate from precomputed acoustic features; "
            "not a diagnosis, clinical score, or substitute for professional care."
        ),
    }


@app.post("/api/auth/register", status_code=201)
def register(credentials: Credentials) -> Dict[str, object]:
    salt = secrets.token_hex(16)
    user_id = str(uuid.uuid4())
    name = credentials.email.split("@", 1)[0]
    try:
        with connect() as db:
            db.execute(
                """INSERT INTO users (id, email, name, password_hash, password_salt, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    user_id,
                    credentials.email.lower(),
                    name,
                    password_digest(credentials.password, salt),
                    salt,
                    utc_now().isoformat(),
                ),
            )
            token = new_session(db, user_id)
            row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    return {"access_token": token, "user": public_user(row)}


@app.post("/api/auth/login")
def login(credentials: Credentials) -> Dict[str, object]:
    with connect() as db:
        row = db.execute(
            "SELECT * FROM users WHERE email = ?", (credentials.email.lower(),)
        ).fetchone()
        if (
            row is None
            or row["password_hash"] is None
            or not hmac.compare_digest(
                password_digest(credentials.password, row["password_salt"]),
                row["password_hash"],
            )
        ):
            raise HTTPException(status_code=401, detail="Email or password is incorrect.")
        token = new_session(db, row["id"])
    return {"access_token": token, "user": public_user(row)}


@app.post("/api/auth/google")
def google_login(body: GoogleCredential) -> Dict[str, object]:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured.")
    try:
        from google.auth.transport import requests
        from google.oauth2 import id_token

        identity = id_token.verify_oauth2_token(
            body.credential, requests.Request(), audience=client_id
        )
    except (ImportError, ValueError, GoogleAuthError):
        raise HTTPException(status_code=401, detail="Google could not verify this sign-in.")
    email = identity.get("email")
    subject = identity.get("sub")
    if not email or not subject or not identity.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google did not provide a verified email.")
    with connect() as db:
        row = db.execute(
            "SELECT * FROM users WHERE google_subject = ?", (subject,)
        ).fetchone()
        if row is None:
            row = db.execute(
                "SELECT * FROM users WHERE email = ?", (email.lower(),)
            ).fetchone()
            if row is not None and row["google_subject"] not in (None, subject):
                raise HTTPException(
                    status_code=409,
                    detail="This email is linked to a different Google account.",
                )
        if row is None:
            user_id = str(uuid.uuid4())
            db.execute(
                """INSERT INTO users (id, email, name, google_subject, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    user_id,
                    email.lower(),
                    identity.get("name") or email.split("@", 1)[0],
                    subject,
                    utc_now().isoformat(),
                ),
            )
            row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        elif row["google_subject"] is None:
            db.execute(
                "UPDATE users SET google_subject = ? WHERE id = ?", (subject, row["id"])
            )
            row = db.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
        token = new_session(db, row["id"])
    return {"access_token": token, "user": public_user(row)}


@app.get("/api/auth/me")
def who_am_i(user: Dict[str, str] = Depends(current_user)) -> Dict[str, str]:
    return user


@app.post("/api/auth/logout", status_code=204)
def logout(
    request: Request, user: Dict[str, str] = Depends(current_user)
) -> None:
    authorization = request.headers.get("authorization", "")
    token_hash = hashlib.sha256(authorization.removeprefix("Bearer ").encode()).hexdigest()
    with connect() as db:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


def serialize_assessment(row: sqlite3.Row) -> Dict[str, object]:
    return {
        "id": row["id"],
        "modality": row["modality"],
        "status": row["status"],
        "unavailable_reason": row["unavailable_reason"],
        "created_at": row["created_at"],
        "consent_version": row["consent_version"],
        "consented_at": row["consented_at"],
        "duration_seconds": row["duration_seconds"],
        "files": json.loads(row["files_json"]),
        "extracted_features": (
            json.loads(row["extracted_features_json"])
            if row["extracted_features_json"] else None
        ),
        "extraction_version": row["extraction_version"],
        "quality": json.loads(row["quality_json"]) if row["quality_json"] else None,
        "result": json.loads(row["result_json"]) if row["result_json"] else None,
        "patient": json.loads(row["patient_json"]) if row["patient_json"] else None,
    }


def parse_patient(
    full_name: str, age: Optional[int], sex: Optional[str], location: Optional[str]
) -> Dict[str, object]:
    name = (full_name or "").strip()
    if not 1 <= len(name) <= 120:
        raise HTTPException(status_code=422, detail="Enter the participant's full name (up to 120 characters).")
    if age is not None and not 1 <= age <= 120:
        raise HTTPException(status_code=422, detail="Age must be between 1 and 120.")
    sex = (sex or "").strip().lower() or None
    if sex is not None and sex not in PATIENT_SEXES:
        raise HTTPException(status_code=422, detail="Choose a supported option for sex.")
    location = (location or "").strip() or None
    if location is not None and len(location) > 160:
        raise HTTPException(status_code=422, detail="Location must be 160 characters or fewer.")
    return {"full_name": name, "age": age, "sex": sex, "location": location}


def build_result(
    vocal_row: List[float], prediction: float, model: str, summary: str,
    spectral: Optional[Dict[str, float]] = None, gait_data: Optional[bytes] = None,
    gait_name: str = "", **extra: object
) -> Dict[str, object]:
    """Combine the UPDRS estimate with the voice screening classifier.

    Recorded audio is screened with the spectral model trained on phone
    recordings processed by this extractor; submitted feature values (lab
    measurements) use the lab-feature model.
    """
    from_audio = bool(extra.pop("from_audio", False))
    result: Dict[str, object] = {
        "summary": summary,
        "model": model,
        "target": "motor_UPDRS",
        "prediction": prediction,
        "updrs_scale_max": UPDRS_MOTOR_MAX,
        "severity_band": updrs_severity_band(prediction),
        **extra,
        "is_diagnostic": False,
        "notice": "Research output only; not a diagnosis, clinical score, or substitute for professional care.",
    }
    if model == VOICE_MODEL_VERSION:
        try:
            result["prediction_mae"] = voice_model_mae(str(MODEL_ARTIFACTS_DIR / VOICE_MODEL_FILENAME))
        except ModelNotReadyError:
            pass
    try:
        if spectral is None and from_audio:
            raise ValueError("spectral voice measures could not be computed from this recording")
        if spectral is not None:
            screening = predict_pd_screening_audio(spectral, str(MODEL_ARTIFACTS_DIR / "pd_audio_classifier.pkl"))
        else:
            screening = predict_pd_screening([vocal_row], str(MODEL_ARTIFACTS_DIR / "pd_classifier.pkl"))
        voice_part = _screening_summary(screening)
        if gait_data is not None:
            # Voice + gait: the headline verdict is the late fusion of both models.
            try:
                features = gait_features(parse_gait_full(gait_data, gait_name))
                gait = predict_pd_screening_gait(features, str(MODEL_ARTIFACTS_DIR / "pd_gait_classifier.pkl"))
                combined = fuse_screenings(screening, gait)
                result.update({
                    "screening_basis": "voice_gait",
                    "voice_screening": voice_part,
                    "gait_screening": _screening_summary(gait),
                    "gait_features": features,
                })
                screening = combined
            except (GaitFeatureError, ModelNotReadyError, ValueError, RuntimeError) as exc:
                result["screening_basis"] = "voice"
                result["gait_screening_unavailable_reason"] = str(exc)
        else:
            result["screening_basis"] = "voice"
        result.update({
            "screening_model": screening["model_version"],
            "pd_probability": screening["probability"],
            "screening_tier": screening["tier"],
            "pd_detected": {"detected": True, "not_detected": False}.get(screening["tier"]),
            "pd_low_threshold": screening["low_threshold"],
            "pd_high_threshold": screening["high_threshold"],
            "screening_error_rates": screening["tier_rates"],
        })
    except (ModelNotReadyError, ValueError, RuntimeError) as exc:
        result["screening_unavailable_reason"] = str(exc)
    return result


def _screening_summary(screening: Dict[str, object]) -> Dict[str, object]:
    return {
        "model": screening["model_version"],
        "probability": screening["probability"],
        "tier": screening["tier"],
        "low_threshold": screening["low_threshold"],
        "high_threshold": screening["high_threshold"],
    }


async def read_upload(file: UploadFile, max_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    contents = await file.read(max_bytes + 1)
    if not contents:
        raise HTTPException(status_code=422, detail="Selected file is empty.")
    if len(contents) > max_bytes:
        raise HTTPException(status_code=413, detail="Each upload must be 25 MB or smaller.")
    return contents


def validate_gait(contents: bytes, filename: str) -> tuple[object, int]:
    try:
        return parse_gait_recording(contents, filename)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Gait validation failed: {exc}",
        ) from exc


def validate_audio(contents: bytes, filename: str) -> None:
    suffix = Path(filename.lower()).suffix
    valid = {
        ".webm": contents.startswith(b"\x1aE\xdf\xa3"),
        ".wav": len(contents) >= 12 and contents.startswith(b"RIFF") and contents[8:12] == b"WAVE",
        ".ogg": contents.startswith(b"OggS"),
        ".mp3": contents.startswith(b"ID3")
        or (len(contents) >= 2 and contents[0] == 0xFF and contents[1] & 0xE0 == 0xE0),
        ".m4a": len(contents) >= 8 and contents[4:8] == b"ftyp",
    }
    if not valid.get(suffix, False):
        raise HTTPException(
            status_code=422,
            detail="The selected voice file does not match a supported audio format.",
        )


@app.post("/api/assessments", status_code=201)
async def create_assessment(
    modality: str = Form(...),
    consent: bool = Form(...),
    duration_seconds: float = Form(...),
    voice: UploadFile = File(...),
    gait: Optional[UploadFile] = File(None),
    patient_name: str = Form(""),
    patient_age: Optional[int] = Form(None),
    patient_sex: Optional[str] = Form(None),
    patient_location: Optional[str] = Form(None),
    user: Dict[str, str] = Depends(current_user),
) -> Dict[str, object]:
    patient = parse_patient(patient_name or user["name"], patient_age, patient_sex, patient_location)
    if not consent:
        raise HTTPException(status_code=422, detail="Consent is required before uploading.")
    if modality not in ("voice", "voice_gait"):
        raise HTTPException(status_code=422, detail="Choose voice-only or voice and gait.")
    if duration_seconds < 3 or duration_seconds > 60:
        raise HTTPException(status_code=422, detail="Voice recording must be 3–60 seconds.")
    if modality == "voice_gait" and gait is None:
        raise HTTPException(status_code=422, detail="A valid gait file is required for fusion.")
    if modality == "voice" and gait is not None:
        raise HTTPException(status_code=422, detail="Gait data was provided for voice-only analysis.")
    voice_name = (voice.filename or "").lower()
    if Path(voice_name).suffix not in (".webm", ".wav", ".ogg", ".mp3", ".m4a"):
        raise HTTPException(status_code=422, detail="Use a WebM, WAV, OGG, MP3, or M4A voice file.")
    voice_data = await read_upload(voice)
    validate_audio(voice_data, voice_name)
    gait_data = None
    gait_window = None
    gait_rows = None
    if gait is not None:
        gait_name = (gait.filename or "").lower()
        if Path(gait_name).suffix not in (".csv", ".txt"):
            raise HTTPException(status_code=422, detail="Gait data must be a CSV or TXT file.")
        gait_data = await read_upload(gait)
        gait_window, gait_rows = validate_gait(gait_data, gait_name)

    assessment_id = str(uuid.uuid4())
    user_dir = UPLOAD_DIR / user["id"]
    user_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for kind, upload, content in (
        ("voice", voice, voice_data),
        ("gait", gait, gait_data),
    ):
        if upload is None or content is None:
            continue
        suffix = Path(upload.filename or "").suffix.lower()
        (user_dir / f"{assessment_id}-{kind}{suffix}").write_bytes(content)
        files.append(
            {
                "kind": kind,
                "name": Path(upload.filename or f"{kind}{suffix}").name,
                "bytes": len(content),
                "validated_rows": gait_rows if kind == "gait" else None,
            }
        )

    extracted = None
    extraction_version = None
    quality = None
    prediction = None
    reason = None
    result = None
    if modality == "voice_gait":
        try:
            extraction = extract_audio_features(
                voice_data, Path(voice_name).suffix, duration_hint=duration_seconds
            )
            if any(extraction.features[column] is None for column in VOICE_FEATURE_COLUMNS):
                raise ValueError(
                    "RPDE, DFA and PPE could not be computed from this recording, and the "
                    "voice + gait fusion model requires all 16 features; try voice-only"
                )
            prediction = float(predict_fusion_features(
                [[extraction.features[column] for column in VOICE_FEATURE_COLUMNS]],
                gait_window,
                str(MODEL_ARTIFACTS_DIR),
            )[0])
            extracted = {**extraction.features, **(extraction.spectral or {})}
            extraction_version = extraction.version
            quality = extraction.quality
            result = build_result(
                [extraction.features[column] for column in VOICE_FEATURE_COLUMNS],
                prediction,
                "dual-branch-fusion-updrs-v1",
                "Exploratory research estimate from validated voice and gait windows; not a diagnosis or clinical assessment.",
                spectral=extraction.spectral,
                from_audio=True,
                gait_data=gait_data,
                gait_name=gait_name,
                gait_window="first 200 rows of the validated 19-column recording",
            )
        except AudioExtractionError as exc:
            reason = f"Feature validation required: {exc} No prediction or score was produced."
            quality = {"quality_status": "validation_required", "reason": str(exc)}
        except ModelNotReadyError as exc:
            reason = f"Analysis unavailable: {exc} No prediction or score was produced."
            quality = {"quality_status": "artifact_unavailable", "reason": str(exc)}
        except (TypeError, ValueError, RuntimeError) as exc:
            reason = f"Analysis unavailable: gait or model validation failed ({exc}). No prediction or score was produced."
            quality = {"quality_status": "validation_required", "reason": str(exc)}
    else:
        try:
            extraction = extract_audio_features(
                voice_data, Path(voice_name).suffix, duration_hint=duration_seconds
            )
            prediction = float(predict_voice_features(
                [list(extraction.features[column] for column in VOICE_FEATURE_COLUMNS)],
                str(MODEL_ARTIFACTS_DIR / VOICE_MODEL_FILENAME),
            )[0])
            extracted = {**extraction.features, **(extraction.spectral or {})}
            extraction_version = extraction.version
            quality = extraction.quality
            result = build_result(
                [extraction.features[column] for column in VOICE_FEATURE_COLUMNS],
                prediction,
                VOICE_MODEL_VERSION,
                "Exploratory research estimate from extracted acoustic features; not a diagnosis or clinical assessment.",
                spectral=extraction.spectral,
                from_audio=True,
            )
        except AudioExtractionError as exc:
            reason = f"Feature validation required: {exc} No prediction or score was produced."
            quality = {"quality_status": "validation_required", "reason": str(exc)}
        except ModelNotReadyError as exc:
            reason = f"Analysis unavailable: {exc} No prediction or score was produced."
            quality = {"quality_status": "artifact_unavailable", "reason": str(exc)}
        except (TypeError, ValueError, RuntimeError) as exc:
            reason = f"Analysis unavailable: feature or model validation failed ({exc}). No prediction or score was produced."
            quality = {"quality_status": "validation_required", "reason": str(exc)}
    completed = result is not None
    created_at = utc_now().isoformat()
    with connect() as db:
        db.execute(
            """INSERT INTO assessments
               (id, user_id, modality, status, unavailable_reason, created_at, consent_version,
                consented_at, duration_seconds, files_json, result_json,
                extracted_features_json, extraction_version, quality_json, patient_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                assessment_id,
                user["id"],
                modality,
                "completed" if completed else (
                    "unavailable" if quality and quality.get("quality_status") == "artifact_unavailable"
                    else "validation_required"
                ),
                reason,
                created_at,
                "v1",
                created_at,
                duration_seconds,
                json.dumps(files),
                json.dumps(result) if result else None,
                json.dumps(extracted) if extracted is not None else None,
                extraction_version,
                json.dumps(quality) if quality else None,
                json.dumps(patient),
            ),
        )
        row = db.execute("SELECT * FROM assessments WHERE id = ?", (assessment_id,)).fetchone()
    return serialize_assessment(row)


@app.post("/api/assessments/manual", status_code=201)
async def create_manual_assessment(
    modality: str = Form(...),
    consent: bool = Form(...),
    feature_columns: str = Form(...),
    features: str = Form(...),
    gait: Optional[UploadFile] = File(None),
    patient_name: str = Form(""),
    patient_age: Optional[int] = Form(None),
    patient_sex: Optional[str] = Form(None),
    patient_location: Optional[str] = Form(None),
    user: Dict[str, str] = Depends(current_user),
) -> Dict[str, object]:
    """Persist exact vocal features and explicitly fail closed for fusion."""
    patient = parse_patient(patient_name or user["name"], patient_age, patient_sex, patient_location)
    if not consent:
        raise HTTPException(status_code=422, detail="Consent is required before uploading.")
    if modality not in ("voice", "voice_gait"):
        raise HTTPException(status_code=422, detail="Choose voice-only or voice and gait.")
    try:
        columns = json.loads(feature_columns)
        values = json.loads(features)
    except (TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Voice features must be valid JSON.") from exc
    if columns != list(VOICE_FEATURE_COLUMNS):
        raise HTTPException(status_code=422, detail="Voice feature columns must match the documented 16-feature order.")
    if not isinstance(values, list) or len(values) != len(VOICE_FEATURE_COLUMNS):
        raise HTTPException(status_code=422, detail="Exactly 16 numeric voice features are required.")

    prediction = None
    unavailable_reason = None
    try:
        prediction = float(predict_voice_features(
            [values], str(MODEL_ARTIFACTS_DIR / VOICE_MODEL_FILENAME)
        )[0])
    except ModelNotReadyError as exc:
        unavailable_reason = f"Analysis unavailable: {exc} No prediction or score was produced."
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    gait_data = None
    gait_window = None
    gait_rows = None
    if modality == "voice_gait" and gait is None:
        raise HTTPException(status_code=422, detail="A valid gait file is required for voice + gait.")
    if gait is not None:
        gait_name = (gait.filename or "").lower()
        if Path(gait_name).suffix not in (".csv", ".txt"):
            raise HTTPException(status_code=422, detail="Gait data must be a CSV or TXT file.")
        gait_data = await read_upload(gait)
        gait_window, gait_rows = validate_gait(gait_data, gait_name)

    assessment_id = str(uuid.uuid4())
    user_dir = UPLOAD_DIR / user["id"]
    user_dir.mkdir(parents=True, exist_ok=True)
    files = [{
        "kind": "voice_features",
        "name": "manual-feature-form",
        "bytes": len(json.dumps(values)),
        "validated_rows": None,
    }]
    if gait is not None and gait_data is not None:
        suffix = Path(gait.filename or "").suffix.lower()
        (user_dir / f"{assessment_id}-gait{suffix}").write_bytes(gait_data)
        files.append({
            "kind": "gait",
            "name": Path(gait.filename or f"gait{suffix}").name,
            "bytes": len(gait_data),
            "validated_rows": gait_rows,
        })

    fusion_reason = None
    if modality == "voice_gait":
        try:
            prediction = float(predict_fusion_features(
                [values], gait_window, str(MODEL_ARTIFACTS_DIR)
            )[0])
        except ModelNotReadyError as exc:
            fusion_reason = f"Analysis unavailable: {exc} No prediction or score was produced."
        except (TypeError, ValueError, RuntimeError) as exc:
            fusion_reason = f"Analysis unavailable: gait or model validation failed ({exc}). No prediction or score was produced."
    completed = prediction is not None
    reason = None if completed else (fusion_reason if modality == "voice_gait" else unavailable_reason)
    result = None if not completed else build_result(
        [float(value) for value in values],
        prediction,
        "dual-branch-fusion-updrs-v1" if modality == "voice_gait" else VOICE_MODEL_VERSION,
        "Exploratory research estimate from the submitted 16-feature vocal contract; not a diagnosis or clinical assessment.",
        gait_data=gait_data if modality == "voice_gait" else None,
        gait_name=(gait.filename or "").lower() if gait is not None else "",
    )
    created_at = utc_now().isoformat()
    with connect() as db:
        db.execute(
            """INSERT INTO assessments
               (id, user_id, modality, status, unavailable_reason, created_at, consent_version,
                consented_at, duration_seconds, files_json, result_json,
                extracted_features_json, patient_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (assessment_id, user["id"], modality, "completed" if completed else "unavailable",
             reason, created_at, "v1", created_at, 0, json.dumps(files),
             json.dumps(result) if result else None,
             json.dumps(dict(zip(VOICE_FEATURE_COLUMNS, values))), json.dumps(patient)),
        )
        row = db.execute("SELECT * FROM assessments WHERE id = ?", (assessment_id,)).fetchone()
    return serialize_assessment(row)


@app.get("/api/assessments")
def list_assessments(user: Dict[str, str] = Depends(current_user)) -> List[Dict[str, object]]:
    with connect() as db:
        rows = db.execute(
            "SELECT * FROM assessments WHERE user_id = ? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
    return [serialize_assessment(row) for row in rows]


@app.get("/api/assessments/{assessment_id}")
def get_assessment(
    assessment_id: str, user: Dict[str, str] = Depends(current_user)
) -> Dict[str, object]:
    with connect() as db:
        row = db.execute(
            "SELECT * FROM assessments WHERE id = ? AND user_id = ?",
            (assessment_id, user["id"]),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Assessment not found.")
    return serialize_assessment(row)


@app.delete("/api/assessments/{assessment_id}", status_code=204)
def delete_assessment(
    assessment_id: str, user: Dict[str, str] = Depends(current_user)
) -> None:
    """Permanently delete one of the user's assessments and its uploaded files."""
    with connect() as db:
        deleted = db.execute(
            "DELETE FROM assessments WHERE id = ? AND user_id = ?",
            (assessment_id, user["id"]),
        ).rowcount
    if not deleted:
        raise HTTPException(status_code=404, detail="Assessment not found.")
    user_dir = UPLOAD_DIR / user["id"]
    try:
        uuid.UUID(assessment_id)
    except ValueError:
        return
    for path in user_dir.glob(f"{assessment_id}-*"):
        path.unlink(missing_ok=True)


@app.get("/api/reports")
def list_reports(user: Dict[str, str] = Depends(current_user)) -> List[Dict[str, object]]:
    with connect() as db:
        rows = db.execute(
            """SELECT * FROM assessments
               WHERE user_id = ? AND status = 'completed' ORDER BY created_at DESC""",
            (user["id"],),
        ).fetchall()
    return [serialize_assessment(row) for row in rows]


@app.get("/api/reports/{assessment_id}")
def get_report(
    assessment_id: str, user: Dict[str, str] = Depends(current_user)
) -> Dict[str, object]:
    with connect() as db:
        row = db.execute(
            """SELECT * FROM assessments WHERE id = ? AND user_id = ? AND status = 'completed'""",
            (assessment_id, user["id"]),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="No completed report is available for this assessment.")
    return serialize_assessment(row)


@app.get("/api/dashboard")
def dashboard(user: Dict[str, str] = Depends(current_user)) -> Dict[str, object]:
    with connect() as db:
        rows = db.execute(
            "SELECT * FROM assessments WHERE user_id = ? ORDER BY created_at DESC LIMIT 5",
            (user["id"],),
        ).fetchall()
        total = db.execute(
            "SELECT COUNT(*) AS count FROM assessments WHERE user_id = ?", (user["id"],)
        ).fetchone()["count"]
        reports = db.execute(
            """SELECT COUNT(*) AS count FROM assessments
               WHERE user_id = ? AND status = 'completed'""",
            (user["id"],),
        ).fetchone()["count"]
    return {
        "assessment_count": total,
        "report_count": reports,
        "recent_assessments": [serialize_assessment(row) for row in rows],
    }


@app.get("/api/specialists")
def find_specialists(
    location: str = Query(..., min_length=2, max_length=120),
    category: str = Query(
        ...,
        pattern="^(parkinsons-care|neurology|movement-disorders|physical-therapy|hospitals-clinics|organizations)$",
    ),
    radius: int = Query(..., ge=1, le=500, description="Search radius in kilometres."),
    latitude: Optional[float] = Query(None, ge=-90, le=90),
    longitude: Optional[float] = Query(None, ge=-180, le=180),
    user: Dict[str, str] = Depends(current_user),
) -> Dict[str, object]:
    if (latitude is None) != (longitude is None):
        raise HTTPException(
            status_code=422, detail="Both latitude and longitude are required together."
        )
    try:
        return search_specialists(
            location, category, radius, latitude=latitude, longitude=longitude
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except SpecialistServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
