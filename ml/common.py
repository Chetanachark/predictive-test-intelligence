"""Shared validation and artifact IO. Model inputs are only the declared features."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import pickle
import platform
import tempfile
from datetime import datetime
from pathlib import Path

import numpy as np
import sklearn

ML_ROOT = Path(__file__).resolve().parent
SPEC_PATH = ML_ROOT / "features.json"
SPEC_BYTES = SPEC_PATH.read_bytes()
SPEC = json.loads(SPEC_BYTES)
FEATURES = SPEC["feature_order"]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_bytes(file: Path, data: bytes) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=file.name + ".", suffix=".tmp", dir=file.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(file: Path, value: object) -> None:
    atomic_bytes(file, (json.dumps(value, indent=2, allow_nan=False) + "\n").encode())


def read_json(file: Path):
    return json.loads(file.read_bytes())


def parse_time(value: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("Expected a UTC timestamp")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def inside(root: Path, relative: str) -> Path:
    file = (root / relative).resolve()
    if not file.is_relative_to(root.resolve()):
        raise ValueError("Artifact path escapes its root")
    return file


def feature_vector(values: dict) -> list[float]:
    if set(values) != set(FEATURES):
        raise ValueError("Unexpected or missing predictor fields")
    result = []
    for name in FEATURES:
        value = values[name]
        policy = SPEC["features"][name]
        if value is None or value == "":
            if not policy["nullable"]:
                raise ValueError(f"{name} cannot be missing")
            result.append(float("nan"))
            continue
        if isinstance(value, bool):
            raise ValueError("Boolean feature is not numeric telemetry")
        number = float(value)
        if not math.isfinite(number) or number < policy.get("minimum", -float("inf")) or number > policy.get("maximum", float("inf")):
            raise ValueError(f"Invalid {name}")
        result.append(number)
    return result


def slope(values):
    if len(values) < 2:
        return 0.0
    center = (len(values) - 1) / 2
    mean = sum(values) / len(values)
    return sum((i - center) * (value - mean) for i, value in enumerate(values)) / sum((i - center) ** 2 for i in range(len(values)))


def temporal_features(history):
    recent = history[-SPEC["short_window_size"]:]
    durations = [item["duration"] for item in recent]
    middle = max(1, len(durations) // 2)
    older = sum(durations[:middle]) / middle
    newer = sum(durations[middle:]) / len(durations[middle:]) if len(durations) > 1 else older
    def streak(value):
        count = 0
        for item in reversed(history):
            if item["failed"] != value:
                break
            count += 1
        return count
    healing = [item for item in recent if item["healingAttempted"]]
    failures = [item for item in history if item["failed"] and item.get("end")]
    return {"failure_streak": streak(True), "pass_streak": streak(False), "duration_trend": slope(durations),
            "duration_growth_rate": (newer - older) / max(older, 1),
            "retry_trend": slope([int(item["retried"]) for item in recent]),
            "locator_volatility_index": sum(a["locatorFailure"] != b["locatorFailure"] for a,b in zip(recent, recent[1:])) / (len(recent) - 1) if len(recent) > 1 else 0,
            "healing_reliance_score": len(healing) / len(recent),
            "healing_success_momentum": slope([int(item["healingSuccessful"]) for item in healing]) if len(healing) > 1 else None,
            "mean_time_between_failures": (parse_time(failures[-1]["end"]) - parse_time(failures[0]["end"])).total_seconds() * 1000 / (len(failures) - 1) if len(failures) > 1 else None,
            "recent_failure_rate": sum(item["failed"] for item in recent) / len(recent)}


def historical_features(history: list[dict]) -> dict:
    if not history:
        raise ValueError("No historical executions")
    n = len(history)
    failure = sum(item["failed"] for item in history) / n
    retry = sum(item["retried"] for item in history) / n
    locator = sum(item["locatorFailure"] for item in history) / n
    mean = sum(item["duration"] for item in history) / n
    healing = [item for item in history if item["healingAttempted"]]
    learning = [item for item in history if item["learningEnabled"] and item["healingAttempted"]]
    return {
        **temporal_features(history), "failure_rate": failure, "retry_rate": retry, "stability_score": 100 * (1 - failure),
        "average_duration": mean, "duration_variance": sum((item["duration"] - mean) ** 2 for item in history) / n,
        "locator_failure_rate": locator,
        "actionability_failure_rate": sum(item["actionabilityFailure"] for item in history) / n,
        "healing_success_rate": sum(item["healingSuccessful"] for item in healing) / len(healing) if healing else None,
        "knowledge_base_hit_rate": sum(item["knowledgeHit"] for item in learning) / len(learning) if learning else None,
        "risk_score": 100 * (0.60 * failure + 0.25 * retry + 0.15 * locator),
    }


def check_features(actual: dict, history: list[dict]) -> list[float]:
    vector = feature_vector(actual)
    expected = feature_vector(historical_features(history))
    for name, left, right in zip(FEATURES, vector, expected):
        if math.isnan(left) and math.isnan(right):
            continue
        if not math.isclose(left, right, rel_tol=1e-8, abs_tol=1e-8):
            raise ValueError(f"Feature lineage mismatch: {name}")
    return vector


def load_dataset(root: Path = ML_ROOT, build_directory: str | None = None) -> dict:
    root = Path(root).resolve()
    if build_directory is None:
        pointer = read_json(root / "latest-dataset.json")
        directory = inside(root, pointer["directory"])
        if digest((directory / "dataset-manifest.json").read_bytes()) != pointer["manifest_sha256"]:
            raise ValueError("Dataset manifest hash mismatch")
    else:
        directory = inside(root, build_directory)
    manifest = read_json(directory / "dataset-manifest.json")
    if manifest["feature_spec_sha256"] != digest(SPEC_BYTES) or manifest["feature_order"] != FEATURES or manifest.get("dataset_builder_sha256") != digest((ML_ROOT / "datasetBuilder.js").read_bytes()):
        raise ValueError("Feature contract changed; rebuild the dataset")
    contents = {}
    for name, field in [("training-data.csv", "training_data_sha256"), ("prediction-input.json", "prediction_input_sha256"),
                        ("execution-lineage.json", "execution_lineage_sha256")]:
        contents[name] = (directory / name).read_bytes()
        if digest(contents[name]) != manifest[field]:
            raise ValueError(f"Dataset artifact hash mismatch: {name}")
    lineage = json.loads(contents["execution-lineage.json"])
    index = {item["id"]: item for item in lineage}
    if len(index) != len(lineage):
        raise ValueError("Duplicate execution lineage")
    grouped = {}
    for item in lineage:
        if parse_time(item["end"]) < parse_time(item["start"]) or parse_time(item["end"]) >= parse_time(manifest["as_of"]):
            raise ValueError("Invalid execution chronology")
        grouped.setdefault(item["series_id"], []).append(item)
    for items in grouped.values():
        items.sort(key=lambda item: (item["end"], item["id"]))

    def prior(series_id, cutoff):
        return [item for item in grouped.get(series_id, []) if parse_time(item["end"]) < parse_time(cutoff)][-manifest["window_size"]:]

    reader = csv.DictReader(io.StringIO(contents["training-data.csv"].decode(), newline=""))
    if reader.fieldnames != manifest["csv_columns"] or len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise ValueError("Unexpected CSV columns")
    rows = []; ids = set()
    for row in reader:
        if None in row or None in row.values() or row["sample_id"] in ids:
            raise ValueError("Malformed or duplicate sample")
        ids.add(row["sample_id"])
        target = index.get(row["target_execution_id"])
        history = prior(row["series_id"], row["prediction_time"])
        if not target or target["series_id"] != row["series_id"] or target["start"] != row["prediction_time"] or target["end"] != row["target_end_time"]:
            raise ValueError("Target lineage mismatch")
        if len(history) < manifest["minimum_history"] or row["target_execution_id"] in [item["id"] for item in history]:
            raise ValueError("Target leaked into history or history is too short")
        if json.loads(row["history_execution_ids"]) != [item["id"] for item in history] or int(row["history_count"]) != len(history) or row["history_end_time"] != history[-1]["end"]:
            raise ValueError("Historical lineage mismatch")
        if json.loads(row["target_attempt_ids"]) != target["attempts"] or row["next_execution_failed"] != str(int(target["failed"])):
            raise ValueError("Label or attempt lineage mismatch")
        if row["last_prior_failed"] != str(int(history[-1]["failed"])):
            raise ValueError("Persistence baseline leaked or differs from history")
        if not parse_time(row["block_start_time"]) <= parse_time(row["prediction_time"]) <= parse_time(row["target_end_time"]) <= parse_time(row["block_end_time"]) < parse_time(manifest["as_of"]):
            raise ValueError("Invalid sample/block chronology")
        if row["cohort"] not in {"ordinary", "controlled", "progression"}:
            raise ValueError("Unknown cohort")
        row["_vector"] = check_features({name: row[name] for name in FEATURES}, history)
        row["_label"] = int(row["next_execution_failed"])
        rows.append(row)
    if len(rows) != manifest["samples"]:
        raise ValueError("Dataset row count mismatch")
    inputs = json.loads(contents["prediction-input.json"])
    if inputs["feature_spec_sha256"] != digest(SPEC_BYTES) or inputs["as_of"] != manifest["as_of"]:
        raise ValueError("Forecast contract mismatch")
    for forecast in inputs["forecasts"]:
        history = prior(forecast["series_id"], inputs["as_of"])
        if not history or forecast["prediction_time"] != inputs["as_of"] or forecast["history_end_time"] != history[-1]["end"] or forecast["history_count"] != len(history):
            raise ValueError("Forecast chronology mismatch")
        forecast["_vector"] = check_features(forecast["features"], history)
    return {"directory": directory, "manifest": manifest, "rows": rows, "forecasts": inputs["forecasts"]}


def temporal_split(rows: list[dict], test_fraction: float = SPEC["evaluation"]["test_fraction"]) -> dict:
    if not 0 < test_fraction < 1:
        raise ValueError("Invalid temporal holdout fraction")
    if len({row["cohort"] for row in rows}) > 1:
        raise ValueError("Do not pool ordinary and controlled cohorts")
    blocks = {}
    for row in rows:
        info = (row["block_start_time"], row["block_end_time"])
        if row["block_id"] in blocks and blocks[row["block_id"]] != info:
            raise ValueError("Inconsistent block boundaries")
        blocks[row["block_id"]] = info
    ordered = sorted(blocks, key=lambda key: (blocks[key][0], key))
    if len(ordered) < 2:
        return {"train": [], "test": [], "purged": len(rows), "test_blocks": [], "train_blocks": [], "cutoff": None}
    n_test = max(1, math.ceil(len(ordered) * test_fraction))
    test_blocks = set(ordered[-n_test:])
    cutoff = min(blocks[key][0] for key in test_blocks)
    train_blocks = {key for key in ordered if key not in test_blocks and parse_time(blocks[key][1]) < parse_time(cutoff)}
    train = [row for row in rows if row["block_id"] in train_blocks and parse_time(row["target_end_time"]) < parse_time(cutoff)]
    test = [row for row in rows if row["block_id"] in test_blocks]
    return {"train": train, "test": test, "purged": len(rows) - len(train) - len(test),
            "test_blocks": sorted(test_blocks), "train_blocks": sorted(train_blocks), "cutoff": cutoff}


def matrix(rows: list[dict]):
    return np.asarray([row["_vector"] for row in rows], dtype=float)


def class_counts(rows: list[dict]) -> dict:
    return {str(label): sum(row["_label"] == label for row in rows) for label in [0, 1]}


def environment() -> dict:
    return {"python": platform.python_version(), "scikit_learn": sklearn.__version__, "numpy": np.__version__}


def source_fingerprints() -> dict:
    return {name: digest((ML_ROOT / name).read_bytes()) for name in ["datasetBuilder.js", "features.json", "common.py", "train.py", "evaluate.py", "predict.py"]}


def load_training(root: Path = ML_ROOT):
    root = Path(root).resolve()
    pointer = read_json(root / "models/latest.json")
    directory = inside(root / "models", pointer["directory"])
    raw = (directory / "training-manifest.json").read_bytes()
    if digest(raw) != pointer["manifest_sha256"]:
        raise ValueError("Training manifest hash mismatch")
    manifest = json.loads(raw)
    if manifest["feature_spec_sha256"] != digest(SPEC_BYTES) or manifest["environment"] != environment() or manifest.get("source_sha256") != source_fingerprints():
        raise ValueError("Model feature contract or runtime versions differ")
    return directory, manifest


def load_model(directory: Path, info: dict):
    data = inside(directory, info["file"]).read_bytes()
    if digest(data) != info["sha256"]:
        raise ValueError("Model artifact hash mismatch")
    # Only locally produced, hash-checked artifacts from our own model directory.
    return pickle.loads(data)
