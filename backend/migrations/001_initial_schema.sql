CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT,
    password_salt TEXT,
    google_subject TEXT UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    modality TEXT NOT NULL,
    status TEXT NOT NULL,
    unavailable_reason TEXT,
    created_at TEXT NOT NULL,
    consent_version TEXT NOT NULL,
    consented_at TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    files_json TEXT NOT NULL
);
