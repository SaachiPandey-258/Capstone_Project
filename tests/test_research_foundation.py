import hashlib
import json
import os
import tempfile
import unittest

import joblib
import numpy as np
import pandas as pd
import torch
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler

from scripts.gait_contract import (
    GAIT_COLUMNS,
    GAIT_TIMESTEPS,
    MAX_GAIT_WINDOW_BYTES,
    first_gait_window,
    load_gait_window,
    validate_gait_window,
)
from scripts.inference import (
    ModelNotReadyError,
    predict_fusion_features,
    predict_voice_audio,
    predict_voice_features,
)
from scripts.feature_contract import AudioFeatureValidationRequired, VOICE_FEATURE_COLUMNS
from scripts.plot_comparison import generate_comparison
from scripts.train_fusion import MetaLearnerFusion
from scripts.train_vocal import vocal_feature_columns
from scripts.training_utils import (
    fit_training_scaler,
    subject_group_from_filename,
    subject_independent_split,
)


class TrainingFoundationTests(unittest.TestCase):
    def test_vocal_feature_order_matches_dataset_schema(self):
        frame = pd.read_csv("data/parkinsons_updrs.data", nrows=1)
        self.assertEqual(
            vocal_feature_columns(frame),
            [
                "Jitter(%)", "Jitter(Abs)", "Jitter:RAP", "Jitter:PPQ5",
                "Jitter:DDP", "Shimmer", "Shimmer(dB)", "Shimmer:APQ3",
                "Shimmer:APQ5", "Shimmer:APQ11", "Shimmer:DDA", "NHR",
                "HNR", "RPDE", "DFA", "PPE",
            ],
        )

    def test_subject_split_is_deterministic_and_disjoint(self):
        groups = np.repeat(np.arange(10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        train, test = subject_independent_split(groups)
        train_again, test_again = subject_independent_split(groups)
        self.assertTrue(np.array_equal(train, train_again))
        self.assertTrue(np.array_equal(test, test_again))
        self.assertFalse(set(groups[train]) & set(groups[test]))

    def test_scaler_uses_training_rows_only(self):
        values = np.array([[1.0, 10.0], [3.0, 30.0], [100.0, 1000.0]])
        scaler, transformed = fit_training_scaler(values, np.array([0, 1]))
        np.testing.assert_allclose(scaler.mean_, [2.0, 20.0])
        self.assertGreater(float(transformed[2, 0]), 1.0)

    def test_nonfinite_training_features_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "finite"):
            fit_training_scaler(
                np.array([[1.0], [np.inf]]), np.array([0])
            )

    def test_drawing_filename_subject_groups(self):
        for filename, expected in (
            ("V03HE1.png", "V03HE"),
            ("V14PE03.png", "V14PE"),
            ("V55HO15.png", "V55HO"),
            ("V03PO07.png", "V03PO"),
        ):
            with self.subTest(filename=filename):
                self.assertEqual(subject_group_from_filename(filename), expected)
        with self.assertRaisesRegex(ValueError, "Cannot extract subject identity"):
            subject_group_from_filename("drawing.png")


class GaitContractTests(unittest.TestCase):
    def test_exact_contract_preserves_channel_order(self):
        window = np.arange(GAIT_TIMESTEPS * GAIT_COLUMNS, dtype=np.float32).reshape(
            GAIT_TIMESTEPS, GAIT_COLUMNS
        )
        validated = validate_gait_window(window)
        self.assertEqual(validated.shape, (200, 19))
        np.testing.assert_array_equal(validated, window)

    def test_short_oversized_and_incompatible_windows_are_rejected(self):
        short = np.zeros((199, GAIT_COLUMNS))
        oversized = np.zeros((201, GAIT_COLUMNS))
        wrong_columns = np.zeros((GAIT_TIMESTEPS, GAIT_COLUMNS + 1))
        for sample in (short, oversized, wrong_columns):
            with self.subTest(shape=sample.shape), self.assertRaises(ValueError):
                validate_gait_window(sample)

    def test_nonfinite_and_nonnumeric_values_are_rejected(self):
        nonfinite = np.zeros((GAIT_TIMESTEPS, GAIT_COLUMNS))
        nonfinite[0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, "finite"):
            validate_gait_window(nonfinite)
        with self.assertRaisesRegex(ValueError, "numeric"):
            validate_gait_window([["not-a-number"]])

    def test_full_training_recording_is_windowed_without_padding(self):
        recording = np.arange(250 * GAIT_COLUMNS).reshape(250, GAIT_COLUMNS)
        window = first_gait_window(recording)
        np.testing.assert_array_equal(window, recording[:200])
        with self.assertRaisesRegex(ValueError, "at least 200"):
            first_gait_window(recording[:199])
        with self.assertRaisesRegex(ValueError, "19 columns"):
            first_gait_window(np.zeros((250, GAIT_COLUMNS - 1)))

    def test_gait_file_rejects_oversized_malformed_and_short_payloads(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "window.txt")
            with open(path, "w", encoding="utf-8") as output:
                output.write("0 " * (MAX_GAIT_WINDOW_BYTES + 1))
            with self.assertRaisesRegex(ValueError, "maximum"):
                load_gait_window(path)

            np.savetxt(path, np.zeros((199, GAIT_COLUMNS)))
            with self.assertRaisesRegex(ValueError, "shape"):
                load_gait_window(path)

            nonfinite = np.zeros((GAIT_TIMESTEPS, GAIT_COLUMNS))
            nonfinite[4, 7] = np.inf
            np.savetxt(path, nonfinite)
            with self.assertRaisesRegex(ValueError, "finite"):
                load_gait_window(path)

            np.savetxt(path, np.zeros((GAIT_TIMESTEPS, GAIT_COLUMNS + 1)))
            with self.assertRaisesRegex(ValueError, "shape"):
                load_gait_window(path)

            with open(path, "w", encoding="utf-8") as output:
                output.write("broken input\n")
            with self.assertRaisesRegex(ValueError, "numeric matrix"):
                load_gait_window(path)


class InferenceReadinessTests(unittest.TestCase):
    def _voice_artifact(self, directory):
        features = np.arange(64, dtype=np.float64).reshape(4, 16)
        scaler = StandardScaler().fit(features)
        model = RandomForestRegressor(n_estimators=2, random_state=1).fit(
            scaler.transform(features), np.arange(4, dtype=np.float64)
        )
        columns = list(VOICE_FEATURE_COLUMNS)
        path = os.path.join(directory, "voice.pkl")
        joblib.dump({
            "model": model,
            "scaler": scaler,
            "feature_columns": columns,
            "metadata": {
                "model_version": "random-forest-updrs-v1",
                "target": "motor_UPDRS",
            },
        }, path)
        return path, features, columns

    def test_missing_voice_artifact_fails_explicitly(self):
        with self.assertRaises(ModelNotReadyError):
            predict_voice_features(np.zeros((1, 16)), "/missing/voice.pkl")

    def test_voice_feature_schema_and_audio_readiness(self):
        with tempfile.TemporaryDirectory() as directory:
            path, features, columns = self._voice_artifact(directory)
            prediction = predict_voice_features(features[:1], path)
            self.assertEqual(prediction.shape, (1,))
            bundle = joblib.load(path)
            expected = bundle["model"].predict(bundle["scaler"].transform(features[:1]))
            np.testing.assert_allclose(prediction, expected)
            named_features = dict(zip(columns, features[0]))
            self.assertEqual(
                predict_voice_features(named_features, path).shape, (1,)
            )
            reordered_features = dict(reversed(list(named_features.items())))
            with self.assertRaisesRegex(ValueError, "names/order"):
                predict_voice_features(reordered_features, path)
            with self.assertRaisesRegex(ValueError, "finite"):
                predict_voice_features(np.full((1, 16), np.nan), path)
            bundle["feature_columns"] = list(reversed(columns))
            incompatible_path = os.path.join(directory, "incompatible-voice.pkl")
            joblib.dump(bundle, incompatible_path)
            with self.assertRaisesRegex(ModelNotReadyError, "invalid feature schema"):
                predict_voice_features(features[:1], incompatible_path)
        with self.assertRaisesRegex(AudioFeatureValidationRequired, "RPDE, DFA, and PPE"):
            predict_voice_audio(b"audio")

    def test_fusion_artifact_pairing_and_gait_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            scaler_path = os.path.join(directory, "fusion_vocal_scaler.joblib")
            checkpoint_path = os.path.join(directory, "fusion_model.pt")
            scaler = StandardScaler().fit(np.zeros((3, 16)))
            joblib.dump(scaler, scaler_path)
            with open(scaler_path, "rb") as source:
                digest = hashlib.sha256(source.read()).hexdigest()
            model = MetaLearnerFusion()
            torch.save({
                "model_state_dict": model.state_dict(),
                "feature_columns": list(VOICE_FEATURE_COLUMNS),
                "model_version": "dual-branch-fusion-updrs-v1",
                "target": "motor_UPDRS",
                "gait_timesteps": 200,
                "gait_columns": 19,
                "scaler_sha256": digest,
            }, checkpoint_path)
            prediction = predict_fusion_features(
                np.zeros((1, 16)),
                np.zeros((GAIT_TIMESTEPS, GAIT_COLUMNS)),
                directory,
            )
            self.assertEqual(prediction.shape, (1,))
            bad_gait = np.zeros((199, GAIT_COLUMNS))
            with self.assertRaisesRegex(ValueError, "shape"):
                predict_fusion_features(np.zeros((1, 16)), bad_gait, directory)

            with open(scaler_path, "ab") as target:
                target.write(b"changed")
            with self.assertRaisesRegex(ModelNotReadyError, "does not match"):
                predict_fusion_features(
                    np.zeros((1, 16)),
                    np.zeros((GAIT_TIMESTEPS, GAIT_COLUMNS)),
                    directory,
                )


class MetricsOutputTests(unittest.TestCase):
    def test_comparison_uses_current_metrics_including_negative_r2(self):
        with tempfile.TemporaryDirectory() as directory:
            metrics = {
                "baseline_rf_metrics.json": {
                    "metrics": {"rmse": 8.0, "mae": 6.0, "r2": -0.2}
                },
                "fusion_metrics.json": {
                    "metrics": {"rmse": 7.0, "mae": 5.0, "r2": -0.4}
                },
            }
            for filename, contents in metrics.items():
                with open(os.path.join(directory, filename), "w", encoding="utf-8") as output:
                    json.dump(contents, output)
            image_path = os.path.join(directory, "comparison.png")
            generate_comparison(directory, image_path)
            self.assertGreater(os.path.getsize(image_path), 0)


if __name__ == "__main__":
    unittest.main()
