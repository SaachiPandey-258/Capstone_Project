import io
import wave

import numpy as np
import pytest

from backend.audio_features import AudioExtractionError, extract_audio_features
from scripts.feature_contract import VOICE_FEATURE_COLUMNS


def sine_wav(seconds=5, sample_rate=16_000):
    time = np.arange(int(seconds * sample_rate)) / sample_rate
    samples = 0.2 * np.sin(2 * np.pi * 180 * time)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes((samples * 32767).astype("<i2").tobytes())
    return output.getvalue()


def test_synthetic_wav_produces_exact_finite_contract():
    result = extract_audio_features(sine_wav(), ".wav", duration_hint=5)
    assert list(result.features) == list(VOICE_FEATURE_COLUMNS)
    assert all(np.isfinite(list(result.features.values())))
    assert result.sample_rate == 16_000
    assert result.quality["quality_status"] == "validated"


def test_silent_audio_fails_closed():
    samples = np.zeros(16_000 * 5, dtype="<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16_000)
        wav.writeframes(samples.tobytes())
    with pytest.raises(AudioExtractionError, match="silent"):
        extract_audio_features(output.getvalue(), ".wav", duration_hint=5)
