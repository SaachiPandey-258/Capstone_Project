"""Fail-closed research audio feature extraction.

The extractor normalizes supported recordings to mono 16 kHz PCM, uses
Parselmouth for the 13 Praat-compatible measures, and implements the three
nonlinear measures from documented signal-processing definitions.  These
features are research inputs only; this module does not establish clinical
validity.
"""

from __future__ import annotations

import io
import math
import shutil
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import signal

from scripts.feature_contract import VOICE_FEATURE_COLUMNS

EXTRACTION_VERSION = "audio-extractor-v1"
TARGET_SAMPLE_RATE = 16_000
SUPPORTED_SUFFIXES = {".webm", ".wav", ".ogg", ".mp3", ".m4a"}


class AudioExtractionError(RuntimeError):
    """A recording cannot safely produce a complete feature row."""


@dataclass(frozen=True)
class ExtractionResult:
    features: dict[str, float]
    sample_rate: int
    duration_seconds: float
    quality: dict[str, Any]
    version: str = EXTRACTION_VERSION


def _decode_wav(data: bytes) -> tuple[np.ndarray, int]:
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels, width, sample_rate, frames = (
                wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()
            )
            if channels < 1 or sample_rate < 1 or width not in (1, 2, 3, 4):
                raise AudioExtractionError("WAV header has unsupported audio parameters.")
            raw = wav.readframes(frames)
    except (wave.Error, EOFError) as exc:
        raise AudioExtractionError("WAV audio could not be decoded.") from exc
    dtype = {1: np.uint8, 2: np.int16, 3: np.uint8, 4: np.int32}[width]
    if width == 3:
        packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        values = (packed[:, 0].astype(np.int32)
                  | (packed[:, 1].astype(np.int32) << 8)
                  | (packed[:, 2].astype(np.int32) << 16))
        values = np.where(values & 0x800000, values - 0x1000000, values).astype(np.float64)
        audio = values / float(1 << 23)
    else:
        audio = np.frombuffer(raw, dtype=dtype).astype(np.float64)
        if width == 1:
            audio = (audio - 128.0) / 128.0
        else:
            audio /= float(1 << (width * 8 - 1))
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio, sample_rate


def decode_audio(data: bytes, suffix: str) -> tuple[np.ndarray, int]:
    """Decode to finite mono samples, using stdlib WAV or an installed ffmpeg."""
    suffix = suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise AudioExtractionError("Unsupported audio codec; use WebM, WAV, OGG, MP3, or M4A.")
    if suffix == ".wav":
        return _decode_wav(data)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise AudioExtractionError(
            f"{suffix[1:].upper()} decoding is unavailable because ffmpeg is not installed."
        )
    try:
        completed = subprocess.run(
            [ffmpeg, "-v", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1",
             "-ar", str(TARGET_SAMPLE_RATE), "pipe:1"],
            input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False, timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise AudioExtractionError("Audio decoding failed or timed out.") from exc
    if completed.returncode != 0 or not completed.stdout:
        raise AudioExtractionError("Audio codec could not be decoded.")
    return np.frombuffer(completed.stdout, dtype="<f4").astype(np.float64), TARGET_SAMPLE_RATE


def _resample_mono(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    samples = np.asarray(samples, dtype=np.float64).reshape(-1)
    if sample_rate != TARGET_SAMPLE_RATE:
        gcd = math.gcd(int(sample_rate), TARGET_SAMPLE_RATE)
        samples = signal.resample_poly(
            samples, TARGET_SAMPLE_RATE // gcd, int(sample_rate) // gcd
        )
    return samples


def _validate_quality(samples: np.ndarray, duration_hint: float | None) -> dict[str, Any]:
    if samples.size < TARGET_SAMPLE_RATE * 3:
        raise AudioExtractionError("Recording is shorter than the required 3 seconds.")
    if not np.isfinite(samples).all():
        raise AudioExtractionError("Recording contains non-finite samples.")
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples * samples)))
    if peak <= 1e-6 or rms <= 1e-5:
        raise AudioExtractionError("Recording is silent or below the usable signal level.")
    if peak > 1.05:
        raise AudioExtractionError("Recording is clipped or outside the supported PCM range.")
    clipped_fraction = float(np.mean(np.abs(samples) >= 0.999))
    if clipped_fraction > 0.01:
        raise AudioExtractionError("Recording is excessively clipped.")
    if rms / max(peak, 1e-12) < 0.01:
        raise AudioExtractionError("Recording has insufficient signal quality.")
    duration = samples.size / TARGET_SAMPLE_RATE
    if duration_hint is not None and abs(duration - duration_hint) > 2:
        raise AudioExtractionError("Uploaded duration does not match decoded audio.")
    return {
        "duration_seconds": round(duration, 4),
        "rms": rms,
        "peak": peak,
        "clipped_fraction": clipped_fraction,
        "sample_count": int(samples.size),
    }


def _nonlinear_features(samples: np.ndarray) -> tuple[float, float, float]:
    """Compute RPDE, DFA, and PPE using standard recurrence/scaling/entropy formulas."""
    centered = samples - np.mean(samples)
    analytic = signal.hilbert(centered)
    phase = np.unwrap(np.angle(analytic))
    phase_diff = np.diff(phase)
    if phase_diff.size < 1000 or np.std(phase_diff) <= 1e-8:
        raise AudioExtractionError("Nonlinear features are not identifiable from this signal.")

    # RPDE: normalized Shannon entropy of recurrence periods of the analytic phase.
    period = 2 * np.pi / max(float(np.median(np.abs(phase_diff))), 1e-8)
    crossings = np.flatnonzero(np.diff((phase % (2 * np.pi)) > np.pi) != 0)
    gaps = np.diff(crossings)
    if gaps.size < 10:
        raise AudioExtractionError("RPDE requires a stable periodic recurrence sequence.")
    hist, _ = np.histogram(gaps, bins=min(32, max(8, int(np.sqrt(gaps.size)))), density=False)
    probabilities = hist[hist > 0] / hist.sum()
    rpde = float(-(probabilities * np.log(probabilities)).sum() / np.log(len(hist)))

    # DFA: slope of log fluctuation versus log window size for the integrated signal.
    profile = np.cumsum(centered)
    sizes = np.unique(np.geomspace(16, min(profile.size // 8, 2048), 12).astype(int))
    logs_x, logs_y = [], []
    for size in sizes:
        count = profile.size // size
        if count < 2:
            continue
        chunks = profile[:count * size].reshape(count, size)
        x = np.arange(size, dtype=np.float64)
        fluctuation = []
        for chunk in chunks:
            coeff = np.polyfit(x, chunk, 1)
            fluctuation.append(np.sqrt(np.mean((chunk - np.polyval(coeff, x)) ** 2)))
        value = float(np.mean(fluctuation))
        if value > 0 and np.isfinite(value):
            logs_x.append(np.log(size))
            logs_y.append(np.log(value))
    if len(logs_x) < 5:
        raise AudioExtractionError("DFA did not produce enough valid scales.")
    dfa = float(np.polyfit(logs_x, logs_y, 1)[0])

    # PPE: normalized Shannon entropy of the distribution of instantaneous periods.
    periods = 2 * np.pi / np.maximum(np.abs(phase_diff), 1e-8)
    periods = periods[np.isfinite(periods) & (periods > 1)]
    if periods.size < 100:
        raise AudioExtractionError("PPE requires enough stable instantaneous periods.")
    hist, _ = np.histogram(np.log(periods), bins=32, density=False)
    probabilities = hist[hist > 0] / hist.sum()
    ppe = float(-(probabilities * np.log(probabilities)).sum() / np.log(32))
    values = (rpde, dfa, ppe)
    if not all(np.isfinite(values)) or not (0 <= rpde <= 1 and 0.1 <= dfa <= 3 and 0 <= ppe <= 1):
        raise AudioExtractionError("Nonlinear features failed finite/range validation.")
    return values


def extract_audio_features(
    data: bytes, suffix: str, duration_hint: float | None = None
) -> ExtractionResult:
    samples, sample_rate = decode_audio(data, suffix)
    samples = _resample_mono(samples, sample_rate)
    quality = _validate_quality(samples, duration_hint)
    try:
        import parselmouth
        from parselmouth.praat import call
    except ImportError as exc:
        raise AudioExtractionError("praat-parselmouth is not installed.") from exc
    try:
        sound = parselmouth.Sound(samples, sampling_frequency=TARGET_SAMPLE_RATE)
        point_process = call(sound, "To PointProcess (periodic, cc)", 75, 500)
        pitch = call(sound, "To Pitch", 0.0, 75, 500)
        harmonicity = call(sound, "To Harmonicity (cc)", 0.01, 75, 0.1, 1.0)
        values = [
            call(point_process, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3) * 100,
            call(point_process, "Get jitter (local, absolute)", 0, 0, 0.0001, 0.02, 1.3),
            call(point_process, "Get jitter (rap)", 0, 0, 0.0001, 0.02, 1.3),
            call(point_process, "Get jitter (ppq5)", 0, 0, 0.0001, 0.02, 1.3),
            call(point_process, "Get jitter (ddp)", 0, 0, 0.0001, 0.02, 1.3),
            call([sound, point_process], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6),
            call([sound, point_process], "Get shimmer (local_dB)", 0, 0, 0.0001, 0.02, 1.3, 1.6),
            call([sound, point_process], "Get shimmer (apq3)", 0, 0, 0.0001, 0.02, 1.3, 1.6),
            call([sound, point_process], "Get shimmer (apq5)", 0, 0, 0.0001, 0.02, 1.3, 1.6),
            call([sound, point_process], "Get shimmer (apq11)", 0, 0, 0.0001, 0.02, 1.3, 1.6),
            call([sound, point_process], "Get shimmer (dda)", 0, 0, 0.0001, 0.02, 1.3, 1.6),
            1 / max(float(call(harmonicity, "Get mean", 0, 0)), 1e-9),
            float(call(harmonicity, "Get mean", 0, 0)),
        ]
        rpde, dfa, ppe = _nonlinear_features(samples)
        values.extend((rpde, dfa, ppe))
    except Exception as exc:
        raise AudioExtractionError(
            "Praat feature extraction failed; recording quality or voicing was insufficient."
        ) from exc
    values = np.asarray(values, dtype=np.float64)
    if values.shape != (16,) or not np.isfinite(values).all():
        raise AudioExtractionError("Extracted features failed finite/schema validation.")
    if values[0] < 0 or values[5] < 0 or values[11] < 0 or values[12] <= 0:
        raise AudioExtractionError("Extracted perturbation or harmonicity values are invalid.")
    features = dict(zip(VOICE_FEATURE_COLUMNS, values.tolist()))
    quality["voiced_feature_count"] = 16
    quality["quality_status"] = "validated"
    return ExtractionResult(features, TARGET_SAMPLE_RATE, quality["duration_seconds"], quality)
