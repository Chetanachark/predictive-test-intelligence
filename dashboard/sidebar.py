import streamlit as st
from metrics import verified_evaluations


def controls(bundle):
    frame = bundle["history"]
    st.sidebar.markdown("### Evidence controls")
    scope = st.sidebar.selectbox("Telemetry scope", ["Verified research data", "Ordinary", "Controlled experiment", "Temporal progression", "Unaudited experiment", "All recorded attempts"])
    dates = None
    if not frame.empty:
        dates = st.sidebar.date_input("Execution dates (UTC)", value=(frame.start_time.min().date(), frame.start_time.max().date()),
                                      min_value=frame.start_time.min().date(), max_value=frame.start_time.max().date())
        if len(dates) != 2:
            st.sidebar.info("Select both dates to apply the date range.")
    browsers = st.sidebar.multiselect("Browsers", sorted(frame.browser.dropna().unique()), help="Empty selection includes all browsers.")
    tests = st.sidebar.multiselect("Test IDs", sorted(frame.test_id.dropna().unique()), help="Empty selection includes all tests.")
    frequency = st.sidebar.selectbox("Trend interval", ["15min", "5min", "1h", "1D"])
    st.sidebar.divider()
    st.sidebar.markdown("### Frozen research reports")
    cohorts = list(bundle["evaluation"].get("cohorts", {}))
    cohort = st.sidebar.selectbox("ML cohort", cohorts or ["Unavailable"], index=cohorts.index("progression") if "progression" in cohorts else 0)
    models = [name for name in bundle["evaluation"].get("cohorts", {}).get(cohort, {}).get("models", {}) if name in {"decision_tree", "random_forest"}]
    model = st.sidebar.selectbox("ML model", models or ["Unavailable"], index=models.index("random_forest") if "random_forest" in models else 0)
    evaluations = verified_evaluations(bundle)
    evaluation_index = st.sidebar.selectbox("Healing comparison", range(len(evaluations)),
        format_func=lambda index: evaluations[index].get("completed_at", "") + " · " + evaluations[index]["evaluation_id"][:8]) if evaluations else None
    st.sidebar.caption("Telemetry filters affect attempt charts and matching intelligence groups. ML and healing comparisons retain their saved evaluation populations.")
    if st.sidebar.button("Refresh local evidence", width="stretch"):
        st.cache_data.clear()
        st.rerun()
    return {"scope": scope, "dates": dates, "browsers": browsers, "tests": tests, "frequency": frequency,
            "cohort": cohort, "model": model, "healing_evaluation": evaluations[evaluation_index] if evaluation_index is not None else {}}
