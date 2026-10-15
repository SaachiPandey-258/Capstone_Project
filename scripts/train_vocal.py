"""Train the voice-only motor UPDRS (Part III) regressor.

Data: data/parkinsons_updrs.data (Tsanas et al.), 5,875 telemonitoring
recordings from 42 people with early-stage Parkinson's.

Model selection used subject-grouped cross-validation (no person in both
training and test folds). Random forest, gradient boosting and ridge models
on the 16-feature contract, the 13 Praat-compatible measures, and with
age/sex were compared; none clearly beats predicting the cohort mean for
unseen people, which is the honest ceiling of this dataset. Ridge regression
on the 13 log-scaled Praat measures had the lowest error and does not depend
on the portal's uncalibrated RPDE/DFA/PPE implementations, so it is used.
"""

import hashlib
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

if __package__:
    from .feature_contract import VOICE_FEATURE_COLUMNS
    from .training_utils import log_perturbation_features, require_finite_matrix, write_metrics
else:
    from feature_contract import VOICE_FEATURE_COLUMNS
    from training_utils import log_perturbation_features, require_finite_matrix, write_metrics

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_VERSION = "ridge-log-updrs-v2"
REGRESSOR_COLUMNS = list(VOICE_FEATURE_COLUMNS[:13])


def vocal_feature_columns(df):
    missing = [column for column in VOICE_FEATURE_COLUMNS if column not in df.columns]
    if missing:
        raise ValueError(f"Vocal dataset is missing required features: {missing}.")
    return list(VOICE_FEATURE_COLUMNS)


def build_model():
    return make_pipeline(
        FunctionTransformer(log_perturbation_features), StandardScaler(), Ridge(alpha=10.0)
    )


def train_baseline():
    df = pd.read_csv(os.path.join(BASE_DIR, "data", "parkinsons_updrs.data"))
    X = require_finite_matrix(df[REGRESSOR_COLUMNS].values, name="Vocal features", columns=13)
    y = df["motor_UPDRS"].to_numpy(dtype=np.float64)
    groups = df["subject#"].to_numpy()

    predictions = np.zeros(len(y))
    baseline = np.zeros(len(y))
    for train_idx, test_idx in GroupKFold(n_splits=6).split(X, y, groups):
        predictions[test_idx] = build_model().fit(X[train_idx], y[train_idx]).predict(X[test_idx])
        baseline[test_idx] = y[train_idx].mean()
    metrics = {
        "mae": float(mean_absolute_error(y, predictions)),
        "rmse": float(np.sqrt(mean_squared_error(y, predictions))),
        "r2": float(r2_score(y, predictions)),
        "cohort_mean_mae": float(mean_absolute_error(y, baseline)),
    }
    print("Subject-independent 6-fold CV:", metrics)

    model = build_model().fit(X, y)
    limitations = (
        "Trained on 42 people with early-stage Parkinson's (motor UPDRS roughly 5-40). "
        "For people not in the training data it is no more accurate than the cohort "
        f"average (MAE {metrics['mae']:.1f} points); treat the estimate as indicative only."
    )
    bundle = {
        "model": model,
        "feature_columns": REGRESSOR_COLUMNS,
        "feature_min": X.min(axis=0).tolist(),
        "feature_max": X.max(axis=0).tolist(),
        "metadata": {
            "model_version": MODEL_VERSION,
            "target": "motor_UPDRS",
            "mae": metrics["mae"],
            "limitations": limitations,
        },
    }
    models_dir = os.path.join(BASE_DIR, "models")
    os.makedirs(models_dir, exist_ok=True)
    artifact_path = os.path.join(models_dir, "updrs_regressor.pkl")
    joblib.dump(bundle, artifact_path)
    with open(artifact_path, "rb") as artifact_file:
        artifact_sha256 = hashlib.sha256(artifact_file.read()).hexdigest()
    write_metrics(os.path.join(models_dir, "updrs_regressor_metrics.json"), {
        "model": MODEL_VERSION,
        "target": "motor_UPDRS",
        "protocol": "GroupKFold (6 folds by subject#); refit on all subjects",
        "n_samples": int(len(y)),
        "n_subjects": int(len(np.unique(groups))),
        "metrics": metrics,
        "artifact_sha256": artifact_sha256,
        "limitations": limitations,
    })
    print(f"Saved UPDRS regressor to {artifact_path}")
    return bundle


if __name__ == "__main__":
    train_baseline()
