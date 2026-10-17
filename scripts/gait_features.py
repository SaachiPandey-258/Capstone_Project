"""Stride-timing features from foot-pressure gait recordings.

Input is the PhysioNet "Gait in Parkinson's Disease" layout: 100 Hz rows of
19 columns (time, 8 left sensors, 8 right sensors, total left force, total
right force). Only the timing of foot contact is used, not force magnitude,
because sensor calibration and body weight differ between recordings.

Features follow the gait-variability literature (Hausdorff et al.): mean and
variability (coefficient of variation) of stride, stance and swing times,
swing percentage, cadence and left/right asymmetry.
"""

from __future__ import annotations

import numpy as np

SAMPLE_RATE_HZ = 100
MIN_STRIDES_PER_FOOT = 10

GAIT_FEATURE_COLUMNS = (
    "Stride time (s)",
    "Stride time CV (%)",
    "Stance time CV (%)",
    "Swing time CV (%)",
    "Swing (% of stride)",
    "Swing % CV (%)",
    "Cadence (steps/min)",
    "Swing asymmetry (%)",
    "Stride time asymmetry (%)",
)


class GaitFeatureError(ValueError):
    """The recording does not contain enough steady walking for stride analysis."""


def _foot_events(force: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Stride, stance and swing durations (s) for one foot's total force."""
    force = np.asarray(force, dtype=np.float64)
    if not np.isfinite(force).all() or force.max() <= 0:
        raise GaitFeatureError("Foot force signal is empty or invalid.")
    # Contact when force exceeds 10% of the foot's typical peak load.
    threshold = 0.1 * np.percentile(force, 95)
    contact = force > threshold
    edges = np.diff(contact.astype(np.int8))
    strikes = np.flatnonzero(edges == 1) + 1
    offs = np.flatnonzero(edges == -1) + 1
    if strikes.size < MIN_STRIDES_PER_FOOT + 2:
        raise GaitFeatureError("Too few foot contacts were detected.")
    strides, stances, swings = [], [], []
    for start, end in zip(strikes[:-1], strikes[1:]):
        off = offs[(offs > start) & (offs < end)]
        if off.size != 1:
            continue
        strides.append((end - start) / SAMPLE_RATE_HZ)
        stances.append((off[0] - start) / SAMPLE_RATE_HZ)
        swings.append((end - off[0]) / SAMPLE_RATE_HZ)
    strides, stances, swings = map(np.asarray, (strides, stances, swings))
    # Drop the first/last strides (gait initiation) and turns/pauses: keep
    # strides within 3 median absolute deviations of the median.
    if strides.size > 6:
        strides, stances, swings = strides[2:-2], stances[2:-2], swings[2:-2]
    if strides.size:
        median = np.median(strides)
        mad = np.median(np.abs(strides - median)) or 0.01
        keep = (np.abs(strides - median) <= 3 * 1.4826 * mad) & (strides > 0.6) & (strides < 2.5)
        strides, stances, swings = strides[keep], stances[keep], swings[keep]
    if strides.size < MIN_STRIDES_PER_FOOT:
        raise GaitFeatureError(
            f"Only {strides.size} usable strides were found; at least {MIN_STRIDES_PER_FOOT} per foot are needed "
            "(about 20 seconds of steady walking)."
        )
    return strides, stances, swings


def _cv(values: np.ndarray) -> float:
    return float(100 * np.std(values) / np.mean(values))


def gait_features(recording: np.ndarray) -> dict[str, float]:
    """Compute GAIT_FEATURE_COLUMNS from an (n_rows, 19) recording."""
    data = np.asarray(recording, dtype=np.float64)
    if data.ndim != 2 or data.shape[1] != 19:
        raise GaitFeatureError("Gait recording must have 19 columns.")
    left = _foot_events(data[:, 17])
    right = _foot_events(data[:, 18])
    stride = np.concatenate([left[0], right[0]])
    stance = np.concatenate([left[1], right[1]])
    swing = np.concatenate([left[2], right[2]])
    swing_pct = 100 * swing / stride
    left_swing, right_swing = np.mean(left[2]), np.mean(right[2])
    left_stride, right_stride = np.mean(left[0]), np.mean(right[0])
    values = {
        "Stride time (s)": float(np.mean(stride)),
        "Stride time CV (%)": _cv(stride),
        "Stance time CV (%)": _cv(stance),
        "Swing time CV (%)": _cv(swing),
        "Swing (% of stride)": float(np.mean(swing_pct)),
        "Swing % CV (%)": _cv(swing_pct),
        "Cadence (steps/min)": float(2 * 60 / np.mean(stride)),
        "Swing asymmetry (%)": float(100 * abs(left_swing - right_swing) / ((left_swing + right_swing) / 2)),
        "Stride time asymmetry (%)": float(100 * abs(left_stride - right_stride) / ((left_stride + right_stride) / 2)),
    }
    if not all(np.isfinite(list(values.values()))):
        raise GaitFeatureError("Gait features could not be computed.")
    return values
