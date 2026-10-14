"""Contract and validation for gait sensor windows."""

from __future__ import annotations

import os
import csv
import io
import numpy as np

GAIT_TIMESTEPS = 200
GAIT_COLUMNS = 19
MAX_GAIT_WINDOW_BYTES = 512 * 1024
MAX_GAIT_RECORDING_BYTES = 25 * 1024 * 1024


def parse_gait_recording(contents: bytes, filename: str) -> tuple[np.ndarray, int]:
    """Parse a portal upload using the training dataset's 19-column contract."""
    if len(contents) > MAX_GAIT_RECORDING_BYTES:
        raise ValueError("Gait file exceeds the 25 MiB upload limit.")
    try:
        text = contents.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Gait file must be valid UTF-8 text.") from exc
    rows: list[list[float]] = []
    delimiter = "," if filename.lower().endswith(".csv") else None
    for raw_line in text.splitlines():
        if not raw_line.strip():
            continue
        cells = (
            next(csv.reader([raw_line], delimiter=","))
            if delimiter == ","
            else raw_line.split()
        )
        try:
            values = [float(cell.strip()) for cell in cells]
        except ValueError:
            if rows:
                raise ValueError("Gait data rows must contain numeric values.")
            continue
        if len(values) != GAIT_COLUMNS:
            raise ValueError(
                f"Gait data must contain exactly {GAIT_COLUMNS} columns in the "
                "time, left sensors, right sensors, total-force order."
            )
        rows.append(values)
    if len(rows) < GAIT_TIMESTEPS:
        raise ValueError(
            f"Gait recording must contain at least {GAIT_TIMESTEPS} numeric rows."
        )
    recording = np.asarray(rows, dtype=np.float32)
    return first_gait_window(recording), len(rows)


def validate_gait_window(window: object) -> np.ndarray:
    try:
        matrix = np.asarray(window, dtype=np.float32)
    except (TypeError, ValueError) as exc:
        raise ValueError("Gait window must contain numeric values.") from exc
    if matrix.ndim != 2 or matrix.shape != (GAIT_TIMESTEPS, GAIT_COLUMNS):
        raise ValueError(
            f"Gait window must have shape ({GAIT_TIMESTEPS}, {GAIT_COLUMNS}), "
            f"got {matrix.shape}."
        )
    if not np.isfinite(matrix).all():
        raise ValueError("Gait window must contain finite numbers only.")
    return matrix


def first_gait_window(recording: object) -> np.ndarray:
    matrix = np.asarray(recording, dtype=np.float32)
    if matrix.ndim != 2:
        raise ValueError("Gait recording must be a 2D matrix.")
    if matrix.shape[1] != GAIT_COLUMNS:
        raise ValueError(f"Gait recording must have 19 columns, got {matrix.shape[1]}.")
    if matrix.shape[0] < GAIT_TIMESTEPS:
        raise ValueError(
            f"Gait recording must have at least {GAIT_TIMESTEPS} rows, "
            f"got {matrix.shape[0]}."
        )
    return validate_gait_window(matrix[:GAIT_TIMESTEPS])


def load_gait_window(path: str) -> np.ndarray:
    if os.path.getsize(path) > MAX_GAIT_WINDOW_BYTES:
        raise ValueError("File exceeds maximum allowed size.")
    try:
        data = np.loadtxt(path)
    except Exception as exc:
        raise ValueError("Gait file must be a valid numeric matrix.") from exc
    if data.ndim != 2 or data.shape != (GAIT_TIMESTEPS, GAIT_COLUMNS):
        raise ValueError(f"Gait window shape must be ({GAIT_TIMESTEPS}, {GAIT_COLUMNS}).")
    if not np.isfinite(data).all():
        raise ValueError("Gait window must contain finite numbers only.")
    return validate_gait_window(data)
