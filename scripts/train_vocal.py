import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import joblib
import os
import hashlib

if __package__:
    from .feature_contract import VOICE_FEATURE_COLUMNS
    from .training_utils import (
        fit_training_scaler,
        require_finite_matrix,
        subject_independent_split,
        write_metrics,
    )
else:
    from feature_contract import VOICE_FEATURE_COLUMNS
    from training_utils import (
        fit_training_scaler,
        require_finite_matrix,
        subject_independent_split,
        write_metrics,
    )

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def vocal_feature_columns(df):
    missing = [column for column in VOICE_FEATURE_COLUMNS if column not in df.columns]
    if missing:
        raise ValueError(f"Vocal dataset is missing required features: {missing}.")
    return list(VOICE_FEATURE_COLUMNS)


def train_baseline(random_state=42):
    print("Loading Vocal Data for Baseline Model...")
    df = pd.read_csv(os.path.join(BASE_DIR, 'data', 'parkinsons_updrs.data'))

    # Target variable: motor_UPDRS
    feature_columns = vocal_feature_columns(df)
    X = require_finite_matrix(df[feature_columns].values, name="Vocal features")
    y = require_finite_matrix(
        df[['motor_UPDRS']].values, name="motor_UPDRS target", columns=1
    ).ravel()
    groups = df['subject#'].to_numpy()
    print(f"Dataset shape: {X.shape[0]} records, {X.shape[1]} vocal features.")

    train_indices, test_indices = subject_independent_split(
        groups, test_size=0.2, random_state=random_state
    )
    X_train, X_test = X[train_indices], X[test_indices]
    y_train, y_test = y[train_indices], y[test_indices]

    # Fit preprocessing on training subjects only.
    scaler, scaled_features = fit_training_scaler(X, train_indices)
    X_train_scaled = scaled_features[train_indices]
    X_test_scaled = scaled_features[test_indices]

    # Train Random Forest (The reference paper's optimal model)
    print("Training Random Forest Regressor (Baseline)...")
    rf_model = RandomForestRegressor(
        n_estimators=100, random_state=random_state, n_jobs=-1
    )
    rf_model.fit(X_train_scaled, y_train)

    # Evaluate
    predictions = rf_model.predict(X_test_scaled)
    rmse = np.sqrt(mean_squared_error(y_test, predictions))
    mae = mean_absolute_error(y_test, predictions)
    r2 = r2_score(y_test, predictions)

    print("-" * 40)
    print("SUBJECT-INDEPENDENT HOLDOUT (Vocal Data Only; exploratory):")
    print(f"RMSE:      {rmse:.4f}")
    print(f"MAE:       {mae:.4f}")
    print(f"R-squared: {r2:.4f}")
    print("-" * 40)
    # Keep the estimator, fitted preprocessing, and exact feature order together.
    models_dir = os.path.join(BASE_DIR, 'models')
    os.makedirs(models_dir, exist_ok=True)
    artifact_path = os.path.join(models_dir, 'baseline_rf_model.pkl')
    bundle = {
        'model': rf_model,
        'scaler': scaler,
        'feature_columns': feature_columns,
        'metadata': {
            'model_version': 'random-forest-updrs-v1',
            'target': 'motor_UPDRS',
            'split_protocol': 'GroupShuffleSplit by subject#; 80/20 holdout',
            'random_state': random_state,
            'limitations': (
                'Single subject-independent holdout on the supplied research '
                'dataset; not external validation or clinical evidence. The '
                'RPDE, DFA, and PPE values are supplied dataset features; this '
                'repository does not provide validated audio feature extraction.'
            ),
        },
    }
    joblib.dump(bundle, artifact_path)
    with open(artifact_path, 'rb') as artifact_file:
        artifact_sha256 = hashlib.sha256(artifact_file.read()).hexdigest()
    write_metrics(os.path.join(models_dir, 'baseline_rf_metrics.json'), {
        'model': 'random-forest-updrs-v1',
        'target': 'motor_UPDRS',
        'protocol': 'subject-independent GroupShuffleSplit (80/20 by subject#)',
        'random_state': random_state,
        'n_train_samples': int(len(train_indices)),
        'n_test_samples': int(len(test_indices)),
        'n_train_subjects': int(len(np.unique(groups[train_indices]))),
        'n_test_subjects': int(len(np.unique(groups[test_indices]))),
        'metrics': {'rmse': float(rmse), 'mae': float(mae), 'r2': float(r2)},
        'artifact_sha256': artifact_sha256,
        'limitations': bundle['metadata']['limitations'],
    })
    print(f"Saved model and fitted scaler to {artifact_path}")
    return bundle

if __name__ == "__main__":
    train_baseline()