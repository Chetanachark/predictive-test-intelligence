"""Fit predeclared models on chronologically earlier independent blocks only."""
import argparse
import pickle
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.tree import DecisionTreeClassifier

from common import (ML_ROOT, FEATURES, SPEC, SPEC_BYTES, atomic_bytes, class_counts,
                    digest, environment, load_dataset, matrix, temporal_split, write_json, source_fingerprints)


def train(root=ML_ROOT):
    root = Path(root).resolve()
    dataset = load_dataset(root)
    training_id = str(uuid4())
    output = root / "models" / training_id
    output.mkdir(parents=True)
    manifest = {"schema_version": 1, "training_id": training_id, "created_at": datetime.now(timezone.utc).isoformat(),
                "feature_spec_sha256": digest(SPEC_BYTES), "feature_order": FEATURES,
                "dataset_directory": str(dataset["directory"].relative_to(root)),
                "dataset_manifest_sha256": digest((dataset["directory"] / "dataset-manifest.json").read_bytes()),
                "environment": environment(), "source_sha256": source_fingerprints(), "random_seed": 42, "threshold": 0.5, "cohorts": {}}
    requirements = SPEC["evaluation"]
    for cohort in ["ordinary", "controlled", "progression"]:
        rows = [row for row in dataset["rows"] if row["cohort"] == cohort]
        split = temporal_split(rows)
        train_rows = split["train"]; test_rows = split["test"]
        info = {"status": "NOT_TRAINED", "train_rows": len(train_rows), "test_rows": len(test_rows),
                "train_class_counts": class_counts(train_rows), "test_class_counts": class_counts(test_rows),
                "train_blocks": split["train_blocks"], "test_blocks": split["test_blocks"],
                "cutoff": split["cutoff"], "purged_rows": split["purged"],
                "train_sample_ids": [row["sample_id"] for row in train_rows], "test_sample_ids": [row["sample_id"] for row in test_rows],
                "training_series_ids": sorted({row["series_id"] for row in train_rows}), "training_test_ids": sorted({row["test_id"] for row in train_rows}), "models": {}}
        reasons = []
        if len(train_rows) < requirements["minimum_train_rows"]:
            reasons.append("INSUFFICIENT_TRAIN_ROWS")
        if len(test_rows) < requirements["minimum_test_rows"]:
            reasons.append("INSUFFICIENT_TEST_ROWS")
        if min(class_counts(train_rows).values()) < requirements["minimum_train_per_class"]:
            reasons.append("INSUFFICIENT_TRAIN_CLASS_DIVERSITY")
        if len(split["train_blocks"]) < requirements["minimum_train_blocks"]:
            reasons.append("INSUFFICIENT_TEMPORAL_BLOCKS")
        info["reasons"] = reasons
        if not reasons:
            estimators = {
                "decision_tree": DecisionTreeClassifier(max_depth=4, min_samples_leaf=3, class_weight="balanced", random_state=42),
                "random_forest": RandomForestClassifier(n_estimators=200, max_depth=6, min_samples_leaf=2,
                                                         class_weight="balanced", random_state=42, n_jobs=1),
            }
            estimators["label_history_only"] = DecisionTreeClassifier(max_depth=4, min_samples_leaf=3, class_weight="balanced", random_state=42)
            estimators["warning_signals_only"] = DecisionTreeClassifier(max_depth=4, min_samples_leaf=3, class_weight="balanced", random_state=42)
            label_features = {"failure_rate", "stability_score", "failure_streak", "pass_streak", "recent_failure_rate", "mean_time_between_failures"}
            x = matrix(train_rows); y = [row["_label"] for row in train_rows]
            for name, estimator in estimators.items():
                steps = []; selected = list(range(len(FEATURES)))
                if name in {"label_history_only", "warning_signals_only"}:
                    selected = [i for i, feature in enumerate(FEATURES) if (feature in label_features if name == "label_history_only" else feature not in label_features | {"risk_score"})]
                    steps.append(("columns", ColumnTransformer([("selected", "passthrough", selected)], remainder="drop")))
                model = Pipeline(steps + [("imputer", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True)), ("classifier", estimator)])
                model.fit(x, y)  # No test rows, test labels, or full-dataset imputation.
                file = f"{cohort}-{name}.pkl"
                contents = pickle.dumps(model, protocol=pickle.HIGHEST_PROTOCOL)
                atomic_bytes(output / file, contents)
                info["models"][name] = {"file": file, "sha256": digest(contents), "hyperparameters": estimator.get_params(), "features": [FEATURES[i] for i in selected], "evaluation_only_ablation": name in {"label_history_only", "warning_signals_only"}}
            info["status"] = "TRAINED" if cohort == "ordinary" else "TRAINED_TEMPORAL_PROGRESSION" if cohort == "progression" else "TRAINED_CONTROLLED_DEMONSTRATION"
        manifest["cohorts"][cohort] = info
    write_json(output / "training-manifest.json", manifest)
    write_json(root / "models/latest.json", {"directory": training_id, "manifest_sha256": digest((output / "training-manifest.json").read_bytes())})
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ml-dir", type=Path, default=ML_ROOT)
    args = parser.parse_args()
    try:
        result = train(args.ml_dir)
        import json
        print(json.dumps({"training_id": result["training_id"], "cohorts": {key: {field: value[field] for field in ["status", "train_rows", "test_rows", "reasons"]} for key, value in result["cohorts"].items()}}, indent=2))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"Training failed: {error}\n")
