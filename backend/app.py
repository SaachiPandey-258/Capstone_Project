import csv
import hashlib
import hmac
import io
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

from .specialists import SpecialistServiceError, search_specialists


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("APP_DATA_DIR", ROOT / ".data"))
UPLOAD_DIR = Path(os.getenv("APP_UPLOAD_DIR", ROOT / "uploads"))
DATABASE = DATA_DIR / "portal.sqlite3"
MIGRATIONS_DIR = ROOT / "migrations"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
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
        "result": None,
    }


async def read_upload(file: UploadFile, max_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    contents = await file.read(max_bytes + 1)
    if not contents:
        raise HTTPException(status_code=422, detail="Selected file is empty.")
    if len(contents) > max_bytes:
        raise HTTPException(status_code=413, detail="Each upload must be 25 MB or smaller.")
    return contents


def validate_gait(contents: bytes, filename: str) -> int:
    try:
        text = contents.decode("utf-8-sig")
        delimiter = "\t" if filename.lower().endswith(".txt") else ","
        rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
        numeric_rows = 0
        column_count = None
        for row in rows[:1001]:
            if not row or all(not cell.strip() for cell in row):
                continue
            try:
                [float(cell) for cell in row]
                if column_count is not None and len(row) != column_count:
                    raise ValueError("Sensor rows must have a consistent number of columns.")
                column_count = len(row)
                numeric_rows += 1
            except ValueError:
                header = all(
                    cell.replace("_", "").replace(" ", "").isalnum()
                    and not any(character.isdigit() for character in cell)
                    for cell in row
                )
                if numeric_rows != 0 or not header:
                    raise
        if numeric_rows < 2:
            raise ValueError("At least two numeric data rows are required.")
        return numeric_rows
    except (UnicodeDecodeError, csv.Error, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail="Gait data must be a readable CSV or tab-delimited text file with numeric sensor rows.",
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
    user: Dict[str, str] = Depends(current_user),
) -> Dict[str, object]:
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
    gait_rows = None
    if gait is not None:
        gait_name = (gait.filename or "").lower()
        if Path(gait_name).suffix not in (".csv", ".txt"):
            raise HTTPException(status_code=422, detail="Gait data must be a CSV or TXT file.")
        gait_data = await read_upload(gait)
        gait_rows = validate_gait(gait_data, gait_name)

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

    reason = (
        "Feature validation required: raw browser audio cannot currently be mapped to "
        "the complete 16-feature training schema. RPDE, DFA, and PPE have no validated "
        "audio extractor or reference fixtures. The upload is saved, but no scaler or "
        "model inference was run and no prediction or score was produced."
    )
    created_at = utc_now().isoformat()
    with connect() as db:
        db.execute(
            """INSERT INTO assessments
               (id, user_id, modality, status, unavailable_reason, created_at, consent_version,
                consented_at, duration_seconds, files_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                assessment_id,
                user["id"],
                modality,
                "validation_required",
                reason,
                created_at,
                "v1",
                created_at,
                duration_seconds,
                json.dumps(files),
            ),
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
    category: str = Query(..., pattern="^(neurology|movement-disorders|physical-therapy)$"),
    radius: int = Query(..., ge=1, le=100),
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
