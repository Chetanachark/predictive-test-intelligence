"""Read-only local evidence loading. No model loading, execution or source writes."""
from __future__ import annotations
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import pandas as pd

PROJECT_ROOT = Path(os.environ.get("PREDICTIVE_PROJECT_ROOT", Path(__file__).resolve().parents[1])).resolve()
FAILURE_TYPES = ["LOCATOR_NOT_FOUND", "LOCATOR_AMBIGUOUS", "ACTIONABILITY_FAILURE", "ASSERTION_MISMATCH",
                 "STATE_CONSISTENCY_FAILURE", "APPLICATION_RUNTIME_ERROR", "SETUP_ENVIRONMENT_FAILURE", "UNKNOWN"]
MANIFESTS = {"campaigns": "campaign.json", "healing-evaluations": "evaluation.json",
             "adaptive-evaluations": "comparison.json", "progression-campaigns": "campaign.json"}

class DataError(ValueError):
    pass


def local_path(root, relative):
    result = (Path(root) / relative).resolve()
    if not result.is_relative_to(Path(root).resolve()):
        raise DataError("Evidence reference escapes its source directory")
    return result


def source_signature(root=PROJECT_ROOT):
    root = Path(root)
    files = [root / "dataset" / name for name in ["execution-history.json", "test-history.csv", "healing-history.json", "intelligence/latest.json"]]
    files += [root / "ml" / name for name in ["evaluation-report.json", "prediction-report.json", "feature-importance.json", "comparison-report.json"]]
    files += list((root / "dataset/intelligence").glob("*/intelligence-report.json"))
    for folder, name in MANIFESTS.items():
        files += list((root / "dataset" / folder).glob(f"*/{name}"))
    return tuple((str(file), file.stat().st_mtime_ns, file.stat().st_size) for file in sorted(set(files)) if file.is_file())


def read_json(file):
    try:
        return json.loads(Path(file).read_bytes(), parse_constant=lambda value: (_ for _ in ()).throw(DataError(f"Nonfinite JSON value: {value}")))
    except (OSError, ValueError) as error:
        raise DataError(f"{Path(file).name}: {error}") from error


def csv_matches(records, contents):
    reader = csv.DictReader(io.StringIO(contents, newline=""))
    rows = list(reader)
    if len(rows) != len(records) or (records and set(reader.fieldnames or []) != set(records[0])):
        return False
    for record, row in zip(records, rows):
        if None in row or None in row.values():
            return False
        for key, value in record.items():
            cell = row[key]
            try:
                if value is None:
                    equal = cell == ""
                elif isinstance(value, (dict, list)):
                    equal = json.loads(cell) == value
                elif isinstance(value, bool):
                    equal = cell == str(value).lower()
                elif isinstance(value, (int, float)):
                    equal = math.isfinite(float(cell)) and float(cell) == value
                else:
                    equal = cell == str(value)
            except (ValueError, TypeError):
                return False
            if not equal:
                return False
    return True


def validate_history(records):
    if not isinstance(records, list):
        raise DataError("Execution history must be a JSON array")
    seen = set()
    required = {"attempt_id", "run_id", "test_id", "test_name", "record_type", "browser", "status", "failure_type",
                "start_time", "end_time", "duration_ms", "retry_count", "experiment_id", "healing_attempted", "healing_successful"}
    for row in records:
        if not isinstance(row, dict) or not required.issubset(row):
            raise DataError("Incomplete telemetry record")
        if any(not isinstance(row[key], str) or not row[key] for key in ["attempt_id", "run_id", "test_id", "test_name", "browser", "record_type", "status", "start_time", "end_time"]):
            raise DataError("Invalid telemetry identity/status fields")
        if type(row["retry_count"]) is not int or row["retry_count"] < 0:
            raise DataError("Invalid retry count")
        if row["attempt_id"] in seen:
            raise DataError("Duplicate telemetry attempt ID")
        seen.add(row["attempt_id"])
        if row["record_type"] not in {"TEST_ATTEMPT", "RUN_ERROR"} or row["status"] not in {"PASS", "FAIL", "TIMED_OUT", "SKIPPED", "INTERRUPTED"}:
            raise DataError("Unknown record type or execution status")
        if row["failure_type"] not in [None, *FAILURE_TYPES] or ((row["status"] in {"PASS", "SKIPPED"}) != (row["failure_type"] is None)):
            raise DataError("Inconsistent failure taxonomy/status")
        if not isinstance(row["experiment_id"], str) or any(type(row[key]) is not bool for key in ["healing_attempted", "healing_successful"]):
            raise DataError("Invalid experiment identity or healing flags")
        if row["healing_successful"] and (not row["healing_attempted"] or row["status"] != "PASS"):
            raise DataError("Successful healing requires a verified passing attempt")
        if isinstance(row["duration_ms"], bool) or not isinstance(row["duration_ms"], (int, float)) or not math.isfinite(row["duration_ms"]) or row["duration_ms"] < 0:
            raise DataError("Invalid duration")
        try:
            start = pd.Timestamp(row["start_time"]); end = pd.Timestamp(row["end_time"])
            if start.tzinfo is None or end.tzinfo is None or end < start or abs((end-start).total_seconds()*1000 - row["duration_ms"]) > 1:
                raise ValueError("Invalid chronology")
        except (ValueError, TypeError) as error:
            raise DataError("Invalid telemetry timestamps/duration") from error
    return records


def valid_evaluation(report):
    if not isinstance(report, dict) or not isinstance(report.get("cohorts"), dict) or not report.get("training_id"):
        raise DataError("Invalid ML evaluation structure")
    for cohort in report["cohorts"].values():
        if not isinstance(cohort, dict) or not isinstance(cohort.get("models", {}), dict):
            raise DataError("Invalid ML cohort models")
        for model in cohort.get("models", {}).values():
            if not isinstance(model, dict): raise DataError("Invalid ML model metrics")
            for name in ["accuracy", "precision", "recall", "f1_score"]:
                value = model.get(name)
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
                    raise DataError("Invalid ML metric")
            matrix = model.get("confusion_matrix")
            if not isinstance(matrix, list) or len(matrix) != 2 or any(not isinstance(row, list) or len(row) != 2 for row in matrix):
                raise DataError("Invalid confusion matrix dimensions")
            if any(type(value) is not int or value < 0 for row in matrix for value in row) or sum(map(sum, matrix)) != cohort.get("test_rows"):
                raise DataError("Confusion matrix support differs from holdout size")
    return report


def validate_adaptive(report):
    arms = report.get("metrics", {}).get("arms", {})
    if set(arms) != {"baseline-healing", "adaptive-healing"}:
        raise DataError("Both comparison arms are required")
    keys = ["executions", "healingAttempts", "successfulRecoveries", "healingSuccessRate", "wrongRecoveries", "maskedDefects",
            "recoveryActions", "businessDefectExecutions", "meanHealingDurationMs"]
    for arm in arms.values():
        if not isinstance(arm, dict): raise DataError("Invalid healing comparison arm")
        if any(isinstance(arm.get(key), bool) or not isinstance(arm.get(key), (int, float)) or not math.isfinite(arm[key]) or arm[key] < 0 for key in keys):
            raise DataError("Missing or invalid safety/recovery measurements")
        if not arm["successfulRecoveries"] <= arm["healingAttempts"] <= arm["executions"] or arm["wrongRecoveries"] > arm["recoveryActions"] or arm["maskedDefects"] > arm["businessDefectExecutions"]:
            raise DataError("Inconsistent safety denominators")
        if arm["healingAttempts"] and abs(arm["healingSuccessRate"] - arm["successfulRecoveries"] / arm["healingAttempts"]) > 1e-8:
            raise DataError("Recovery rate disagrees with counts")
    return report


def load_bundle(root=PROJECT_ROOT):
    root = Path(root).resolve()
    # Detect a concurrent collection/publication and retry the entire snapshot once.
    for _ in range(2):
        before = source_signature(root)
        result = _load_once(root)
        if before == source_signature(root):
            return result
    raise DataError("Evidence changed while loading. Refresh after the writer finishes.")


def _load_once(root):
    issues = []; provenance = []
    def optional(file, expected):
        if not file.exists():
            issues.append(f"Unavailable: {file.relative_to(root)}")
            return expected()
        try:
            value = read_json(file)
            if not isinstance(value, expected):
                raise DataError("Unexpected document shape")
            provenance.append({"Source": str(file.relative_to(root)), "SHA256": hashlib.sha256(file.read_bytes()).hexdigest()})
            return value
        except DataError as error:
            issues.append(f"{file.relative_to(root)}: {error}")
            return expected()
    file = root / "dataset/execution-history.json"
    records = validate_history(read_json(file))
    provenance.append({"Source": "dataset/execution-history.json", "SHA256": hashlib.sha256(file.read_bytes()).hexdigest()})
    csv_file = root / "dataset/test-history.csv"
    synchronized = csv_file.exists() and csv_matches(records, csv_file.read_text())
    if not synchronized:
        issues.append("Telemetry CSV is missing or differs from JSON; telemetry charts use authoritative JSON only.")
    manifests = []; membership = {}
    index = {row["attempt_id"]: row for row in records}
    for folder, name in MANIFESTS.items():
        for file in sorted((root / "dataset" / folder).glob(f"*/{name}")):
            report = optional(file, dict)
            manifests.append({**report, "source_file": str(file.relative_to(root)), "kind": folder})
            if report.get("status") != "VERIFIED":
                continue
            ids = report.get("attempt_ids")
            if ids is None:
                teaching = report.get("training_attempt_ids", []); heldout = report.get("heldout_attempt_ids", [])
                ids = teaching + heldout if isinstance(teaching, list) and isinstance(heldout, list) else []
            if not isinstance(ids, list) or not ids or any(not isinstance(attempt, str) for attempt in ids) or len(set(ids)) != len(ids) or any(attempt not in index or index[attempt].get("app_version") != report.get("app_version") or index[attempt].get("test_version") != report.get("test_version") for attempt in ids):
                issues.append(f"Unverifiable campaign membership: {file.relative_to(root)}")
                continue
            if folder == "adaptive-evaluations":
                try:
                    validate_adaptive(report)
                except (DataError, TypeError, KeyError) as error:
                    issues.append(f"Invalid adaptive comparison in {file.relative_to(root)}: {error}")
                    manifests[-1]["metrics"] = {}
            for attempt in ids:
                if attempt in membership:
                    raise DataError("An attempt belongs to multiple verified campaigns")
                membership[attempt] = "Temporal progression" if folder == "progression-campaigns" else "Controlled experiment"
    frame = pd.DataFrame(records)
    if frame.empty:
        frame = pd.DataFrame(columns=["attempt_id", "record_type", "status", "failure_type", "start_time", "end_time", "test_id", "browser", "experiment_id", "healing_attempted", "healing_successful"])
    def cohort(row):
        if row["record_type"] == "RUN_ERROR":
            return "Run-level error"
        if row["attempt_id"] in membership:
            return membership[row["attempt_id"]]
        if any(row.get(field) for field in ["experiment_id", "emulated", "fault_variant", "locator_mutation", "fault_type"]):
            return "Unaudited experiment"
        return "Ordinary"
    frame["cohort"] = frame.apply(cohort, axis=1) if not frame.empty else pd.Series(dtype=str)
    frame["start_time"] = pd.to_datetime(frame["start_time"], utc=True)
    frame["end_time"] = pd.to_datetime(frame["end_time"], utc=True)
    intelligence = {}
    pointer_file = root / "dataset/intelligence/latest.json"
    if pointer_file.exists():
        pointer = optional(pointer_file, dict)
        try:
            report_file = local_path(root / "dataset/intelligence", pointer["json"])
            intelligence = optional(report_file, dict)
            if pointer.get("jsonSha256") != hashlib.sha256(report_file.read_bytes()).hexdigest():
                raise DataError("Intelligence report hash differs from its publication pointer")
            if not isinstance(intelligence.get("tests"), list):
                raise DataError("Invalid intelligence tests array")
            for row in intelligence["tests"]:
                if not isinstance(row, dict) or not {"testId", "testName", "browser", "cohort", "recommendations"}.issubset(row) or not isinstance(row["recommendations"], list):
                    raise DataError("Invalid intelligence test group")
                if row.get("riskScore") is not None and not 0 <= row["riskScore"] <= 100:
                    raise DataError("Invalid historical risk score")
        except (DataError, OSError, KeyError) as error:
            issues.append(str(error)); intelligence = {}
    else:
        issues.append("Intelligence report is unavailable.")
    healing = optional(root / "dataset/healing-history.json", list)
    evaluation = optional(root / "ml/evaluation-report.json", dict)
    if evaluation:
        try:
            valid_evaluation(evaluation)
        except DataError as error:
            issues.append(str(error)); evaluation = {}
    predictions = optional(root / "ml/prediction-report.json", dict)
    importance = optional(root / "ml/feature-importance.json", dict)
    comparison = optional(root / "ml/comparison-report.json", dict)
    for name, report in [("predictions", predictions), ("importance", importance), ("comparison", comparison)]:
        try:
            if report:
                if name == "predictions":
                    if not isinstance(report.get("predictions"), list) or any(not isinstance(item, dict) or not isinstance(item.get("models", {}), dict) for item in report["predictions"]):
                        raise DataError("Invalid forecast rows")
                elif name == "importance":
                    if not isinstance(report.get("cohorts"), dict): raise DataError("Invalid importance cohorts")
                    for models in report["cohorts"].values():
                        if not isinstance(models, dict): raise DataError("Invalid importance models")
                        for values in models.values():
                            if not isinstance(values, list): raise DataError("Invalid importance rows")
                            for value in values:
                                if not isinstance(value, dict) or not isinstance(value.get("feature"), str): raise DataError("Invalid importance feature")
                                for key in ["permutation_f1_decrease", "permutation_std", "training_impurity_importance"]:
                                    if type(value.get(key)) not in {int, float} or not math.isfinite(value[key]): raise DataError("Invalid importance measurement")
                elif not isinstance(report.get("cohorts"), dict): raise DataError("Invalid comparison cohorts")
        except (DataError, TypeError) as error:
            issues.append(f"Invalid ML {name}: {error}; report hidden.")
            if name == "predictions": predictions = {}
            elif name == "importance": importance = {}
            else: comparison = {}
            continue
        if report and (not evaluation or report.get("training_id") != evaluation.get("training_id")):
            issues.append(f"ML {name} has a different training ID; it is hidden to prevent mixing model versions.")
            if name == "predictions": predictions = {}
            elif name == "importance": importance = {}
            else: comparison = {}
    return {"root": str(root), "history": frame, "records": records, "healing": healing,
            "intelligence": intelligence, "evaluation": evaluation, "predictions": predictions,
            "importance": importance, "comparison": comparison, "manifests": manifests,
            "csv_synchronized": synchronized, "issues": issues, "provenance": provenance}
