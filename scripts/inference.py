"""Strict model-artifact loading and inference helpers for research features."""

from __future__ import annotations

import hashlib
import os
from collections.abc import Mapping
from typing import Any

import joblib
import numpy as np
import torch
from sklearn.ensemble import RandomForestRegressor

if __package__:
    from .feature_contract import AudioFeatureValidationRequired, VOICE_FEATURE_COLUMNS
    from .gait_contract import validate_gait_window
    from .training_utils import require_finite_matrix
    from .train_fusion import MetaLearnerFusion
else:
    from feature_contract import AudioFeatureValidationRequired, VOICE_FEATURE_COLUMNS
    from gait_contract import validate_gait_window
    from training_utils import require_finite_matrix
    from train_fusion import MetaLearnerFusion


class ModelNotReadyError(RuntimeError):
    """Raised when required model artifacts are absent or incompatible."""


def _validate_voice_bundle(bundle: Any) -> dict[str, Any]:
    if not isinstance(bundle, dict):
        raise ModelNotReadyError("Voice model artifact is not a supported bundle.")
    required = {"model", "scaler", "feature_columns", "metadata"}
    if not required.issubset(bundle):
        raise ModelNotReadyError("Voice model artifact is missing required components.")
    columns = bundle["feature_columns"]
    model, scaler = bundle["model"], bundle["scaler"]
    if not isinstance(columns, list) or columns != list(VOICE_FEATURE_COLUMNS):
        raise ModelNotReadyError("Voice model artifact has an invalid feature schema.")
    metadata = bundle["metadata"]
    if (
        not isinstance(metadata, dict)
        or metadata.get("model_version") != "random-forest-updrs-v1"
        or metadata.get("target") != "motor_UPDRS"
    ):
        raise ModelNotReadyError("Voice model artifact has unsupported model metadata.")
    if not isinstance(model, RandomForestRegressor):
        raise ModelNotReadyError("Voice artifact does not contain the expected Random Forest.")
    if not hasattr(scaler, "mean_") or len(scaler.mean_) != len(columns):
        raise ModelNotReadyError("Voice scaler is unfitted or incompatible.")
    if getattr(model, "n_features_in_", None) != len(columns):
        raise ModelNotReadyError("Voice estimator is incompatible with its feature schema.")
    return bundle


def load_voice_model(artifact_path: str) -> dict[str, Any]:
    if not os.path.isfile(artifact_path):
        raise ModelNotReadyError("Voice model artifact is unavailable.")
    try:
        bundle = joblib.load(artifact_path)
    except Exception as exc:
        raise ModelNotReadyError("Voice model artifact could not be loaded.") from exc
    return _validate_voice_bundle(bundle)


def predict_voice_features(features: Any, artifact_path: str) -> np.ndarray:
    """Predict motor_UPDRS from precomputed, ordered 16-feature voice rows."""
    bundle = load_voice_model(artifact_path)
    if isinstance(features, Mapping):
        if tuple(features.keys()) != tuple(bundle["feature_columns"]):
            raise ValueError("Voice feature names/order do not match the model schema.")
        features = [list(features.values())]
    matrix = require_finite_matrix(
        features, name="Voice features", columns=len(bundle["feature_columns"])
    )
    scaled = bundle["scaler"].transform(matrix)
    predictions = np.asarray(bundle["model"].predict(scaled), dtype=np.float64)
    if predictions.shape != (len(matrix),) or not np.isfinite(predictions).all():
        raise RuntimeError("Voice model returned invalid predictions.")
    return predictions


def predict_voice_audio(*_args: Any, **_kwargs: Any) -> np.ndarray:
    """Fail closed until browser audio maps to all validated training features."""
    raise AudioFeatureValidationRequired(
        "Feature validation required: raw browser audio cannot currently be "
        "mapped to the complete 16-feature training schema. RPDE, DFA, and PPE "
        "have no validated audio extractor or reference fixtures; no scaler or "
        "model inference was run."
    )


def _load_fusion_model(artifacts_dir: str) -> tuple[MetaLearnerFusion, Any, list[str]]:
    checkpoint_path = os.path.join(artifacts_dir, "fusion_model.pt")
    scaler_path = os.path.join(artifacts_dir, "fusion_vocal_scaler.joblib")
    if not os.path.isfile(checkpoint_path) or not os.path.isfile(scaler_path):
        raise ModelNotReadyError("Fusion model checkpoint or scaler is unavailable.")
    try:
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
