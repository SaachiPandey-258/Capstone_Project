"""Extract the 16 contract features from raw research audio with the portal's own code.

Default input is data/iyer2023 (Iyer et al., 2023, "Voice Samples for Patients
with Parkinson's Disease and Healthy Controls", figshare
doi:10.6084/m9.figshare.23849127, CC BY 4.0): sustained /a/ recorded on
participants' telephones, 40 people with Parkinson's (PD_AH) and 41 healthy
controls (HC_AH), one recording each.

Because these features come from backend.audio_features, a model trained or
validated on them sees exactly the measurement pipeline used for live
recordings, unlike the published feature tables.

    python -m scripts.extract_audio_dataset  ->  data/iyer2023_features.csv
"""

import csv
import glob
import os
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
from scipy.io import wavfile

from backend.audio_features import AudioExtractionError, steady_segment_features
from scripts.feature_contract import SPECTRAL_FEATURE_COLUMNS, VOICE_FEATURE_COLUMNS

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The research clips are short (median ~3 s); the live app requires more steady voice.
MIN_STABLE_SECONDS = 0.8


def _read_mono(path):
    sample_rate, data = wavfile.read(path)
    data = np.asarray(data)
    if data.dtype.kind == "i":
        data = data / float(np.iinfo(data.dtype).max)
    elif data.dtype.kind == "u":
        data = (data - 128.0) / 128.0
    data = data.astype(np.float64)
    if data.ndim > 1:
        data = data.mean(axis=1)
    return data, int(sample_rate)


def read_demographics(path):
    """Sample ID -> (age, sex) from the dataset's xlsx without needing openpyxl."""
    if not os.path.isfile(path):
        return {}
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(path) as workbook:
        strings = [
            "".join(text.text or "" for text in item.iter(ns + "t"))
            for item in ET.fromstring(workbook.read("xl/sharedStrings.xml")).findall(ns + "si")
        ]
        sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
    result = {}
    for row in list(sheet.iter(ns + "row"))[1:]:
        cells = []
        for cell in row.findall(ns + "c"):
            value = cell.find(ns + "v")
            value = None if value is None else value.text
            cells.append(strings[int(value)] if cell.get("t") == "s" and value is not None else value)
        if len(cells) >= 4 and cells[0]:
            result[cells[0]] = (float(cells[2]), cells[3])
    return result


def extract(root=os.path.join(BASE_DIR, "data", "iyer2023"),
            output=os.path.join(BASE_DIR, "data", "iyer2023_features.csv")):
    rows, skipped = [], []
    demographics = read_demographics(os.path.join(root, "Demographics_age_sex.xlsx"))
    for folder, label in (("PD_AH", 1), ("HC_AH", 0)):
        for path in sorted(glob.glob(os.path.join(root, folder, "*.wav"))):
            recording_id = os.path.splitext(os.path.basename(path))[0]
            try:
                samples, sample_rate = _read_mono(path)
                values, spectral, info = steady_segment_features(samples, sample_rate, MIN_STABLE_SECONDS)
            except (AudioExtractionError, ValueError) as exc:
                skipped.append((recording_id, str(exc)))
                continue
            age, sex = demographics.get(recording_id, (None, None))
            rows.append({
                "id": recording_id,
                "status": label,
                "age": age,
                "sex": sex,
                **dict(zip(VOICE_FEATURE_COLUMNS, values.tolist())),
                **dict(zip(SPECTRAL_FEATURE_COLUMNS, spectral.tolist())),
                "stable_voiced_seconds": info["stable_voiced_seconds"],
            })
    with open(output, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Extracted {len(rows)} recordings to {output}; skipped {len(skipped)}.")
    for recording_id, reason in skipped:
        print(f"  skipped {recording_id}: {reason}")
    return rows, skipped


if __name__ == "__main__":
    extract()
