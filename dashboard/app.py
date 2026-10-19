"""Sprint 8: a read-only evidence dashboard for dissertation review."""
from pathlib import Path
import json
import pandas as pd
import streamlit as st
import charts
from dataLoader import PROJECT_ROOT, DataError, load_bundle, source_signature
from metrics import (filter_history, summary, failure_counts, failure_trend, risk_rows, risk_table,
                     recommendation_table, healing_comparison, model_table, forecast_table, dataset_statistics)
from sidebar import controls

st.set_page_config(page_title="Predictive Test Intelligence", page_icon="📊", layout="wide")
st.markdown(f"<style>{(Path(__file__).parent / 'assets/styles.css').read_text()}</style>", unsafe_allow_html=True)

@st.cache_data(show_spinner="Reading local research evidence…", max_entries=3)
def cached_bundle(root, signature):
    return load_bundle(Path(root))


def percent(value):
    return f"{value:.1%}" if value is not None and pd.notna(value) else "N/A"


def plot(figure, key):
    st.plotly_chart(figure, width="stretch", theme=None, config=charts.CONFIG, key=key)


def table(frame, percent_columns=()):
    config = {column: st.column_config.NumberColumn(format="percent") for column in percent_columns}
    st.dataframe(frame, hide_index=True, width="stretch", column_config=config)


try:
    bundle = cached_bundle(str(PROJECT_ROOT), source_signature(PROJECT_ROOT))
except (DataError, OSError, ValueError) as error:
    st.title("Research evidence unavailable")
    st.error(str(error))
    st.info("Restore dataset/execution-history.json and refresh. The dashboard does not generate or repair source data.")
    st.stop()
selection = controls(bundle)
selected = filter_history(bundle["history"], selection["scope"], selection["dates"], selection["browsers"], selection["tests"])
stats = summary(selected)
cohort = bundle["evaluation"].get("cohorts", {}).get(selection["cohort"], {})
model = cohort.get("models", {}).get(selection["model"], {})
comparison = healing_comparison(selection["healing_evaluation"])

st.markdown('<div class="research-eyebrow">SPRINT 08 · RESEARCH EVIDENCE · LOCAL DATA</div>', unsafe_allow_html=True)
st.title("Predictive Test Intelligence")
st.caption("Predictive Test Intelligence and Adaptive Self-Healing Framework for Playwright-Based Web Test Automation Using Machine Learning")
st.markdown('<div class="research-flow">Playwright telemetry &nbsp; → &nbsp; Test intelligence &nbsp; → &nbsp; Adaptive recovery &nbsp; → &nbsp; Predictive modeling</div>', unsafe_allow_html=True)
columns = st.columns(6)
for column, label, value in zip(columns,
    ["Total executions", "Total failures", "Failure rate", "Healing success rate", "Prediction accuracy", "Total experiments"],
    [f"{stats['executions']:,}", f"{stats['failures']:,}", percent(stats["failure_rate"]), percent(stats["healing_success_rate"]), percent(model.get("accuracy")), f"{stats['experiments']:,}"]):
    column.metric(label, value)
st.caption(f"Telemetry scope: {selection['scope']}. Execution cards count test attempts, including retries; run errors are excluded. "
           f"Failure rate uses {stats['scored_attempts']:,} PASS/FAIL/TIMED_OUT attempts. Experiments are distinct definitions. "
           f"Prediction accuracy uses the saved {selection['cohort']} / {selection['model']} holdout ({cohort.get('test_rows', 0)} rows), independent of telemetry filters.")
if selected.empty:
    st.info("No test attempts match these telemetry filters. Frozen research reports remain available in their own scopes.")
with st.expander(f"Data provenance and integrity · {'JSON/CSV synchronized' if bundle['csv_synchronized'] else 'source warning'}"):
    st.write(f"Loaded {len(bundle['history']):,} raw records. Dashboard access is read only; refresh picks up changed local files.")
    for issue in bundle["issues"]:
        st.warning(issue)
    table(pd.DataFrame(bundle["provenance"]))

tabs = st.tabs(["Failure analysis", "Risk intelligence", "Recommendations", "Adaptive healing", "Machine learning", "Feature importance", "Research evidence"])
with tabs[0]:
    st.subheader("Failure analysis")
    st.caption("Observed failed attempts only. A correctly rejected invalid coupon is PASS; a verified healed PASS is not counted as a failed attempt.")
    counts = failure_counts(selected)
    left,right = st.columns([1.4,1])
    with left: plot(charts.bars(counts, "Failures", "Failure type", "Failure taxonomy distribution", horizontal=True, height=410), "failure-bars")
    with right:
        if stats["failures"]:
            plot(charts.failure_pie(counts), "failure-pie")
        else:
            st.info("No observed failures in this telemetry selection.")
    if not selected.empty:
        plot(charts.trend(failure_trend(selected, selection["frequency"])), "failure-trend")
    st.download_button("Download failure counts", counts.to_csv(index=False), "failure-counts.csv", "text/csv")

intelligence = bundle["intelligence"]
risks = risk_table(risk_rows(intelligence, selected))
recommendations = recommendation_table(risk_rows(intelligence, selected))
with tabs[1]:
    st.subheader("Risk intelligence")
    source_count = intelligence.get("source", {}).get("recordCount")
    if intelligence:
        st.info(f"Frozen intelligence snapshot: {intelligence.get('generatedAt')} · {source_count} source records; current telemetry: {len(bundle['history'])}. "
                "These historical heuristic scores are not current ML probabilities. Telemetry filters select matching test/browser/cohort groups; scores and denominators remain those of the saved report.")
    if risks.empty:
        st.info("No saved intelligence groups match this selection. The dashboard does not recompute risk scores.")
    else:
        st.markdown("**Top 10 highest risk test groups**")
        table(risks.head(10), ["Failure rate"])
        left,right = st.columns(2)
        with left: plot(charts.risk_distribution(risks), "risk-distribution")
        with right: plot(charts.bars(risks.head(10), "Risk score", "Test name", "Highest risk groups", horizontal=True, height=410), "highest-risk")
        st.caption("LIMITED_HISTORY means fewer than ten scored executions. Failure rate and stability retain the intelligence report's first-attempt definitions; they differ from final retry outcomes.")
with tabs[2]:
    st.subheader("Recommendation engine")
    st.caption("Frequency counts scored intelligence groups receiving each recommendation. Associated failure types are report-group co-occurrences, not inferred causes or one-to-one mappings.")
    if recommendations.empty:
        st.info("No saved recommendations match the telemetry selection.")
    else:
        table(recommendations)
        common = recommendations.groupby("Recommendation", as_index=False)["Frequency"].sum().sort_values("Frequency", ascending=False).head(8)
        common["Action"] = [f"Action {index+1}" for index in range(len(common))]
        plot(charts.bars(common, "Frequency", "Action", "Most common recommended actions · hover for full text", horizontal=True), "recommendations")

with tabs[3]:
    st.subheader("Adaptive self-healing")
    st.caption("Recovery counts below are test-attempt summaries in the telemetry selection. Multiple healing operations in one attempt count once here.")
    columns = st.columns(3)
    for column,label,key in zip(columns,["Healing attempts","Successful recoveries","Failed recoveries"], ["healing_attempts","successful_recoveries","failed_recoveries"]):
        column.metric(label, f"{stats[key]:,}")
    if stats["healing_attempts"]:
        outcomes = pd.DataFrame({"Outcome":["Verified recovery", "Attempt not recovered"], "Attempts":[stats["successful_recoveries"], stats["failed_recoveries"]]})
        plot(charts.bars(outcomes, "Outcome", "Attempts", "Observed recovery outcomes"), "healing-outcomes")
    else:
        st.info("No healing opportunities in this telemetry selection; success rate is N/A.")
    st.markdown("**Baseline versus adaptive ranking · verified heldout comparison**")
    if comparison.empty:
        st.info("No verified adaptive comparison is available. Wrong recoveries and masked defects are unknown, not zero.")
    else:
        evaluation = selection["healing_evaluation"]
        st.caption(f"Independent population: {evaluation.get('completed_at')} · evaluation {evaluation.get('evaluation_id')}. "
                   "Both arms heal; baseline uses semantic ranking and adaptive adds historical evidence. Teacher outcomes are excluded. Telemetry filters do not alter this comparison.")
        columns = st.columns(2)
        columns[0].metric("Wrong recoveries · evaluated arms", int(comparison["Wrong recoveries"].sum()))
        columns[1].metric("Masked defects · evaluated probes", int(comparison["Masked defects"].sum()))
        table(comparison, ["Healing success rate"])
        plot(charts.bars(comparison, "Arm", "Healing success rate", "Historical learning comparison · recoveries / attempts", color="Arm"), "adaptive-comparison")
        st.caption("Safety denominators: wrong recoveries / recovery actions; masked defects / business-defect probes. Zero counts describe these evaluated probes, not a universal safety guarantee.")
        for limitation in evaluation.get("metrics", {}).get("limitations", []):
            st.caption(limitation)

with tabs[4]:
    st.subheader("Predictive failure modeling")
    st.caption(f"Frozen {selection['cohort']} / {selection['model']} evaluation · training ID {bundle['evaluation'].get('training_id', 'unavailable')} · {bundle['evaluation'].get('evaluated_at', '')}")
    if not model:
        st.info(f"No trained model for this cohort. {', '.join(cohort.get('reasons', []))}")
    else:
        if selection["cohort"] != "ordinary":
            st.warning("Controlled experiment results only. Later campaigns share a designed generator with training; these scores do not establish natural-regression prediction.")
        columns = st.columns(4)
        for column,label,key in zip(columns,["Accuracy","Precision","Recall","F1 score"],["accuracy","precision","recall","f1_score"]):
            column.metric(label,percent(model.get(key)))
        st.caption(f"Train: {cohort.get('train_rows')} rows · holdout: {cohort.get('test_rows')} rows · {cohort.get('test_class_counts')} (0=PASS, 1=FAIL). "
                   "Rolling one-step evaluation uses only earlier completed history; models stay frozen.")
        left,right = st.columns(2)
        with left: plot(charts.matrix(model["confusion_matrix"]), "confusion-matrix")
        with right:
            if model.get("pr_curve"): plot(charts.pr_curve(model["pr_curve"]), "pr-curve")
            else: st.info("PR curve unavailable for this evaluation population.")
        st.markdown("**Models, baselines and ablations**")
        table(model_table(cohort), ["Accuracy","Precision","Recall","F1","Balanced accuracy","Onset recall"])
        st.caption("Always-pass accuracy can be high with rare failures. Compare failure F1 and balanced accuracy; onset recall measures FAIL after previous PASS.")
        evidence = pd.DataFrame(model.get("prediction_evidence", []))
        st.markdown("**Measured holdout prediction examples**")
        onsets_only = st.checkbox("Show failure onsets only", value=True)
        shown = evidence
        if onsets_only and not evidence.empty:
            shown = evidence[(evidence.previous_failed == 0) & (evidence.actual_failed == 1)]
        if shown.empty: st.info("No matching measured prediction examples.")
        else: table(shown.head(30), ["failure_probability"])
        st.download_button("Download measured predictions", evidence.to_csv(index=False), "heldout-predictions.csv", "text/csv")
    with st.expander("Unlabeled next-execution forecasts · not measured accuracy"):
        forecasts = forecast_table(bundle["predictions"], selection["cohort"], selection["model"])
        st.caption("Probabilities are uncalibrated. ABSTAIN is retained. Temporal progression forecasts describe hypothetical continuation of closed controlled episodes; use heldout evidence for measured performance.")
        if not forecasts.empty: table(forecasts, ["Failure probability"])
        else: st.info("No matching forecast report.")

with tabs[5]:
    st.subheader("Feature importance")
    values = bundle["importance"].get("cohorts", {}).get(selection["cohort"], {}).get(selection["model"], [])
    st.caption(bundle["importance"].get("method", "No compatible importance report"))
    if not values:
        st.info("No compatible feature importance for this model/cohort.")
    else:
        importance = pd.DataFrame(values).sort_values("permutation_f1_decrease", ascending=False)
        plot(charts.bars(importance, "permutation_f1_decrease", "feature", "Heldout permutation importance · decrease in failure F1", horizontal=True, height=650), "feature-importance")
        table(importance)
        st.caption("Positive decrease indicates model reliance. Negative values are retained. Correlated predictors can mask or share importance; these values are not causal effects. Impurity importance includes missing indicators under their source feature.")
        st.download_button("Download importance", importance.to_csv(index=False), "feature-importance.csv", "text/csv")

with tabs[6]:
    st.subheader("Research evidence")
    st.caption("Whole-corpus statistics below are independent of telemetry filters.")
    left,right = st.columns([1,1.5])
    with left: table(dataset_statistics(bundle))
    with right:
        attempts = bundle["history"][bundle["history"].record_type == "TEST_ATTEMPT"]
        if not attempts.empty: plot(charts.cohort_heatmap(attempts), "cohort-heatmap")
    quality = bundle["evaluation"].get("dataset_quality", {})
    if quality:
        table(pd.DataFrame([{"ML cohort": name, "Logical executions": row["executions"], "Series": row["series"],
                             "Series changing outcome": row["seriesWithOutcomeVariation"], "Supervised samples": row["samples"],
                             "Passing labels": row["classCounts"]["0"], "Failure labels": row["classCounts"]["1"], "Usable temporal blocks": row["blocks"]}
                            for name,row in quality.items()]))
    evidence = bundle["comparison"].get("cohorts", {}).get(selection["cohort"], {}).get("models", {})
    if evidence:
        st.markdown("**Evidence beyond persistence**")
        table(pd.DataFrame([{"Model":name, **value} for name,value in evidence.items()]))
    st.info("Research interpretation: controlled progression can show warning information beyond persistence, but repeated generator structure remains learnable. "
            "Label-history ablation is also strong; report precision gains rather than attributing onset recall exclusively to warning features. Two heldout campaigns do not establish population-level generalization.")
    st.caption("Pipeline distinctions: raw records include run errors; telemetry cards count attempts; ML samples aggregate retries and exclude cold starts; healing safety uses independently verified probes.")
    st.download_button("Download ML comparison report", json.dumps(bundle["comparison"], indent=2), "comparison-report.json", "application/json")
st.caption("Sprint 8 · Local research visualization · No training, mutation, healing or source-data writes from this dashboard")
