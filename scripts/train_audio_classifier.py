"""Train the screening model used for recorded/uploaded audio.

Why a separate audio model: on real phone recordings processed by the portal's
own extractor (Iyer et al., 2023; see scripts/extract_audio_dataset.py), the
13 jitter/shimmer/HNR measures carry no usable signal (external ROC AUC ~0.48
for the lab-trained model; ~0.51 even when trained on the phone audio).
Spectral, cepstral (CPPS) and pitch-variability measures computed by
backend.audio_features.compute_spectral_features do.

Age confound: in this dataset healthy controls are much younger (median 44)
than people with Parkinson's (median 68), and age alone predicts the label
(AUC ~0.87). Training therefore uses inverse-probability weights that give
both classes the same age distribution within decade bins, and evaluation
reports AUC on the age-matched >= 55 subgroup and the correlation between the
score and age among healthy speakers (should be ~0).

    python -m scripts.extract_audio_dataset   # once, creates data/iyer2023_features.csv
    python -m scripts.train_audio_classifier  # creates models/pd_audio_classifier.pkl
"""

import hashlib
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold

if __package__:
    from .feature_contract import SPECTRAL_FEATURE_COLUMNS
    from .training_utils import write_metrics
else:
    from feature_contract import SPECTRAL_FEATURE_COLUMNS
    from training_utils import write_metrics

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_VERSION = "rf-spectral-pd-screen-v4"
AGE_BINS = (30, 40, 50, 60, 70, 80)
MAX_HEALTHY_DETECTED = 0.15
MAX_PD_NOT_DETECTED = 0.15


def age_balancing_weights(age, y):
    """Weights giving both classes equal mass within each age decade.

    Decades containing only one class carry no within-age information about
    Parkinson's, so they are strongly down-weighted.
    """
    bins = np.digitize(age, AGE_BINS)
    weights = np.ones(len(y))
    for value in np.unique(bins):
        in_bin = bins == value
        positives = int((y[in_bin] == 1).sum())
        negatives = int((y[in_bin] == 0).sum())
        if positives == 0 or negatives == 0:
            weights[in_bin] = 0.05
            continue
        weights[in_bin & (y == 1)] = in_bin.sum() / (2 * positives)
        weights[in_bin & (y == 0)] = in_bin.sum() / (2 * negatives)
    return weights


def build_model(random_state=0):
    return RandomForestClassifier(n_estimators=500, min_samples_leaf=4, random_state=random_state, n_jobs=-1)


def choose_thresholds(probabilities, y):
    healthy, parkinsons = probabilities[..., y == 0], probabilities[..., y == 1]
    grid = np.round(np.arange(0.20, 0.81, 0.01), 2)
    high = next(t for t in grid if (healthy >= t).mean() <= MAX_HEALTHY_DETECTED)
    low = max(t for t in grid if (parkinsons < t).mean() <= MAX_PD_NOT_DETECTED and t < high)
    return float(low), float(high)


def tier_rates(probabilities, y, low, high):
    detected, cleared = probabilities >= high, probabilities < low
    return {
        f"{group}_{tier}": float(mask[..., y == label].mean())
        for group, label in (("pd", 1), ("healthy", 0))
        for tier, mask in (("detected", detected), ("inconclusive", ~detected & ~cleared), ("not_detected", cleared))
    }


def train_audio_classifier(repeats=20):
    df = pd.read_csv(os.path.join(BASE_DIR, "data", "iyer2023_features.csv")).dropna(subset=["age"])
    X = df[list(SPECTRAL_FEATURE_COLUMNS)].to_numpy(dtype=np.float64)
    y = df["status"].to_numpy(dtype=int)
    age = df["age"].to_numpy(dtype=np.float64)
    older = age >= 55

    out_of_fold, full_auc, older_auc, age_corr = [], [], [], []
    for seed in range(repeats):
        probabilities = np.zeros(len(y))
        for train_idx, test_idx in StratifiedKFold(5, shuffle=True, random_state=seed).split(X, y):
            model = build_model(seed).fit(
                X[train_idx], y[train_idx], sample_weight=age_balancing_weights(age[train_idx], y[train_idx])
            )
            probabilities[test_idx] = model.predict_proba(X[test_idx])[:, 1]
        out_of_fold.append(probabilities)
        full_auc.append(roc_auc_score(y, probabilities))
        older_auc.append(roc_auc_score(y[older], probabilities[older]))
        age_corr.append(np.corrcoef(probabilities[y == 0], age[y == 0])[0, 1])
    out_of_fold = np.array(out_of_fold)
    low, high = choose_thresholds(out_of_fold, y)
    metrics = {
        "roc_auc": float(np.mean(full_auc)),
        "roc_auc_age_55_plus": float(np.mean(older_auc)),
        "score_age_correlation_healthy": float(np.mean(age_corr)),
        "tiers": tier_rates(out_of_fold, y, low, high),
    }
    print("Cross-validated (one recording per speaker):", metrics, "thresholds", (low, high))

    model = build_model().fit(X, y, sample_weight=age_balancing_weights(age, y))
    limitations = (
        f"Trained on {len(y)} phone recordings of a sustained /a/ ({int(y.sum())} people with Parkinson's, "
        f"{int((y == 0).sum())} healthy) from one public dataset, with age balancing because healthy "
        "participants were much younger. Cross-validated only; no external or clinical validation. "
        "Screening research output, not a diagnosis."
    )
    bundle = {
        "model": model,
        "feature_columns": list(SPECTRAL_FEATURE_COLUMNS),
        "feature_min": X.min(axis=0).tolist(),
        "feature_max": X.max(axis=0).tolist(),
        "metadata": {
            "model_version": MODEL_VERSION,
            "target": "status",
            "low_threshold": low,
            "high_threshold": high,
            "tier_rates": metrics["tiers"],
            "roc_auc": metrics["roc_auc"],
            "limitations": limitations,
        },
    }
    models_dir = os.path.join(BASE_DIR, "models")
    os.makedirs(models_dir, exist_ok=True)
    artifact_path = os.path.join(models_dir, "pd_audio_classifier.pkl")
    joblib.dump(bundle, artifact_path)
    with open(artifact_path, "rb") as artifact_file:
        artifact_sha256 = hashlib.sha256(artifact_file.read()).hexdigest()
    write_metrics(os.path.join(models_dir, "pd_audio_classifier_metrics.json"), {
        "model": MODEL_VERSION,
        "target": "status (1 = Parkinson's)",
        "data": "Iyer et al. 2023 (figshare 10.6084/m9.figshare.23849127, CC BY 4.0), features from backend.audio_features",
        "protocol": f"StratifiedKFold (5 folds, {repeats} repeats), age-balanced sample weights; refit on all",
        "thresholds": {"not_detected_below": low, "detected_at_or_above": high},
        "n_samples": int(len(y)),
        "metrics": metrics,
        "artifact_sha256": artifact_sha256,
        "limitations": limitations,
    })
    print(f"Saved audio screening classifier to {artifact_path}")
    return bundle


if __name__ == "__main__":
    train_audio_classifier()
