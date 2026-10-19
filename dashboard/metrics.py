"""Explicit denominators for telemetry and frozen research report populations."""
from collections import Counter
import pandas as pd
from dataLoader import FAILURE_TYPES

FAILED = {"FAIL", "TIMED_OUT"}
VERIFIED_COHORTS = {"Ordinary", "Controlled experiment", "Temporal progression"}

def rate(numerator, denominator):
    return numerator / denominator if denominator else None


def filter_history(frame, scope="Verified research data", dates=None, browsers=(), tests=()):
    selected = frame[frame["record_type"] == "TEST_ATTEMPT"].copy()
    if scope == "Verified research data":
        selected = selected[selected["cohort"].isin(VERIFIED_COHORTS)]
    elif scope != "All recorded attempts":
        selected = selected[selected["cohort"] == scope]
    if dates and len(dates) == 2:
        start = pd.Timestamp(dates[0], tz="UTC")
        end = pd.Timestamp(dates[1], tz="UTC") + pd.Timedelta(days=1)
        selected = selected[(selected["start_time"] >= start) & (selected["start_time"] < end)]
    if browsers:
        selected = selected[selected["browser"].isin(browsers)]
    if tests:
        selected = selected[selected["test_id"].isin(tests)]
    return selected


def summary(frame):
    failures = int(frame["status"].isin(FAILED).sum())
    attempts = int(frame["healing_attempted"].sum())
    successful = int(frame["healing_successful"].sum())
    scored = int(frame["status"].isin({"PASS", *FAILED}).sum())
    return {"executions": len(frame), "failures": failures, "failure_rate": rate(failures, scored),
            "scored_attempts": scored, "healing_attempts": attempts, "successful_recoveries": successful,
            "failed_recoveries": attempts-successful, "healing_success_rate": rate(successful, attempts),
            "experiments": frame.loc[frame["experiment_id"].fillna("") != "", "experiment_id"].nunique()}


def failure_counts(frame):
    counts = frame.loc[frame["status"].isin(FAILED), "failure_type"].value_counts()
    return pd.DataFrame({"Failure type": FAILURE_TYPES, "Failures": [int(counts.get(name, 0)) for name in FAILURE_TYPES]})


def failure_trend(frame, frequency="15min"):
    if frame.empty:
        return pd.DataFrame(columns=["Time", "Failures", "Scored attempts", "Failure rate"])
    data = frame.assign(Failures=frame["status"].isin(FAILED).astype(int),
                        Scored=frame["status"].isin({"PASS", *FAILED}).astype(int))
    trend = data.set_index("start_time")[["Failures", "Scored"]].resample(frequency).sum()
    trend["Failure rate"] = trend["Failures"].div(trend["Scored"].replace(0, float("nan")))
    return trend.rename(columns={"Scored": "Scored attempts"}).rename_axis("Time").reset_index()


def risk_rows(report, selected):
    if selected.empty:
        return []
    # Match cohort as well as test/browser: shared IDs must not mix experiment evidence.
    identities = {(row.test_id, row.browser, "ordinary" if row.cohort == "Ordinary" else "verified-experiment")
                  for row in selected.itertuples() if row.cohort in VERIFIED_COHORTS}
    return [row for row in report.get("tests", []) if (row.get("testId"), row.get("browser"), row.get("cohort")) in identities]


def risk_table(rows):
    return pd.DataFrame([{"Test name": row["testName"], "Risk score": row.get("riskScore"),
                          "Risk level": row.get("riskLevel"), "Failure rate": row.get("failureRate"),
                          "Stability score": row.get("stabilityScore"), "Evidence": row.get("evidence"),
                          "Cohort": row.get("cohort"), "Group ID": row.get("groupId")}
                         for row in rows]).sort_values("Risk score", ascending=False, na_position="last") if rows else pd.DataFrame()


def recommendation_table(rows):
    # Association is report-level co-occurrence, never an invented one-to-one cause.
    counter = Counter()
    for row in rows:
        types = row.get("failures", {}).get("primaryFailureTypes", [])
        association = ", ".join(types) if types else "No primary failure (evidence/process guidance)"
        for recommendation in set(row.get("recommendations", [])):
            counter[(recommendation, association)] += 1
    return pd.DataFrame([{"Recommendation": key[0], "Frequency": value, "Associated failure type": key[1]}
                         for key,value in counter.most_common()])


def verified_evaluations(bundle, kind="adaptive-evaluations"):
    return sorted([row for row in bundle["manifests"] if row.get("kind") == kind and row.get("status") == "VERIFIED" and row.get("metrics")],
                  key=lambda row: row.get("completed_at", ""), reverse=True)


def healing_comparison(report):
    return pd.DataFrame([{"Arm": name, "Executions": arm["executions"], "Healing attempts": arm["healingAttempts"],
                          "Successful recoveries": arm["successfulRecoveries"], "Healing success rate": arm["healingSuccessRate"],
                          "Wrong recoveries": arm["wrongRecoveries"], "Masked defects": arm["maskedDefects"],
                          "Recovery actions": arm["recoveryActions"], "Business defect probes": arm["businessDefectExecutions"],
                          "Knowledge hits": arm.get("knowledgeBaseHits", 0), "Mean healing duration (ms)": arm["meanHealingDurationMs"]}
                         for name, arm in report.get("metrics", {}).get("arms", {}).items()])


def model_table(cohort):
    rows = []
    for group in ["baselines", "models"]:
        for name, result in cohort.get(group, {}).items():
            rows.append({"Method": name, "Accuracy": result.get("accuracy"), "Precision": result.get("precision"),
                         "Recall": result.get("recall"), "F1": result.get("f1_score"), "Balanced accuracy": result.get("balanced_accuracy"),
                         "Onset recall": result.get("failure_onset_recall")})
    return pd.DataFrame(rows)


def forecast_table(report, cohort, model):
    rows = []
    for item in report.get("predictions", []):
        if item.get("cohort") != cohort:
            continue
        prediction = item.get("models", {}).get(model, {})
        rows.append({"Test": item.get("test_name"), "Status": item.get("status"), "Reason": item.get("reason", ""),
                     "Forecast boundary": item.get("prediction_time"), "Prior history ended": item.get("history_end_time"),
                     "Predicted failure": prediction.get("next_execution_failed"), "Failure probability": prediction.get("failure_probability")})
    return pd.DataFrame(rows)


def dataset_statistics(bundle):
    raw = bundle["history"]
    tests = raw[raw["record_type"] == "TEST_ATTEMPT"]
    return pd.DataFrame([{"Measure": key, "Value": value} for key,value in {
        "Raw telemetry records": len(raw), "Test attempt records": len(tests), "Run-level errors": int((raw["record_type"] == "RUN_ERROR").sum()),
        "Distinct test IDs": tests["test_id"].nunique(), "Distinct runs": tests["run_id"].nunique() if not tests.empty else 0,
        "Experiment definitions": tests.loc[tests["experiment_id"].fillna("") != "", "experiment_id"].nunique(),
        "Observed failure categories": tests["failure_type"].dropna().nunique(),
        "Verified campaigns/evaluations": sum(row.get("status") == "VERIFIED" for row in bundle["manifests"]),
        "Invalid campaigns/evaluations (retained)": sum(row.get("status") == "INVALID" for row in bundle["manifests"]),
        "Healing operation records": len(bundle["healing"]),
    }.items()])
