"""Produce next-execution forecasts, abstaining for untrained cohorts/series."""
import argparse
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from common import ML_ROOT, digest, load_dataset, load_model, load_training, write_json


def predict(root=ML_ROOT):
    root = Path(root).resolve()
    directory, training = load_training(root)
    dataset = load_dataset(root)
    training_dataset = load_dataset(root, training["dataset_directory"])
    if digest((training_dataset["directory"] / "dataset-manifest.json").read_bytes()) != training["dataset_manifest_sha256"]:
        raise ValueError("Training dataset changed")
    index = {row["sample_id"]: row for row in training_dataset["rows"]}
    cutoffs = {cohort: max((index[key]["target_end_time"] for key in info["train_sample_ids"]), default="")
               for cohort, info in training["cohorts"].items()}
    predictions = []
    cache = {}
    for forecast in dataset["forecasts"]:
        cohort = forecast["cohort"]
        info = training["cohorts"].get(cohort)
        result = {key: value for key, value in forecast.items() if key not in {"_vector", "features"}}
        result["models"] = {}
        if not info or not info["models"]:
            result.update({"status": "ABSTAIN", "reason": "NO_TRAINED_COHORT_MODEL"})
        elif forecast["series_id"] not in info["training_series_ids"] and not (cohort == "progression" and forecast["test_id"] in info["training_test_ids"]):
            result.update({"status": "ABSTAIN", "reason": "UNSEEN_SERIES"})
        elif forecast["prediction_time"] <= cutoffs[cohort]:
            result.update({"status": "ABSTAIN", "reason": "PREDICTION_PRECEDES_MODEL_TRAINING_LABELS"})
        else:
            result["status"] = "PREDICTED" if cohort == "ordinary" else "TEMPORAL_PROGRESSION_ONLY" if cohort == "progression" else "CONTROLLED_DEMONSTRATION_ONLY"
            for name, artifact in info["models"].items():
                if artifact.get("evaluation_only_ablation"):
                    continue
                key = (cohort, name)
                if key not in cache:
                    cache[key] = load_model(directory, artifact)
                model = cache[key]
                probability = float(model.predict_proba(np.asarray([forecast["_vector"]], dtype=float))[0, list(model.classes_).index(1)])
                result["models"][name] = {"next_execution_failed": int(probability >= training["threshold"]),
                                         "failure_probability": probability, "threshold": training["threshold"],
                                         "probability_is_calibrated": False}
        predictions.append(result)
    report = {"schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(), "as_of": dataset["manifest"]["as_of"],
              "training_id": training["training_id"], "feature_spec_sha256": training["feature_spec_sha256"],
              "target": "next_execution_failed", "predictions": predictions,
              "limitations": dataset["manifest"]["limitations"] + ["Tree probabilities are uncalibrated model outputs; no automatic test skipping or healing decisions are made."]}
    write_json(directory / "prediction-report.json", report)
    write_json(root / "prediction-report.json", report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ml-dir", type=Path, default=ML_ROOT)
    args = parser.parse_args()
    try:
        report = predict(args.ml_dir)
        import json
        print(json.dumps({"output": str(args.ml_dir / "prediction-report.json"), "predictions": len(report["predictions"]),
                          "statuses": {status: sum(item["status"] == status for item in report["predictions"]) for status in sorted({item["status"] for item in report["predictions"]})}}, indent=2))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"Prediction failed: {error}\n")
