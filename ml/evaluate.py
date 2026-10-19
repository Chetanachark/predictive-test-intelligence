"""Evaluate frozen models against later complete blocks; never select a winner on holdout."""
import argparse
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix, precision_score, recall_score, f1_score, precision_recall_curve, average_precision_score
from sklearn.inspection import permutation_importance

from common import (ML_ROOT, FEATURES, digest, load_dataset, load_model, load_training, matrix, write_json)


def classification_metrics(actual, predicted, probabilities=None):
    actual = np.asarray(actual, dtype=int); predicted = np.asarray(predicted, dtype=int)
    positives = int(sum(actual == 1)); predicted_positives = int(sum(predicted == 1))
    curve = None
    if probabilities is not None and positives and positives < len(actual):
        precision, recall, thresholds = precision_recall_curve(actual, probabilities)
        curve = {"precision": precision.tolist(), "recall": recall.tolist(), "thresholds": thresholds.tolist(),
                 "average_precision": float(average_precision_score(actual, probabilities))}
    return {"balanced_accuracy": float(np.mean([np.mean(predicted[actual == label] == label) for label in [0,1]])) if 0 < positives < len(actual) else None, "pr_curve": curve, "accuracy": float(accuracy_score(actual, predicted)),
            "precision": float(precision_score(actual, predicted, zero_division=0)),
            "recall": float(recall_score(actual, predicted, zero_division=0)),
            "f1_score": float(f1_score(actual, predicted, zero_division=0)),
            "confusion_matrix": confusion_matrix(actual, predicted, labels=[0, 1]).tolist(),
            "confusion_matrix_order": {"rows": ["actual_pass", "actual_failure"], "columns": ["predicted_pass", "predicted_failure"]},
            "support": {"pass": int(sum(actual == 0)), "failure": positives},
            "undefined_metrics_set_to_zero": (["precision"] if not predicted_positives else []) + (["recall"] if not positives else []) + (["f1_score"] if not positives and not predicted_positives else [])}


def transition_metrics(rows, actual, predicted):
    predicted = np.asarray(predicted, dtype=int)
    onsets = [i for i,row in enumerate(rows) if int(row["last_prior_failed"]) == 0 and actual[i] == 1]
    repairs = [i for i,row in enumerate(rows) if int(row["last_prior_failed"]) == 1 and actual[i] == 0]
    return {"failure_onset_count": len(onsets),
            "failure_onset_recall": float(np.mean(predicted[onsets] == 1)) if onsets else None,
            "repair_count": len(repairs),
            "repair_recognition_rate": float(np.mean(predicted[repairs] == 0)) if repairs else None,
            "disagreements_with_persistence": int(sum(predicted[i] != int(row["last_prior_failed"]) for i,row in enumerate(rows)))}


def evaluate(root=ML_ROOT):
    root = Path(root).resolve()
    directory, training = load_training(root)
    dataset = load_dataset(root, training["dataset_directory"])
    if digest((dataset["directory"] / "dataset-manifest.json").read_bytes()) != training["dataset_manifest_sha256"]:
        raise ValueError("Training dataset manifest changed")
    index = {row["sample_id"]: row for row in dataset["rows"]}
    report = {"schema_version": 1, "training_id": training["training_id"], "evaluated_at": datetime.now(timezone.utc).isoformat(),
              "target": "next_execution_failed", "evaluation_mode": "rolling_one_step_temporal_holdout",
              "dataset_quality": dataset["manifest"]["quality"], "cohorts": {}, "limitations": dataset["manifest"]["limitations"]}
    importance_report = {"training_id": training["training_id"], "method": "heldout permutation F1 decrease, 10 repeats, seed 42; diagnostic only, no model selection", "cohorts": {},
                         "warning": "Correlated predictors share importance; permutation and impurity importance are model reliance, not causal proof."}
    for cohort, info in training["cohorts"].items():
        outcome = {"status": info["status"], "reasons": info["reasons"], "train_rows": info["train_rows"], "test_rows": info["test_rows"],
                   "train_class_counts": info["train_class_counts"], "test_class_counts": info["test_class_counts"],
                   "models": {}, "baselines": {}}
        if info["models"]:
            train_rows = [index[key] for key in info["train_sample_ids"]]
            test_rows = [index[key] for key in info["test_sample_ids"]]
            if set(info["train_blocks"]) & set(info["test_blocks"]) or any(row["target_end_time"] >= info["cutoff"] for row in train_rows):
                raise ValueError("Temporal split leaked future labels")
            actual = [row["_label"] for row in test_rows]
            majority = int(sum(row["_label"] for row in train_rows) > len(train_rows) / 2)
            outcome["baselines"] = {
                "always_pass": classification_metrics(actual, [0] * len(test_rows), [0] * len(test_rows)),
                "historical_failure_rate": classification_metrics(actual, [int(float(row["failure_rate"]) >= 0.5) for row in test_rows], [float(row["failure_rate"]) for row in test_rows]),
                "training_majority": classification_metrics(actual, [majority] * len(test_rows)),
                "last_observed_outcome": classification_metrics(actual, [int(row["last_prior_failed"]) for row in test_rows], [int(row["last_prior_failed"]) for row in test_rows]),
            }
            baseline_predictions = {
                "always_pass": [0] * len(test_rows), "training_majority": [majority] * len(test_rows),
                "historical_failure_rate": [int(float(row["failure_rate"]) >= 0.5) for row in test_rows],
                "last_observed_outcome": [int(row["last_prior_failed"]) for row in test_rows],
            }
            for name, predictions in baseline_predictions.items():
                outcome["baselines"][name].update(transition_metrics(test_rows, actual, predictions))
                outcome["baselines"][name]["by_block"] = {block: classification_metrics([actual[i] for i,row in enumerate(test_rows) if row["block_id"] == block], [predictions[i] for i,row in enumerate(test_rows) if row["block_id"] == block]) for block in info["test_blocks"]}
            importance_report["cohorts"][cohort] = {}
            for name, artifact in info["models"].items():
                model = load_model(directory, artifact)
                probabilities = model.predict_proba(matrix(test_rows))[:, list(model.classes_).index(1)]
                predicted = (probabilities >= training["threshold"]).astype(int)
                outcome["models"][name] = classification_metrics(actual, predicted, probabilities)
                outcome["models"][name]["f1_gain_over_persistence"] = outcome["models"][name]["f1_score"] - outcome["baselines"]["last_observed_outcome"]["f1_score"]
                metrics = outcome["models"][name]
                metrics.update(transition_metrics(test_rows, actual, predicted))
                metrics["prediction_evidence"] = [{"sample_id": row["sample_id"], "block_id": row["block_id"], "test_id": row["test_id"],
                    "prediction_time": row["prediction_time"], "history_end_time": row["history_end_time"],
                    "previous_failed": int(row["last_prior_failed"]), "actual_failed": actual[i],
                    "predicted_failed": int(predicted[i]), "failure_probability": float(probabilities[i])}
                    for i, row in enumerate(test_rows)]
                metrics["by_block"] = {block: classification_metrics([actual[i] for i,row in enumerate(test_rows) if row["block_id"] == block], [int(predicted[i]) for i,row in enumerate(test_rows) if row["block_id"] == block]) for block in info["test_blocks"]}
                if name in {"decision_tree", "random_forest"}:
                    permuted = permutation_importance(model, matrix(test_rows), actual, scoring="f1", n_repeats=10, random_state=42, n_jobs=1)
                    transformed_names = model.named_steps["imputer"].get_feature_names_out(FEATURES)
                    impurity = {feature: 0.0 for feature in FEATURES}
                    for feature, value in zip(transformed_names, model.named_steps["classifier"].feature_importances_):
                        impurity[feature.removeprefix("missingindicator_")] += float(value)
                    importance_report["cohorts"][cohort][name] = sorted([
                        {"feature": feature, "permutation_f1_decrease": float(permuted.importances_mean[i]),
                         "permutation_std": float(permuted.importances_std[i]), "training_impurity_importance": impurity[feature]}
                        for i, feature in enumerate(FEATURES)], key=lambda item: -item["permutation_f1_decrease"])
            if dataset["manifest"]["quality"][cohort]["seriesWithOutcomeVariation"] == 0:
                outcome["research_warning"] = "No series changes outcome. Scores test persistence of fixed outcomes, not prediction of new regressions."
        report["cohorts"][cohort] = outcome
    comparisons = {"training_id": training["training_id"], "scope": "Preregistered later controlled campaigns only; two held-out campaigns are not enough for a population-level significance claim.", "cohorts": {}}
    for cohort, outcome in report["cohorts"].items():
        comparisons["cohorts"][cohort] = {"status": outcome["status"], "models": {}}
        for name in ["decision_tree", "random_forest"]:
            if name not in outcome["models"]:
                continue
            full = outcome["models"][name]
            persistence = outcome["baselines"]["last_observed_outcome"]
            labels = outcome["models"]["label_history_only"]
            comparisons["cohorts"][cohort]["models"][name] = {
                "f1_gain_over_persistence": full["f1_score"] - persistence["f1_score"],
                "balanced_accuracy_gain_over_persistence": full["balanced_accuracy"] - persistence["balanced_accuracy"] if full["balanced_accuracy"] is not None and persistence["balanced_accuracy"] is not None else None,
                "f1_gain_over_label_history_only": full["f1_score"] - labels["f1_score"],
                "failure_onset_recall": full["failure_onset_recall"],
                "controlled_warning_signal_evidence": bool(cohort == "progression" and full["f1_score"] > persistence["f1_score"] and full["f1_score"] > labels["f1_score"] and full["balanced_accuracy"] is not None and persistence["balanced_accuracy"] is not None and full["balanced_accuracy"] > persistence["balanced_accuracy"] and (full["failure_onset_recall"] or 0) > 0),
            }
    write_json(directory / "comparison-report.json", comparisons)
    write_json(root / "comparison-report.json", comparisons)
    report["claim_scope"] = "Later campaigns of controlled stimuli; improvement over persistence must be measured, never assumed. No natural regression generalization claim."
    write_json(directory / "feature-importance.json", importance_report)
    write_json(root / "feature-importance.json", importance_report)
    write_json(directory / "evaluation-report.json", report)
    write_json(root / "evaluation-report.json", report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ml-dir", type=Path, default=ML_ROOT)
    args = parser.parse_args()
    try:
        import json
        print(json.dumps(evaluate(args.ml_dir), indent=2))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"Evaluation failed: {error}\n")
