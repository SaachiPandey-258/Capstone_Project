"""Exact acoustic feature order expected by the voice model."""

VOICE_FEATURE_COLUMNS = (
    "Jitter(%)",
    "Jitter(Abs)",
    "Jitter:RAP",
    "Jitter:PPQ5",
    "Jitter:DDP",
    "Shimmer",
    "Shimmer(dB)",
    "Shimmer:APQ3",
    "Shimmer:APQ5",
    "Shimmer:APQ11",
    "Shimmer:DDA",
    "NHR",
    "HNR",
    "RPDE",
    "DFA",
    "PPE",
)


class AudioFeatureValidationRequired(RuntimeError):
    """Raised until raw audio yields validated values for the complete schema."""


# Spectral/cepstral/pitch-variability measures computed from live audio
# (band-limited to the 0-4 kHz telephone band so every recording source is
# measured identically). Used by the audio screening model.
SPECTRAL_FEATURE_COLUMNS = (
    *(f"MFCC{i} SD" for i in range(1, 13)),
    *(f"MFCC{i} delta SD" for i in range(1, 13)),
    "CPPS",
    "F0 SD (semitones)",
    "F0 range (semitones)",
    "Spectral tilt (dB)",
)
