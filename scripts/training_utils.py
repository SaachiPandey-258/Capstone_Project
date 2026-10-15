"""Shared training and preprocessing utilities."""

from __future__ import annotations

import json
import re
from typing import Any
import numpy as np
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler


def require_finite_matrix(
    data: Any, name: str = "Matrix", columns: int | None = None
) -> np.ndarray:
    try:
        matrix = np.asarray(data, dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must contain numeric values.") from exc
    if matrix.ndim == 1 and columns == 1:
        matrix = matrix.reshape(-1, 1)
    if matrix.ndim != 2:
        raise ValueError(f"{name} must be a 2D matrix.")
    if columns is not None and matrix.shape[1] != columns:
        raise ValueError(f"{name} must have {columns} columns, got {matrix.shape[1]}.")
    if not np.isfinite(matrix).all():
        raise ValueError(f"{name} must contain finite numbers only.")
    return matrix


def fit_training_scaler(
    values: np.ndarray, train_indices: np.ndarray
) -> tuple[StandardScaler, np.ndarray]:
    if not np.isfinite(values).all():
        raise ValueError("Values must be finite.")
    train_subset = values[train_indices]
    if not np.isfinite(train_subset).all():
        raise ValueError("Training values must be finite.")
    scaler = StandardScaler()
    scaler.fit(train_subset)
    transformed = scaler.transform(values)
    return scaler, transformed


def subject_independent_split(
    groups: np.ndarray, test_size: float = 0.2, random_state: int = 42
) -> tuple[np.ndarray, np.ndarray]:
    gss = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=random_state)
    train_idx, test_idx = next(gss.split(X=np.zeros(len(groups)), groups=groups))
    return train_idx, test_idx


def subject_group_from_filename(filename: str) -> str:
    match = re.match(r"^([A-Z]\d{2}[A-Z]{2})", filename)
    if not match:
        raise ValueError(f"Cannot extract subject identity from {filename}")
    return match.group(1)


def write_metrics(path: str, metrics: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)


def log_perturbation_features(values: Any) -> np.ndarray:
    """Log-scale the 12 jitter/shimmer/NHR columns of a 13-feature Praat row.

    Perturbation measures are strictly positive and roughly log-normal, and
    their absolute scale differs between recording setups; log space turns
    those setup differences into offsets a linear model handles more robustly.
    HNR (last column, already in dB) is left unchanged.
    """
    matrix = np.asarray(values, dtype=np.float64).copy()
    matrix[:, :12] = np.log(np.maximum(matrix[:, :12], 1e-7))
    return matrix
