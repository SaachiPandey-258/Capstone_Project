"""Strict model-artifact loading and inference helpers for research features."""

from __future__ import annotations

import hashlib
import os
from collections.abc import Mapping
from typing import Any

import joblib
import numpy as np

if __package__:
    from .feature_contract import AudioFeatureValidationRequired, SPECTRAL_FEATURE_COLUMNS, VOICE_FEATURE_COLUMNS
    from .gait_contract import validate_gait_window
    from .training_utils import require_finite_matrix
else:
    from feature_contract import AudioFeatureValidationRequired, SPECTRAL_FEATURE_COLUMNS, VOICE_FEATURE_COLUMNS
    from gait_contract import validate_gait_window
    from training_utils import require_finite_matrix


class ModelNotReadyError(RuntimeError):
    """Raised when required model artifacts are absent or incompatible."""


VOICE_MODEL_VERSION = "ridge-log-updrs-v2"
VOICE_MODEL_FILENAME = "updrs_regressor.pkl"
PRAAT_COLUMNS = list(VOICE_FEATURE_COLUMNS[:13])


def _load_pipeline_bundle(
    artifact_path: str, version: str, label: str, columns: list[str] | None = None
) -> dict[str, Any]:
    """Load a {model, feature_columns, feature_min/max, metadata} artifact.

    Both voice models consume the 13 Praat-compatible columns of the
    16-feature contract and clip inputs to the training range.
    """
    if not os.path.isfile(artifact_path):
        raise ModelNotReadyError(f"{label} artifact is unavailable.")
    try:
        bundle = joblib.load(artifact_path)
    except Exception as exc:
        raise ModelNotReadyError(f"{label} artifact could not be loaded.") from exc
    required = {"model", "feature_columns", "feature_min", "feature_max", "metadata"}
    if not isinstance(bundle, dict) or not required.issubset(bundle):
        raise ModelNotReadyError(f"{label} artifact is missing required components.")
    columns = PRAAT_COLUMNS if columns is None else columns
    if bundle["feature_columns"] != columns:
        raise ModelNotReadyError(f"{label} artifact has an invalid feature schema.")
    metadata = bundle["metadata"]
    if not isinstance(metadata, dict) or metadata.get("model_version") != version:
        raise ModelNotReadyError(f"{label} artifact has unsupported model metadata.")
    if len(bundle["feature_min"]) != len(columns) or len(bundle["feature_max"]) != len(columns):
        raise ModelNotReadyError(f"{label} artifact has an invalid training range.")
    return bundle


def _praat_rows(features: Any, bundle: dict[str, Any]) -> np.ndarray:
    if isinstance(features, Mapping):
        if tuple(features.keys()) != tuple(VOICE_FEATURE_COLUMNS):
            raise ValueError("Voice feature names/order do not match the model schema.")
        features = [list(features.values())]
    try:
        rows = np.asarray(features, dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise ValueError("Voice features must contain numeric values.") from exc
    if rows.ndim != 2 or rows.shape[1] != len(VOICE_FEATURE_COLUMNS):
        raise ValueError(f"Voice features must have {len(VOICE_FEATURE_COLUMNS)} columns.")
    # Only the 13 Praat columns are model inputs; RPDE/DFA/PPE may be missing.
    matrix = require_finite_matrix(
        rows[:, :len(PRAAT_COLUMNS)], name="Voice features", columns=len(PRAAT_COLUMNS)
    )
    return np.clip(matrix, bundle["feature_min"], bundle["feature_max"])


def load_voice_model(artifact_path: str) -> dict[str, Any]:
    bundle = _load_pipeline_bundle(artifact_path, VOICE_MODEL_VERSION, "Voice severity model")
    if bundle["metadata"].get("target") != "motor_UPDRS" or not hasattr(bundle["model"], "predict"):
        raise ModelNotReadyError("Voice severity model has an unsupported target.")
    return bundle


def predict_voice_features(features: Any, artifact_path: str) -> np.ndarray:
    """Predict motor_UPDRS from ordered 16-feature voice rows (13 Praat columns used)."""
    bundle = load_voice_model(artifact_path)
    matrix = _praat_rows(features, bundle)
    predictions = np.asarray(bundle["model"].predict(matrix), dtype=np.float64)
    if predictions.shape != (len(matrix),) or not np.isfinite(predictions).all():
        raise RuntimeError("Voice model returned invalid predictions.")
    return np.clip(predictions, 0.0, 108.0)


def voice_model_mae(artifact_path: str) -> float | None:
    mae = load_voice_model(artifact_path)["metadata"].get("mae")
    return float(mae) if isinstance(mae, (int, float)) else None


def predict_voice_audio(*_args: Any, **_kwargs: Any) -> np.ndarray:
    """Fail closed until browser audio maps to all validated training features."""
    raise AudioFeatureValidationRequired(
        "Feature validation required: raw browser audio cannot currently be "
        "mapped to the complete 16-feature training schema. RPDE, DFA, and PPE "
        "have no validated audio extractor or reference fixtures; no scaler or "
        "model inference was run."
    )


def _load_fusion_model(artifacts_dir: str) -> tuple[Any, Any, list[str]]:
    checkpoint_path = os.path.join(artifacts_dir, "fusion_model.pt")
    scaler_path = os.path.join(artifacts_dir, "fusion_vocal_scaler.joblib")
    if not os.path.isfile(checkpoint_path) or not os.path.isfile(scaler_path):
        raise ModelNotReadyError(
            "Fusion inference is unavailable because the fusion model checkpoint or scaler is unavailable."
        )
    try:
        import torch

        if __package__:
            from .train_fusion import MetaLearnerFusion
        else:
            from train_fusion import MetaLearnerFusion

        with open(scaler_path, "rb") as scaler_file:
            scaler_digest = hashlib.sha256(scaler_file.read()).hexdigest()
        scaler = joblib.load(scaler_path)
        checkpoint = torch.load(
            checkpoint_path, map_location="cpu", weights_only=True
        )
    except Exception as exc:
        raise ModelNotReadyError("Fusion model artifacts could not be loaded.") from exc
    if not isinstance(checkpoint, dict):
        raise ModelNotReadyError("Fusion checkpoint has an unsupported format.")
    if (
        checkpoint.get("model_version") != "dual-branch-fusion-updrs-v1"
        or checkpoint.get("target") != "motor_UPDRS"
    ):
        raise ModelNotReadyError("Fusion checkpoint has unsupported model metadata.")
    if checkpoint.get("scaler_sha256") != scaler_digest:
        raise ModelNotReadyError("Fusion checkpoint does not match its saved scaler.")
    columns = checkpoint.get("feature_columns")
    if (
        not isinstance(columns, list)
        or len(columns) != 16
        or checkpoint.get("gait_timesteps") != 200
        or checkpoint.get("gait_columns") != 19
    ):
        raise ModelNotReadyError("Fusion checkpoint has an incompatible input schema.")
    if not hasattr(scaler, "mean_") or len(scaler.mean_) != len(columns):
        raise ModelNotReadyError("Fusion vocal scaler is unfitted or incompatible.")
    model = MetaLearnerFusion()
    try:
        model.load_state_dict(checkpoint["model_state_dict"], strict=True)
    except (KeyError, RuntimeError) as exc:
        raise ModelNotReadyError("Fusion model weights are incompatible.") from exc
    model.eval()
    return model, scaler, columns


def predict_fusion_features(
    vocal_features: Any, gait_windows: Any, artifacts_dir: str
) -> np.ndarray:
    """Predict from aligned vocal rows and strict 200 x 19 gait windows."""
    try:
        import torch
    except ImportError as exc:
        raise ModelNotReadyError(
            "Fusion inference is unavailable because PyTorch is not installed."
        ) from exc
    model, scaler, columns = _load_fusion_model(artifacts_dir)
    vocal = require_finite_matrix(
        vocal_features, name="Vocal features", columns=len(columns)
    )
    try:
        gait = np.asarray(gait_windows, dtype=np.float32)
    except (TypeError, ValueError) as exc:
        raise ValueError("Gait windows must contain numeric values.") from exc
    if gait.ndim == 2:
        gait = gait[np.newaxis, ...]
    if gait.ndim != 3 or gait.shape[0] != len(vocal):
        raise ValueError("Gait window batch must align with the vocal feature batch.")
    checked_gait = np.stack([validate_gait_window(window) for window in gait])
    scaled_vocal = scaler.transform(vocal)
    left = checked_gait[:, :, 1:9].copy()
    right = checked_gait[:, :, 9:17].copy()
    with torch.no_grad():
        predictions = model(
            torch.as_tensor(scaled_vocal, dtype=torch.float32),
            torch.as_tensor(left, dtype=torch.float32),
            torch.as_tensor(right, dtype=torch.float32),
        ).cpu().numpy()
    if predictions.shape != (len(vocal),) or not np.isfinite(predictions).all():
        raise RuntimeError("Fusion model returned invalid predictions.")
    return predictions


PD_CLASSIFIER_VERSION = "logistic-pd-screen-v3"
AUDIO_CLASSIFIER_VERSION = "rf-spectral-pd-screen-v4"
GAIT_CLASSIFIER_VERSION = "svm-gait-pd-screen-v1"

# Approximate motor-severity bands for UPDRS Part III (Martínez-Martín et al.,
# 2015 cut-offs: mild <= 32, moderate 33-58, severe >= 59). These are severity
# bands, not Hoehn & Yahr stages.
UPDRS_SEVERITY_BANDS = (
    (32.0, "Mild"),
    (58.0, "Moderate"),
    (float("inf"), "Severe"),
)
UPDRS_MOTOR_MAX = 108.0


def updrs_severity_band(score: float) -> str:
    for upper, label in UPDRS_SEVERITY_BANDS:
        if score <= upper:
            return label
    return UPDRS_SEVERITY_BANDS[-1][1]


def _check_screening_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    metadata = bundle["metadata"]
    if not hasattr(bundle["model"], "predict_proba"):
        raise ModelNotReadyError("Screening classifier does not provide probabilities.")
    low, high = metadata.get("low_threshold"), metadata.get("high_threshold")
    if not (isinstance(low, float) and isinstance(high, float) and 0 < low < high < 1):
        raise ModelNotReadyError("Screening classifier has invalid decision thresholds.")
    return bundle


def load_pd_classifier(artifact_path: str) -> dict[str, Any]:
    """Screening model for submitted lab-style feature values (13 Praat measures)."""
    return _check_screening_bundle(
        _load_pipeline_bundle(artifact_path, PD_CLASSIFIER_VERSION, "Parkinson's screening classifier")
    )


def load_audio_classifier(artifact_path: str) -> dict[str, Any]:
    """Screening model for recorded audio (spectral/cepstral measures)."""
    return _check_screening_bundle(_load_pipeline_bundle(
        artifact_path, AUDIO_CLASSIFIER_VERSION, "Audio screening classifier",
        list(SPECTRAL_FEATURE_COLUMNS),
    ))


def screening_tier(probability: float, low: float, high: float) -> str:
    if probability >= high:
        return "detected"
    if probability < low:
        return "not_detected"
    return "inconclusive"


def predict_pd_screening(features: Any, artifact_path: str) -> dict[str, Any]:
    """Screen one 16-feature lab-style row; returns probability, tier, thresholds and error rates."""
    bundle = load_pd_classifier(artifact_path)
    return _screen(bundle, _praat_rows(features, bundle))


def predict_pd_screening_audio(spectral: Mapping[str, Any], artifact_path: str) -> dict[str, Any]:
    """Screen one recording from its spectral measures (see SPECTRAL_FEATURE_COLUMNS)."""
    bundle = load_audio_classifier(artifact_path)
    try:
        row = [[float(spectral[column]) for column in SPECTRAL_FEATURE_COLUMNS]]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Spectral voice measures are missing or invalid.") from exc
    matrix = require_finite_matrix(row, name="Spectral features", columns=len(SPECTRAL_FEATURE_COLUMNS))
    return _screen(bundle, np.clip(matrix, bundle["feature_min"], bundle["feature_max"]))


def _screen(bundle: dict[str, Any], matrix: np.ndarray) -> dict[str, Any]:
    probability = float(bundle["model"].predict_proba(matrix)[0, 1])
    if not np.isfinite(probability):
        raise RuntimeError("Screening classifier returned an invalid probability.")
    metadata = bundle["metadata"]
    low, high = float(metadata["low_threshold"]), float(metadata["high_threshold"])
    return {
        "model_version": metadata["model_version"],
        "probability": probability,
        "tier": screening_tier(probability, low, high),
        "low_threshold": low,
        "high_threshold": high,
        "tier_rates": metadata.get("tier_rates"),
    }


def load_gait_classifier(artifact_path: str) -> dict[str, Any]:
    """Gait screening model (stride-timing features) with voice+gait fusion settings."""
    if __package__:
        from .gait_features import GAIT_FEATURE_COLUMNS
    else:
        from gait_features import GAIT_FEATURE_COLUMNS
    bundle = _check_screening_bundle(_load_pipeline_bundle(
        artifact_path, GAIT_CLASSIFIER_VERSION, "Gait screening classifier", list(GAIT_FEATURE_COLUMNS),
    ))
    if not isinstance(bundle["metadata"].get("fusion"), dict):
        raise ModelNotReadyError("Gait screening classifier has no fusion settings.")
    return bundle


def predict_pd_screening_gait(features: Mapping[str, Any], artifact_path: str) -> dict[str, Any]:
    """Screen one walking recording from its stride-timing features."""
    bundle = load_gait_classifier(artifact_path)
    columns = bundle["feature_columns"]
    try:
        row = [[float(features[column]) for column in columns]]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Gait features are missing or invalid.") from exc
    matrix = require_finite_matrix(row, name="Gait features", columns=len(columns))
    screening = _screen(bundle, np.clip(matrix, bundle["feature_min"], bundle["feature_max"]))
    screening["fusion"] = bundle["metadata"]["fusion"]
    return screening


def fuse_screenings(voice: Mapping[str, Any], gait: Mapping[str, Any]) -> dict[str, Any]:
    """Late fusion: mean of voice and gait probabilities with calibrated thresholds.

    Thresholds and error rates come from the gait bundle's fusion settings for
    the specific voice model that produced the voice probability.
    """
    settings = gait["fusion"].get(voice["model_version"])
    if not isinstance(settings, Mapping):
        raise ModelNotReadyError("No voice + gait fusion settings exist for this voice model.")
    probability = (float(voice["probability"]) + float(gait["probability"])) / 2
    low, high = float(settings["low_threshold"]), float(settings["high_threshold"])
    return {
        "model_version": "late-fusion-mean-v1",
        "probability": probability,
        "tier": screening_tier(probability, low, high),
        "low_threshold": low,
        "high_threshold": high,
        "tier_rates": settings.get("tier_rates"),
        "roc_auc": settings.get("roc_auc"),
    }
