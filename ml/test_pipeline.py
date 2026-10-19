"""Leakage, integrity and end-to-end checks using an isolated dataset snapshot."""
import csv
import io
import json
import math
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
from sklearn.impute import SimpleImputer

from common import (ML_ROOT, FEATURES, check_features, digest, feature_vector,
                    historical_features, load_dataset, load_model, load_training,
                    parse_time, temporal_split, write_json)
from evaluate import classification_metrics, transition_metrics, evaluate
from predict import predict
from train import train


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sprint7-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        pointer = json.loads((ML_ROOT / "latest-dataset.json").read_text())
        self.directory = self.root / pointer["directory"]
        shutil.copytree(ML_ROOT / pointer["directory"], self.directory)
        write_json(self.root / "latest-dataset.json", pointer)

    def republish(self, name, hash_field, contents):
        """Update declared hashes to ensure semantic checks also catch corruption."""
        (self.directory / name).write_bytes(contents)
        manifest = json.loads((self.directory / "dataset-manifest.json").read_text())
        manifest[hash_field] = digest(contents)
        write_json(self.directory / "dataset-manifest.json", manifest)
        write_json(self.root / "latest-dataset.json", {
            "directory": str(self.directory.relative_to(self.root)),
            "manifest_sha256": digest((self.directory / "dataset-manifest.json").read_bytes()),
        })

    def test_snapshot_lineage_and_predictor_allowlist(self):
        dataset = load_dataset(self.root)
        self.assertEqual(len(FEATURES), 20)
        self.assertNotIn("next_execution_failed", FEATURES)
        self.assertNotIn("fault_variant", FEATURES)
        self.assertNotIn("test_id", FEATURES)
        self.assertGreater(len(dataset["rows"]), 0)
        for row in dataset["rows"]:
            self.assertLess(parse_time(row["history_end_time"]), parse_time(row["prediction_time"]))
            self.assertNotIn(row["target_execution_id"], json.loads(row["history_execution_ids"]))
            self.assertEqual(len(row["_vector"]), 20)

    def test_artifact_corruption_rejected(self):
        with (self.directory / "training-data.csv").open("ab") as stream:
            stream.write(b"corrupt")
        with self.assertRaisesRegex(ValueError, "artifact hash mismatch"):
            load_dataset(self.root)

    def test_forged_feature_rejected_even_with_matching_hashes(self):
        reader = csv.DictReader(io.StringIO((self.directory / "training-data.csv").read_text()))
        columns = reader.fieldnames
        rows = list(reader)
        rows[0]["failure_rate"] = str(1 - float(rows[0]["failure_rate"]))
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader(); writer.writerows(rows)
        self.republish("training-data.csv", "training_data_sha256", output.getvalue().encode())
        with self.assertRaisesRegex(ValueError, "Feature lineage mismatch"):
            load_dataset(self.root)

    def test_forged_target_rejected(self):
        reader = csv.DictReader(io.StringIO((self.directory / "training-data.csv").read_text()))
        columns = reader.fieldnames
        rows = list(reader)
        rows[0]["next_execution_failed"] = str(1 - int(rows[0]["next_execution_failed"]))
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader(); writer.writerows(rows)
        self.republish("training-data.csv", "training_data_sha256", output.getvalue().encode())
        with self.assertRaisesRegex(ValueError, "Label or attempt lineage mismatch"):
            load_dataset(self.root)

    def test_end_to_end_models_metrics_and_safe_abstention(self):
        dataset = load_dataset(self.root)
        manifest = train(self.root)
        report = evaluate(self.root)
        forecasts = predict(self.root)
        directory, loaded = load_training(self.root)
        self.assertEqual(loaded["training_id"], manifest["training_id"])
        index = {row["sample_id"]: row for row in dataset["rows"]}
        for cohort, info in manifest["cohorts"].items():
            self.assertFalse(set(info["train_blocks"]) & set(info["test_blocks"]))
            for sample_id in info["train_sample_ids"]:
                row = index[sample_id]
                self.assertEqual(row["cohort"], cohort)
                self.assertLess(parse_time(row["target_end_time"]), parse_time(info["cutoff"]))
            if cohort == "progression":
                train_series = {index[key]["series_id"] for key in info["train_sample_ids"]}
                test_series = {index[key]["series_id"] for key in info["test_sample_ids"]}
                self.assertFalse(train_series & test_series)
            if info["models"]:
                self.assertEqual(set(info["models"]), {"decision_tree", "random_forest", "label_history_only", "warning_signals_only"})
                for name, artifact in info["models"].items():
                    model = load_model(directory, artifact)
                    self.assertEqual(model.n_features_in_, 20)
                    metrics = report["cohorts"][cohort]["models"][name]
                    self.assertEqual(sum(map(sum, metrics["confusion_matrix"])), info["test_rows"])
                    self.assertEqual(len(metrics["prediction_evidence"]), info["test_rows"])
                    self.assertTrue(all(item["history_end_time"] < item["prediction_time"] for item in metrics["prediction_evidence"]))
                    self.assertTrue(all(0 <= metrics[key] <= 1 for key in ["accuracy", "precision", "recall", "f1_score"]))
            else:
                self.assertEqual(report["cohorts"][cohort]["models"], {})
        for forecast in forecasts["predictions"]:
            info = manifest["cohorts"][forecast["cohort"]]
            if not info["models"]:
                self.assertEqual(forecast["status"], "ABSTAIN")
                self.assertEqual(forecast["models"], {})
            elif forecast["series_id"] not in info["training_series_ids"] and not (forecast["cohort"] == "progression" and forecast["test_id"] in info["training_test_ids"]):
                self.assertEqual(forecast["reason"], "UNSEEN_SERIES")
            elif forecast["models"]:
                if forecast["cohort"] == "controlled":
                    self.assertEqual(forecast["status"], "CONTROLLED_DEMONSTRATION_ONLY")
                for prediction in forecast["models"].values():
                    self.assertFalse(prediction["probability_is_calibrated"])
        artifact = next(artifact for info in manifest["cohorts"].values() for artifact in info["models"].values())
        with (directory / artifact["file"]).open("ab") as stream:
            stream.write(b"tampered")
        with self.assertRaisesRegex(ValueError, "Model artifact hash mismatch"):
            load_model(directory, artifact)


class MethodTests(unittest.TestCase):
    @staticmethod
    def block(name, start, end, cohort="controlled"):
        return {"block_id": name, "block_start_time": f"2026-10-19T{start}:00:00.000Z",
                "block_end_time": f"2026-10-19T{end}:00:00.000Z",
                "target_end_time": f"2026-10-19T{end}:00:00.000Z", "cohort": cohort}

    def test_whole_blocks_and_overlapping_campaign_purge(self):
        rows = [self.block("a", "01", "02"), self.block("overlap", "03", "10"),
                self.block("c", "05", "06"), self.block("test", "09", "11")]
        split = temporal_split(rows)
        self.assertEqual(split["train_blocks"], ["a", "c"])
        self.assertEqual(split["test_blocks"], ["test"])
        self.assertEqual(split["purged"], 1)

    def test_inconsistent_boundaries_and_mixed_cohorts_rejected(self):
        with self.assertRaisesRegex(ValueError, "pool"):
            temporal_split([self.block("a", "01", "02"), self.block("b", "03", "04", "ordinary")])
        with self.assertRaisesRegex(ValueError, "Inconsistent"):
            temporal_split([self.block("a", "01", "02"), self.block("a", "01", "03")])

    def test_no_split_from_single_block_or_invalid_fraction(self):
        split = temporal_split([self.block("a", "01", "02")])
        self.assertEqual(split["train"], [])
        self.assertEqual(split["purged"], 1)
        with self.assertRaises(ValueError):
            temporal_split([], 1)

    def test_imputer_uses_training_only(self):
        train_values = np.array([[0.2], [0.4], [np.nan]])
        holdout_values = np.array([[0.9], [np.nan]])
        imputer = SimpleImputer(strategy="median").fit(train_values)
        transformed = imputer.transform(holdout_values)
        self.assertAlmostEqual(imputer.statistics_[0], 0.3)
        self.assertAlmostEqual(transformed[1, 0], 0.3)

    def test_temporal_feature_formulas(self):
        history = [{"duration": (i + 1) * 100, "failed": i in [2,3], "retried": i >= 2,
                    "locatorFailure": i in [1,2,4], "actionabilityFailure": False,
                    "healingAttempted": i in [1,2,3], "healingSuccessful": i in [1,2],
                    "learningEnabled": False, "knowledgeHit": False,
                    "end": f"2026-10-19T00:00:{i+1:02d}.000Z"} for i in range(5)]
        features = historical_features(history)
        self.assertEqual(features["duration_trend"], 100)
        self.assertAlmostEqual(features["duration_growth_rate"], 5/3)
        self.assertAlmostEqual(features["retry_trend"], .3)
        self.assertEqual(features["locator_volatility_index"], .75)
        self.assertEqual(features["healing_success_momentum"], -.5)
        self.assertEqual(features["pass_streak"], 1)
        self.assertEqual(features["failure_streak"], 0)
        self.assertEqual(features["mean_time_between_failures"], 1000)
        self.assertEqual(features["recent_failure_rate"], .4)
        self.assertEqual(features["healing_reliance_score"], .6)

    def test_onset_detection_is_distinct_from_persistence(self):
        rows = [{"last_prior_failed": value} for value in [0,0,1,1]]
        actual = [0,1,1,0]
        persistence = transition_metrics(rows, actual, [0,0,1,1])
        warning_model = transition_metrics(rows, actual, [0,1,1,0])
        self.assertEqual(persistence["failure_onset_recall"], 0)
        self.assertEqual(warning_model["failure_onset_recall"], 1)
        self.assertEqual(warning_model["repair_recognition_rate"], 1)
        self.assertEqual(warning_model["disagreements_with_persistence"], 2)

    def test_pr_curve_and_balanced_accuracy(self):
        result = classification_metrics([0,0,0,1], [0,0,0,0], [.1,.2,.3,.9])
        self.assertEqual(result["balanced_accuracy"], .5)
        self.assertEqual(len(result["pr_curve"]["precision"]), len(result["pr_curve"]["thresholds"]) + 1)
        self.assertEqual(result["pr_curve"]["average_precision"], 1)

    def test_metrics_confusion_order_and_undefined_values(self):
        result = classification_metrics([0, 0, 1, 1], [0, 1, 0, 1])
        self.assertEqual(result["confusion_matrix"], [[1, 1], [1, 1]])
        for name in ["accuracy", "precision", "recall", "f1_score"]:
            self.assertEqual(result[name], 0.5)
        result = classification_metrics([0, 0], [0, 0])
        self.assertEqual(result["accuracy"], 1)
        self.assertEqual(result["undefined_metrics_set_to_zero"], ["precision", "recall", "f1_score"])

    def test_feature_ranges_missing_values_and_allowlist(self):
        values = {name: 0 for name in FEATURES}
        values["healing_success_rate"] = None
        self.assertTrue(math.isnan(feature_vector(values)[FEATURES.index("healing_success_rate")]))
        for invalid in [float("inf"), float("nan"), -1, 1.1, True]:
            with self.assertRaises(ValueError):
                feature_vector({**values, "failure_rate": invalid})
        with self.assertRaises(ValueError):
            feature_vector({**values, "next_execution_failed": 1})
        with self.assertRaises(ValueError):
            feature_vector({**values, "failure_rate": None})


if __name__ == "__main__":
    unittest.main()
