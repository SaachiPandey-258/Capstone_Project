"""Train the gait screening model and calibrate voice + gait combined screening.

Data: PhysioNet "Gait in Parkinson's Disease" (data/gait-in-parkinsons-disease-1.0.0):
306 walking recordings from 165 people (93 with Parkinson's, 72 controls)
across three studies (Ga, Ju, Si). Labels and gait come from the same person.

Model: stride-timing features (scripts/gait_features.py) -> log -> scaler ->
RBF SVM, chosen over logistic regression, random forest and gradient boosting
for the best person-level and cross-study AUC.

Combined screening (late fusion): voice and gait datasets contain different
people, so no model can be trained on both inputs at once. The portal
averages the voice-model and gait-model probabilities. Its accuracy and
thresholds are estimated by pairing out-of-fold voice and gait probabilities
from people in the same group (PD with PD, healthy with healthy), which
assumes the two signals are independent given diagnosis.

    python -m scripts.train_gait_classifier   -> models/pd_gait_classifier.pkl
"""

import glob
import hashlib
import os
import re

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler
from sklearn.svm import SVC

from scripts import train_audio_classifier, train_classifier
from scripts.feature_contract import SPECTRAL_FEATURE_COLUMNS
from scripts.gait_features import GAIT_FEATURE_COLUMNS, GaitFeatureError, gait_features
from scripts.training_utils import log_positive, write_metrics

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAIT_DIR = os.path.join(BASE_DIR, "data", "gait-in-parkinsons-disease-1.0.0")
MODEL_VERSION = "svm-gait-pd-screen-v1"
FUSION_VERSION = "late-fusion-mean-v1"


def load_gait_data():
    rows = []
    for path in sorted(glob.glob(os.path.join(GAIT_DIR, "*_*.txt"))):
        match = re.match(r"(Ga|Ju|Si)(Pt|Co)(\d+)_(\d+)\.txt$", os.path.basename(path))
        if not match:
            continue
        try:
            features = gait_features(np.loadtxt(path))
        except (GaitFeatureError, ValueError):
            continue
        rows.append({"study": match[1], "status": int(match[2] == "Pt"),
                     "subject": match[1] + match[2] + match[3], **features})
    return pd.DataFrame(rows)


def build_model():
    return make_pipeline(
        FunctionTransformer(log_positive), StandardScaler(),
        SVC(C=1.0, class_weight="balanced", probability=True, random_state=0),
    )


def _gait_out_of_fold(X, y, groups, repeats):
    runs = []
    for seed in range(repeats):
        probabilities = np.zeros(len(y))
        for train_idx, test_idx in StratifiedGroupKFold(5, shuffle=True, random_state=seed).split(X, y, groups):
            probabilities[test_idx] = build_model().fit(X[train_idx], y[train_idx]).predict_proba(X[test_idx])[:, 1]
        runs.append(probabilities)
    return np.array(runs)


def _audio_out_of_fold(repeats):
    df = pd.read_csv(os.path.join(BASE_DIR, "data", "iyer2023_features.csv")).dropna(subset=["age"])
    X = df[list(SPECTRAL_FEATURE_COLUMNS)].to_numpy(dtype=np.float64)
    y = df["status"].to_numpy(dtype=int)
    age = df["age"].to_numpy(dtype=np.float64)
    runs = []
    for seed in range(repeats):
        probabilities = np.zeros(len(y))
        for train_idx, test_idx in StratifiedKFold(5, shuffle=True, random_state=seed).split(X, y):
            model = train_audio_classifier.build_model(seed).fit(
                X[train_idx], y[train_idx],
                sample_weight=train_audio_classifier.age_balancing_weights(age[train_idx], y[train_idx]),
            )
            probabilities[test_idx] = model.predict_proba(X[test_idx])[:, 1]
        runs.append(probabilities)
    return np.array(runs), y


def _lab_out_of_fold(repeats):
    X, y, groups, _ = train_classifier.load_screening_data()
    runs = []
    for seed in range(repeats):
        probabilities = np.zeros(len(y))
        for train_idx, test_idx in StratifiedGroupKFold(5, shuffle=True, random_state=seed).split(X, y, groups):
            probabilities[test_idx] = train_classifier.build_model().fit(X[train_idx], y[train_idx]).predict_proba(X[test_idx])[:, 1]
        runs.append(probabilities)
    return np.array(runs), y


def simulate_fusion(voice_runs, voice_y, gait_runs, gait_y, pairs_per_class=3000, seed=0):
    """Pair voice and gait probabilities within each class and average them."""
    rng = np.random.default_rng(seed)
    voice_p, gait_p, labels = [], [], []
    for label in (0, 1):
        v = voice_runs[:, voice_y == label].ravel()
        g = gait_runs[:, gait_y == label].ravel()
        voice_p.append(rng.choice(v, pairs_per_class))
        gait_p.append(rng.choice(g, pairs_per_class))
        labels.append(np.full(pairs_per_class, label))
    voice_p, gait_p, labels = map(np.concatenate, (voice_p, gait_p, labels))
    fused = (voice_p + gait_p) / 2
    low, high = train_audio_classifier.choose_thresholds(fused, labels)
    return {
        "roc_auc": float(roc_auc_score(labels, fused)),
        "voice_alone_roc_auc": float(roc_auc_score(labels, voice_p)),
        "gait_alone_roc_auc": float(roc_auc_score(labels, gait_p)),
        "low_threshold": low,
        "high_threshold": high,
        "tier_rates": train_audio_classifier.tier_rates(fused, labels, low, high),
    }


def train_gait_classifier(repeats=10):
    df = load_gait_data()
    X = df[list(GAIT_FEATURE_COLUMNS)].to_numpy(dtype=np.float64)
    y = df["status"].to_numpy(dtype=int)
    groups = df["subject"].to_numpy()
    studies = df["study"].to_numpy()

    gait_runs = _gait_out_of_fold(X, y, groups, repeats)
    subject_auc = []
    for probabilities in gait_runs:
        per_subject = pd.DataFrame({"g": groups, "y": y, "p": probabilities}).groupby("g").agg(y=("y", "first"), p=("p", "mean"))
        subject_auc.append(roc_auc_score(per_subject["y"], per_subject["p"]))
    cross_study = {
        held: float(roc_auc_score(y[studies == held], build_model().fit(X[studies != held], y[studies != held]).predict_proba(X[studies == held])[:, 1]))
        for held in ("Ga", "Ju", "Si")
    }
    low, high = train_audio_classifier.choose_thresholds(gait_runs, y)
    gait_metrics = {
        "roc_auc_recording": float(np.mean([roc_auc_score(y, p) for p in gait_runs])),
        "roc_auc_person": float(np.mean(subject_auc)),
        "leave_one_study_out_roc_auc": cross_study,
        "tiers": train_audio_classifier.tier_rates(gait_runs, y, low, high),
    }
    print("Gait model:", gait_metrics, "thresholds", (low, high))

    # Late-fusion calibration with each voice model.
    audio_runs, audio_y = _audio_out_of_fold(min(repeats, 5))
    lab_runs, lab_y = _lab_out_of_fold(min(repeats, 5))
    fusion = {
        train_audio_classifier.MODEL_VERSION: simulate_fusion(audio_runs, audio_y, gait_runs, y),
        train_classifier.MODEL_VERSION: simulate_fusion(lab_runs, lab_y, gait_runs, y),
    }
    for voice_model, result in fusion.items():
        print(f"Voice ({voice_model}) + gait:", result)

    model = build_model().fit(X, y)
    limitations = (
        f"Gait model trained on {len(y)} walking recordings from {len(np.unique(groups))} people "
        f"({len(np.unique(groups[y == 1]))} with Parkinson's, {len(np.unique(groups[y == 0]))} controls) "
        "in three research studies with foot-pressure insoles. Combined voice + gait accuracy is a simulation "
        "that pairs different people from the same group and assumes the two signals are independent; it has "
        "not been measured on people who gave both. Research output, not a diagnosis."
    )
    bundle = {
        "model": model,
        "feature_columns": list(GAIT_FEATURE_COLUMNS),
        "feature_min": X.min(axis=0).tolist(),
        "feature_max": X.max(axis=0).tolist(),
        "metadata": {
            "model_version": MODEL_VERSION,
            "target": "status",
            "low_threshold": low,
            "high_threshold": high,
            "tier_rates": gait_metrics["tiers"],
            "fusion_version": FUSION_VERSION,
            "fusion": fusion,
            "limitations": limitations,
        },
    }
    models_dir = os.path.join(BASE_DIR, "models")
    artifact_path = os.path.join(models_dir, "pd_gait_classifier.pkl")
    joblib.dump(bundle, artifact_path)
    with open(artifact_path, "rb") as artifact_file:
        artifact_sha256 = hashlib.sha256(artifact_file.read()).hexdigest()
    write_metrics(os.path.join(models_dir, "pd_gait_classifier_metrics.json"), {
        "model": MODEL_VERSION,
        "data": "PhysioNet Gait in Parkinson's Disease (Ga, Ju, Si studies)",
        "protocol": f"StratifiedGroupKFold by person (5 folds, {repeats} repeats); leave-one-study-out; refit on all",
        "n_recordings": int(len(y)),
        "n_people": int(len(np.unique(groups))),
        "thresholds": {"not_detected_below": low, "detected_at_or_above": high},
        "metrics": gait_metrics,
        "fusion": {"method": "mean of voice and gait probabilities", "version": FUSION_VERSION, "by_voice_model": fusion},
        "artifact_sha256": artifact_sha256,
        "limitations": limitations,
    })
    print(f"Saved gait classifier to {artifact_path}")
    return bundle


if __name__ == "__main__":
    train_gait_classifier()
