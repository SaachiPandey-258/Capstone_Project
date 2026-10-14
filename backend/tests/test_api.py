import json
import io
import wave
import joblib
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler

from backend import app as api
from scripts.feature_contract import VOICE_FEATURE_COLUMNS


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "DATA_DIR", tmp_path / "db")
    monkeypatch.setattr(api, "DATABASE", tmp_path / "db" / "portal.sqlite3")
    monkeypatch.setattr(api, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(api, "MODEL_ARTIFACTS_DIR", tmp_path / "models")
    with TestClient(api.app) as test_client:
        yield test_client


def create_account(client, email="person@example.org"):
    response = client.post(
        "/api/auth/register", json={"email": email, "password": "safe-password"}
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def voice_file():
    return ("voice.webm", b"\x1aE\xdf\xa3sample-audio", "audio/webm")


def wav_voice_file():
    sample_rate = 16_000
    time = np.arange(sample_rate * 5) / sample_rate
    samples = (0.2 * np.sin(2 * np.pi * 180 * time) * 32767).astype("<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(samples.tobytes())
    return ("voice.wav", output.getvalue(), "audio/wav")


def write_voice_artifact(directory):
    directory.mkdir(parents=True, exist_ok=True)
    features = np.arange(64, dtype=np.float64).reshape(4, 16)
    scaler = StandardScaler().fit(features)
    model = RandomForestRegressor(n_estimators=2, random_state=1).fit(
        scaler.transform(features), np.arange(4, dtype=np.float64)
    )
    path = directory / "baseline_rf_model.pkl"
    joblib.dump({
        "model": model,
        "scaler": scaler,
        "feature_columns": list(VOICE_FEATURE_COLUMNS),
        "metadata": {
            "model_version": "random-forest-updrs-v1",
            "target": "motor_UPDRS",
        },
    }, path)
    return features


def test_registration_login_and_expired_or_missing_session(client):
    token = create_account(client)
    assert client.get("/api/auth/me", headers=auth(token)).json()["email"] == "person@example.org"
    assert client.post(
        "/api/auth/login",
        json={"email": "PERSON@example.org", "password": "safe-password"},
    ).status_code == 200
    assert client.get("/api/dashboard").status_code == 401
    assert client.post(
        "/api/auth/login",
        json={"email": "person@example.org", "password": "incorrect-password"},
    ).status_code == 401
    assert client.post(
        "/api/auth/register", json={"email": "person@example.org", "password": "another-password"}
    ).status_code == 409
    with api.connect() as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 4
        indexes = {
            row["name"]
            for row in db.execute("PRAGMA index_list('assessments')").fetchall()
        }
    assert "idx_assessments_user_created" in indexes
    assert "idx_assessments_user_status_created" in indexes
    api.initialize_database()


def test_model_status_and_precomputed_inference_are_separate_from_audio_uploads(
    client, tmp_path
):
    token = create_account(client)
    missing = client.get("/api/models/status").json()
    assert missing["voice"] == {
        "artifact_available": False,
        "precomputed_features_supported": True,
        "raw_audio_inference_available": True,
        "reason": "Voice model artifact is unavailable.",
    }
    assert client.post(
        "/api/research/predict-voice-features",
        headers=auth(token),
        json={
            "feature_columns": list(VOICE_FEATURE_COLUMNS),
            "features": [0.0] * 16,
        },
    ).status_code == 503

    features = write_voice_artifact(tmp_path / "models")
    status = client.get("/api/models/status").json()
    assert status["voice"]["artifact_available"] is True
    assert status["voice"]["raw_audio_inference_available"] is True
    prediction = client.post(
        "/api/research/predict-voice-features",
        headers=auth(token),
        json={
            "feature_columns": list(VOICE_FEATURE_COLUMNS),
            "features": features[0].tolist(),
        },
    )
    assert prediction.status_code == 200, prediction.text
    assert prediction.json()["target"] == "motor_UPDRS"
    assert prediction.json()["is_diagnostic"] is False
    assert "not a diagnosis" in prediction.json()["notice"]
    assert client.post(
        "/api/research/predict-voice-features",
        headers=auth(token),
        json={
            "feature_columns": list(VOICE_FEATURE_COLUMNS),
            "features": [0.0] * 15,
        },
    ).status_code == 422
    assert client.post(
        "/api/research/predict-voice-features",
        headers=auth(token),
        json={
            "feature_columns": list(reversed(VOICE_FEATURE_COLUMNS)),
            "features": features[0].tolist(),
        },
    ).status_code == 422
    assert client.post(
        "/api/research/predict-voice-features",
        json={
            "feature_columns": list(VOICE_FEATURE_COLUMNS),
            "features": features[0].tolist(),
        },
    ).status_code == 401

    upload = client.post(
        "/api/assessments",
        headers=auth(token),
        data={"consent": "true", "modality": "voice", "duration_seconds": "5"},
        files={"voice": voice_file()},
    )
    assert upload.status_code == 201
    assert upload.json()["status"] == "validation_required"
    assert upload.json()["result"] is None


def test_assessment_is_persisted_without_fabricated_result(client):
    token = create_account(client)
    response = client.post(
        "/api/assessments",
        headers=auth(token),
        data={"consent": "true", "modality": "voice", "duration_seconds": "5"},
        files={"voice": voice_file()},
    )
    assert response.status_code == 201
    record = response.json()
    with api.connect() as db:
        owner_id = db.execute(
            "SELECT user_id FROM assessments WHERE id = ?", (record["id"],)
        ).fetchone()["user_id"]
    saved_file = api.UPLOAD_DIR / owner_id / f"{record['id']}-voice.webm"
    assert saved_file.read_bytes() == voice_file()[1]
    assert record["status"] == "validation_required"
    assert record["result"] is None
    assert record["consent_version"] == "v1"
    assert "feature validation required" in record["unavailable_reason"].lower()
    assert "no prediction or score" in record["unavailable_reason"].lower()
    assert client.get("/api/assessments", headers=auth(token)).json() == [record]
    assert client.get("/api/dashboard", headers=auth(token)).json()["assessment_count"] == 1
    assert client.get("/api/reports", headers=auth(token)).json() == []
    assert client.get(
        f"/api/reports/{record['id']}", headers=auth(token)
    ).status_code == 404
    other_token = create_account(client, "other@example.org")
    assert client.get("/api/dashboard", headers=auth(other_token)).json() == {
        "assessment_count": 0,
        "report_count": 0,
        "recent_assessments": [],
    }


def test_voice_wav_extracts_persists_features_and_report(client, tmp_path):
    token = create_account(client)
    write_voice_artifact(tmp_path / "models")
    response = client.post(
        "/api/assessments",
        headers=auth(token),
        data={"consent": "true", "modality": "voice", "duration_seconds": "5"},
        files={"voice": wav_voice_file()},
    )
    assert response.status_code == 201, response.text
    record = response.json()
    assert record["status"] == "completed"
    assert list(record["extracted_features"]) == list(VOICE_FEATURE_COLUMNS)
    assert record["extraction_version"] == "audio-extractor-v1"
    assert record["quality"]["quality_status"] == "validated"
    assert record["result"]["is_diagnostic"] is False


def test_manual_voice_features_persist_exploratory_report(client, tmp_path):
    token = create_account(client)
    write_voice_artifact(tmp_path / "models")
    response = client.post(
        "/api/assessments/manual",
        headers=auth(token),
        data={
            "consent": "true",
            "modality": "voice",
            "feature_columns": json.dumps(list(VOICE_FEATURE_COLUMNS)),
            "features": json.dumps([0.0] * 16),
        },
    )
    assert response.status_code == 201, response.text
    record = response.json()
    assert record["status"] == "completed"
    assert record["result"]["is_diagnostic"] is False
    assert "Exploratory research estimate" in record["result"]["summary"]
    assert client.get(f"/api/reports/{record['id']}", headers=auth(token)).json() == record


def test_fusion_requires_gait_and_rejects_bad_duration_or_audio(client):
    token = create_account(client)
    base = {"consent": "true", "modality": "voice_gait", "duration_seconds": "5"}
    no_gait = client.post(
        "/api/assessments",
        headers=auth(token),
        data=base,
        files={"voice": voice_file()},
    )
    assert no_gait.status_code == 422
    too_short = client.post(
        "/api/assessments",
        headers=auth(token),
        data={"consent": "true", "modality": "voice", "duration_seconds": "2"},
        files={"voice": voice_file()},
    )
    assert too_short.status_code == 422
    wrong_content = client.post(
        "/api/assessments",
        headers=auth(token),
        data={"consent": "true", "modality": "voice", "duration_seconds": "5"},
        files={"voice": ("voice.webm", b"not audio", "audio/webm")},
    )
    assert wrong_content.status_code == 422


def test_gait_validation_is_required_for_fusion_and_scoped_to_owner(client):
    token = create_account(client)
    response = client.post(
        "/api/assessments",
        headers=auth(token),
        data={"consent": "true", "modality": "voice_gait", "duration_seconds": "5"},
        files={
            "voice": voice_file(),
            "gait": ("gait.csv", b"sensor_x,sensor_y\n1.2,2.4\n3.1,4.5\n", "text/csv"),
        },
    )
    assert response.status_code == 201
    assert response.json()["status"] == "validation_required"
    assert {item["kind"] for item in response.json()["files"]} == {"voice", "gait"}

    other_token = create_account(client, "other@example.org")
    assert client.get(
        f"/api/assessments/{response.json()['id']}", headers=auth(other_token)
    ).status_code == 404


def test_specialist_search_returns_real_provider_payload_and_requires_coordinate_pairs(
    client, monkeypatch
):
    token = create_account(client)
    providers = {
        "location": "Portland",
        "providers": [{
            "id": "node/123",
            "name": "Community Neurology",
            "address": None,
            "latitude": 45.5,
            "longitude": -122.6,
            "distance_miles": 1.2,
            "website": None,
            "phone": None,
            "osm_url": "https://www.openstreetmap.org/node/123",
        }],
        "attribution": "© OpenStreetMap contributors",
    }
    calls = []

    def search(location, category, radius, latitude=None, longitude=None):
        calls.append((location, category, radius, latitude, longitude))
        return providers

    monkeypatch.setattr(api, "search_specialists", search)
    response = client.get(
        "/api/specialists?location=Portland&category=neurology&radius=25&latitude=45.5&longitude=-122.6",
        headers=auth(token),
    )
    assert response.status_code == 200
    assert response.json() == providers
    assert calls == [("Portland", "neurology", 25, 45.5, -122.6)]
    mismatched_coordinates = client.get(
        "/api/specialists?location=Portland&category=neurology&radius=25&latitude=45.5",
        headers=auth(token),
    )
    assert mismatched_coordinates.status_code == 422


def test_specialist_search_surfaces_provider_failure_without_fake_results(
    client, monkeypatch
):
    token = create_account(client)

    def unavailable(*args, **kwargs):
        raise api.SpecialistServiceError("OpenStreetMap search is temporarily unavailable.")

    monkeypatch.setattr(api, "search_specialists", unavailable)
    response = client.get(
        "/api/specialists?location=Portland&category=neurology&radius=25",
        headers=auth(token),
    )
    assert response.status_code == 503
    assert response.json() == {
        "detail": "OpenStreetMap search is temporarily unavailable."
    }


def test_invalid_gait_file_does_not_create_an_assessment(client):
    token = create_account(client)
    response = client.post(
        "/api/assessments",
        headers=auth(token),
        data={"consent": "true", "modality": "voice_gait", "duration_seconds": "5"},
        files={
            "voice": voice_file(),
            "gait": ("gait.csv", b"not,a,numeric,dataset\n", "text/csv"),
        },
    )
    assert response.status_code == 422
    assert client.get("/api/assessments", headers=auth(token)).json() == []


def test_google_sign_in_reports_missing_configuration_without_faking_auth(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    response = client.post("/api/auth/google", json={"credential": "not-a-real-token"})
    assert response.status_code == 503
    assert response.json()["detail"] == "Google sign-in is not configured."


def test_google_sign_in_verifies_credential_and_creates_a_local_session(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "portal-client-id")
    from google.oauth2 import id_token

    verified = []

    def verify(credential, request, audience):
        verified.append((credential, audience))
        return {
            "email": "google-user@example.org",
            "email_verified": True,
            "sub": "google-subject-1",
            "name": "Google User",
        }

    monkeypatch.setattr(id_token, "verify_oauth2_token", verify)
    response = client.post(
        "/api/auth/google", json={"credential": "signed-by-google"}
    )

    assert response.status_code == 200
    assert response.json()["user"]["email"] == "google-user@example.org"
    assert verified == [("signed-by-google", "portal-client-id")]
    assert client.get(
        "/api/auth/me", headers=auth(response.json()["access_token"])
    ).json()["id"] == response.json()["user"]["id"]
    with api.connect() as db:
        row = db.execute(
            "SELECT google_subject, password_hash FROM users WHERE email = ?",
            ("google-user@example.org",),
        ).fetchone()
    assert row["google_subject"] == "google-subject-1"
    assert row["password_hash"] is None


def test_google_subject_cannot_take_over_another_linked_account(client, monkeypatch):
    token = create_account(client)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "portal-client-id")
    from google.oauth2 import id_token

    monkeypatch.setattr(
        id_token,
        "verify_oauth2_token",
        lambda credential, request, audience: {
            "email": "person@example.org",
            "email_verified": True,
            "sub": "different-google-subject",
        },
    )
    with api.connect() as db:
        db.execute(
            "UPDATE users SET google_subject = ? WHERE email = ?",
            ("original-google-subject", "person@example.org"),
        )
    response = client.post("/api/auth/google", json={"credential": "signed-by-test"})
    assert response.status_code == 409
    assert "different Google account" in response.json()["detail"]
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 200
