"""Train the Parkinson's voice screening classifier.

Data (sustained /a/ phonations, labelled healthy vs Parkinson's):
  * data/pd_speech_features.csv - Sakar et al. (2019), UCI "Parkinson's Disease
    Classification": 756 recordings, 252 speakers (188 PD, 64 healthy), Praat
    features. CC BY 4.0.
  * data/parkinsons.data - Little et al. (2007/2009): 195 recordings, 32
    speakers (24 PD, 8 healthy), MDVP features.

Only the 13 Praat-compatible perturbation/noise measures are used. RPDE, DFA
and PPE are excluded because the portal's audio implementations of those
three are not calibrated to either dataset (extracted PPE sits above the
training range even for clean voices), which made every recording screen
positive.

Model selection (speaker-grouped CV and cross-dataset transfer) compared
logistic regression, SVM, random forest, extra-trees and gradient boosting;
L2 logistic regression on log-scaled perturbation features generalised best
across the two recording setups. Evaluation is speaker-independent so no
person appears in both training and test folds. Results are reported as
three tiers: "detected" (probability >= high threshold), "not detected"
(< low threshold) and "inconclusive" in between.
"""

import hashlib
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

if __package__:
    from .feature_contract import VOICE_FEATURE_COLUMNS
    from .training_utils import log_perturbation_features, require_finite_matrix, write_metrics
else:
    from feature_contract import VOICE_FEATURE_COLUMNS
    from training_utils import log_perturbation_features, require_finite_matrix, write_metrics

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_VERSION = "logistic-pd-screen-v3"
SCREENING_COLUMNS = list(VOICE_FEATURE_COLUMNS[:13])
LOW_THRESHOLD = 0.35
HIGH_THRESHOLD = 0.70

# parkinsons.data uses MDVP-prefixed names for some of the contract columns.
DATASET_COLUMNS = {
    "Jitter(%)": "MDVP:Jitter(%)",
    "Jitter(Abs)": "MDVP:Jitter(Abs)",
    "Jitter:RAP": "MDVP:RAP",
    "Jitter:PPQ5": "MDVP:PPQ",
    "Jitter:DDP": "Jitter:DDP",
    "Shimmer": "MDVP:Shimmer",
    "Shimmer(dB)": "MDVP:Shimmer(dB)",
    "Shimmer:APQ3": "Shimmer:APQ3",
    "Shimmer:APQ5": "Shimmer:APQ5",
    "Shimmer:APQ11": "MDVP:APQ",
    "Shimmer:DDA": "Shimmer:DDA",
    "NHR": "NHR",
    "HNR": "HNR",
    "RPDE": "RPDE",
    "DFA": "DFA",
    "PPE": "PPE",
}
SAKAR_COLUMNS = [
    "locPctJitter", "locAbsJitter", "rapJitter", "ppq5Jitter", "ddpJitter",
    "locShimmer", "locDbShimmer", "apq3Shimmer", "apq5Shimmer", "apq11Shimmer",
    "ddaShimmer", "meanNoiseToHarmHarmonicity", "meanHarmToNoiseHarmonicity",
]


def load_screening_data():
    sakar = pd.read_csv(os.path.join(BASE_DIR, "data", "pd_speech_features.csv"), header=1)
    little = pd.read_csv(os.path.join(BASE_DIR, "data", "parkinsons.data"))
    X = np.vstack([
        sakar[SAKAR_COLUMNS].to_numpy(dtype=np.float64),
        little[[DATASET_COLUMNS[c] for c in SCREENING_COLUMNS]].to_numpy(dtype=np.float64),
    ])
    y = np.concatenate([sakar["class"].to_numpy(dtype=int), little["status"].to_numpy(dtype=int)])
    groups = np.concatenate([
        ("sakar-" + sakar["id"].astype(str)).to_numpy(),
        ("little-" + little["name"].str.extract(r"(S\d+)")[0]).to_numpy(),
    ])
    source = np.array(["sakar"] * len(sakar) + ["little"] * len(little))
    return require_finite_matrix(X, name="Vocal features", columns=13), y, groups, source


def build_model(random_state=42):
    return make_pipeline(
        FunctionTransformer(log_perturbation_features),
        StandardScaler(),
        LogisticRegression(C=0.3, class_weight="balanced", max_iter=5000, random_state=random_state),
    )


def tier_rates(probabilities, y):
    detected = probabilities >= HIGH_THRESHOLD
    cleared = probabilities < LOW_THRESHOLD
    return {
        "pd_detected": float(detected[..., y == 1].mean()),
        "pd_inconclusive": float((~detected & ~cleared)[..., y == 1].mean()),
        "pd_not_detected": float(cleared[..., y == 1].mean()),
        "healthy_detected": float(detected[..., y == 0].mean()),
        "healthy_inconclusive": float((~detected & ~cleared)[..., y == 0].mean()),
        "healthy_not_detected": float(cleared[..., y == 0].mean()),
    }


def train_classifier(random_state=42, repeats=10):
    X, y, groups, source = load_screening_data()
    out_of_fold = []
    for seed in range(repeats):
        probabilities = np.zeros(len(y))
        cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=seed)
        for train_idx, test_idx in cv.split(X, y, groups):
            model = build_model(random_state).fit(X[train_idx], y[train_idx])
            probabilities[test_idx] = model.predict_proba(X[test_idx])[:, 1]
        out_of_fold.append(probabilities)
    out_of_fold = np.array(out_of_fold)
    cross_dataset = {}
    for train_name, test_name in (("sakar", "little"), ("little", "sakar")):
        model = build_model(random_state).fit(X[source == train_name], y[source == train_name])
        test = source == test_name
        cross_dataset[f"{train_name}_to_{test_name}_roc_auc"] = float(
            roc_auc_score(y[test], model.predict_proba(X[test])[:, 1])
        )
    metrics = {
        "roc_auc": float(np.mean([roc_auc_score(y, p) for p in out_of_fold])),
        "tiers": tier_rates(out_of_fold, y),
        **cross_dataset,
    }
    print("Speaker-independent CV:", metrics)

    model = build_model(random_state).fit(X, y)
    limitations = (
        f"Trained on {len(y)} sustained-vowel recordings from {len(np.unique(groups))} speakers "
        f"({len(np.unique(groups[y == 1]))} with Parkinson's, {len(np.unique(groups[y == 0]))} healthy) "
        "from two research datasets; validated only by speaker-independent cross-validation and "
        "cross-dataset transfer, not clinically. Phone and laptop microphones differ from the "
        "research recording setups. Screening research output, not a diagnosis."
    )
    bundle = {
        "model": model,
        "feature_columns": SCREENING_COLUMNS,
        # Inference clips inputs to the training range so out-of-distribution
        # audio features cannot drive the linear model to extreme probabilities.
        "feature_min": X.min(axis=0).tolist(),
        "feature_max": X.max(axis=0).tolist(),
        "metadata": {
            "model_version": MODEL_VERSION,
            "target": "status",
            "low_threshold": LOW_THRESHOLD,
            "high_threshold": HIGH_THRESHOLD,
            "tier_rates": metrics["tiers"],
            "roc_auc": metrics["roc_auc"],
            "random_state": random_state,
            "limitations": limitations,
        },
    }
    models_dir = os.path.join(BASE_DIR, "models")
    os.makedirs(models_dir, exist_ok=True)
    artifact_path = os.path.join(models_dir, "pd_classifier.pkl")
    joblib.dump(bundle, artifact_path)
    with open(artifact_path, "rb") as artifact_file:
        artifact_sha256 = hashlib.sha256(artifact_file.read()).hexdigest()
    write_metrics(os.path.join(models_dir, "pd_classifier_metrics.json"), {
        "model": MODEL_VERSION,
        "target": "status (1 = Parkinson's)",
        "protocol": f"StratifiedGroupKFold (5 folds by speaker, {repeats} repeats); cross-dataset transfer; refit on all speakers",
        "thresholds": {"not_detected_below": LOW_THRESHOLD, "detected_at_or_above": HIGH_THRESHOLD},
        "n_samples": int(len(y)),
        "n_speakers": int(len(np.unique(groups))),
        "metrics": metrics,
        "artifact_sha256": artifact_sha256,
        "limitations": limitations,
    })
    print(f"Saved screening classifier to {artifact_path}")
    return bundle


if __name__ == "__main__":
    train_classifier()
