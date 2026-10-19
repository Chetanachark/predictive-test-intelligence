# Sprint 8 Research Analytics Dashboard

A read-only Streamlit dashboard for **Predictive Test Intelligence and Adaptive Self-Healing Framework for Playwright-Based Web Test Automation Using Machine Learning**. It presents local execution evidence, historical risk and recommendations, verified recovery comparisons, and frozen ML evaluation results.

## Complete source files

```text
dashboard/
├── app.py                   # Executive cards and seven research tabs
├── dataLoader.py            # Local loading, validation and provenance
├── metrics.py               # Explicit denominators and report transformations
├── charts.py                # Plotly figures and SVG export settings
├── sidebar.py               # Telemetry and frozen-report controls
├── requirements.txt         # Three pinned direct dependencies
├── requirements-lock.txt    # Complete tested dependency versions
├── test_dashboard.py        # Integrity, metric and Streamlit interaction checks
├── .streamlit/config.toml   # Local server, light theme, usage collection disabled
├── .gitignore
├── assets/
│   ├── styles.css
│   └── screenshots/
│       ├── executive-summary.png
│       ├── adaptive-healing.png
│       ├── machine-learning.png
│       ├── feature-importance.png
│       └── failure-taxonomy.svg
└── README.md
```

All source files contain complete implementations. Screenshots are generated local artifacts and ignored by Git. The virtual environment is isolated from `ml/.venv`; no application, automation, business logic, dataset, or ML pipeline source changes are required.

## Dependencies and launch

Tested with Python 3.11, Streamlit 1.66.0, Pandas 3.0.6 and Plotly 7.1.0. Use the full lock file to reproduce transitive versions.

From the project root:

```bash
python3.11 -m venv dashboard/.venv
dashboard/.venv/bin/python -m pip install -r dashboard/requirements-lock.txt
cd dashboard
.venv/bin/python -m streamlit run app.py
```

Open **http://127.0.0.1:8501**. Launch from `dashboard/` so `.streamlit/config.toml` applies. Stop with Ctrl+C. The dashboard reads datasets relative to the project directory, independent of the working directory. `PREDICTIVE_PROJECT_ROOT` optionally selects another compatible local project root. No file upload, API service, model training, test execution or healing action is exposed in the UI.

## Local data sources

| Source | Purpose |
|---|---|
| `dataset/execution-history.json` | Authoritative attempt records, status, taxonomy and recovery summaries |
| `dataset/test-history.csv` | Synchronization verification against every JSON row and field |
| `dataset/intelligence/latest.json` and its referenced report | Published risk, stability, failure associations and recommendations; pointer hash verified |
| `dataset/healing-history.json` | Healing operation record count for corpus statistics |
| `dataset/campaigns/*/campaign.json` | Verified controlled membership and campaign statistics |
| `dataset/healing-evaluations/*/evaluation.json` | Verified safety campaign membership and source provenance |
| `dataset/adaptive-evaluations/*/comparison.json` | Independent heldout semantic-versus-historical healing comparison |
| `dataset/progression-campaigns/*/campaign.json` | Verified temporal experiment membership |
| `ml/evaluation-report.json` | Frozen holdout metrics, model/baseline comparisons, PR arrays and measured forecasts |
| `ml/prediction-report.json` | Unlabeled forecasts and abstentions; never used to calculate accuracy |
| `ml/feature-importance.json` | Heldout permutation and training impurity importance |
| `ml/comparison-report.json` | Evidence beyond persistence and label-history ablation |

The dashboard checks record identities, timestamps/durations, taxonomy, healing flags, duplicate IDs, CSV agreement, report training-ID consistency, holdout support and available recovery/safety denominators. Missing optional sources appear in the provenance expander; a missing/corrupt authoritative history stops with an explanatory message. Invalid optional ML reports are hidden. A CSV mismatch produces a warning while JSON remains authoritative. It never repairs or overwrites sources.

Caching keys include source paths, modification times and sizes. The loader retries a snapshot when files change during loading. Use **Refresh local evidence** after new reports are published. This clears dashboard caches, without executing any pipeline. Provenance exposes source-file hashes. It does not cryptographically authenticate the original experiments or revalidate archived browser traces.

## Modules and interpretation

1. **Executive summary:** total attempts, failed attempts, failure rate, healing success rate, measured holdout prediction accuracy, and distinct experiment definitions.
2. **Failure analysis:** all eight frozen failure categories, nonzero-category donut, and UTC failure counts/rates over time. Plotly line, bar and pie figures are provided.
3. **Risk intelligence:** ten highest historical risk groups, evidence levels, stability, failure rate and risk distribution. Saved scores are not recomputed or presented as ML probabilities.
4. **Recommendations:** frequency per scored test group and co-occurring primary failure types. Generic guidance remains associated with its report group, not an invented causal mapping.
5. **Adaptive healing:** recovery summaries in the selected telemetry population; a separate verified baseline/adaptive heldout comparison with wrong recoveries, masked defects, opportunity counts and timing.
6. **Machine learning:** four metric cards, annotated confusion matrix, PR curve, model/baseline/ablation comparison, failure-onset examples and CSV download. Unlabeled forecasts are separated in an expander.
7. **Feature importance:** all available predictors ranked by heldout permutation F1 decrease, with standard deviations, impurity values and CSV download. Negative importance is retained; correlated features may share or mask importance.
8. **Research evidence:** full-corpus record/test/run/experiment/category counts, cohort-status heatmap, ML dataset quality and the saved beyond-persistence comparison.

### Keep populations distinct

- **Telemetry filters:** scope, UTC dates, browser and test ID. Default scope includes ordinary attempts and attempts belonging to verified campaigns. Invalid/unaudited experiment records remain accessible through explicit scope choices. Run-level errors are excluded from execution cards and retained in corpus statistics.
- **Execution unit:** cards count attempts, including retries. Failure rate is failed/timed-out attempts divided by PASS/FAIL/TIMED_OUT attempts; skipped/interrupted attempts are excluded from this denominator. This is distinct from ML's final logical execution label after retries.
- **Healing unit:** telemetry counts one attempt even if several healing operations occurred. Successful recovery requires the recorded verified final passing attempt. No opportunities means N/A, not 0%.
- **Saved intelligence:** matching test/browser/cohort groups are selected by telemetry filters. Scores and recommendation frequencies retain the saved report population and cannot be narrowed to just the chosen dates. Snapshot age and source coverage are shown. The existing report covers 453 source records; current telemetry contains 1,478. Its failure/stability definitions use first-attempt outcomes.
- **ML controls:** independent cohort/model selectors. Changing telemetry filters does not recalculate saved holdout metrics. Default is progression/Random Forest: 384 training rows, 192 holdout rows (168 PASS, 24 FAIL). Ordinary data have no trained model and display N/A. Differing training IDs prevent report mixing.
- **Healing comparison:** independent evaluation selector, latest verified by completion time. Both arms heal: baseline uses semantic ranking, adaptive adds historical ranking. The teacher set is excluded. This is not a comparison against no healing. Wrong recoveries are checked against recovery actions; masked defects against explicit business-defect probes. Missing evidence is unknown, not zero.
- **Forecasts:** uncalibrated probabilities and ABSTAIN remain explicit. Closed progression episode continuations are hypothetical; only the holdout examples have measured next-execution outcomes.
- **Research scope:** perfect controlled scores do not establish natural-regression prediction. Label history itself learns the repeated protocol; warning features improve precision in the observed ablation. Two heldout campaigns do not establish population-level significance. Importance measures model reliance, not causality.

## Verification

From project root:

```bash
dashboard/.venv/bin/python -m unittest discover -s dashboard -p 'test_*.py' -v
dashboard/.venv/bin/python -m pip check
```

The integration checks use the existing local research assets. Current verification: **20 tests pass**, all **12 Plotly charts render**, and Chromium reports **zero page errors**.

Manual checks:

1. Open the default scope: 1,166 attempts, 330 failed attempts, 28.3% failure rate, 94/228 recoveries (41.2%), and 37 experiment definitions. The separate prediction card reads 100% for the saved 192-row controlled holdout.
2. Select **Ordinary** telemetry: 204 attempts and no observed failures in the current snapshot; healing success is N/A. Correct rejection of invalid business input remains PASS.
3. Select **ordinary** ML cohort: accuracy becomes N/A; no one-class predictor or fabricated future accuracy is shown.
4. Combine Ordinary scope with PROG-001: telemetry is empty, rates are N/A, while independently scoped ML results remain available.
5. Compare healing arms: 2/8 (25%) baseline recoveries and 4/8 (50%) adaptive recoveries. Both have zero observed wrong recoveries and masked defects in their evaluated probes; examine the small denominators.
6. Inspect the risk snapshot warning, CSV agreement indicator, report training IDs and row-level prediction history cutoffs.
7. Use each Plotly toolbar's camera button to export SVG; CSV/report download buttons preserve the displayed evidence. Interactive Plotly figures support hover and zoom without external data services.

## Screenshot examples

Actual browser captures are saved in `assets/screenshots/`:

- **executive-summary.png:** research title and pipeline, scoped KPI cards, taxonomy bars and failure-share donut.
- **adaptive-healing.png:** attempt outcomes and the independently scoped recovery/safety comparison. A lower scroll position isolates the 25% versus 50% chart.
- **machine-learning.png:** controlled-evidence notice, four holdout metrics, confusion matrix and precision–recall curve.
- **feature-importance.png:** twenty ranked predictors with the selected model/cohort controls visible.

For dissertation figures, export individual charts as SVG, keep the cohort/sample-size caption, and include the evaluation date/training ID in the figure caption. The light theme and Arial chart font are intended for printed or projected review.

## Primary API references

- [Streamlit AppTest](https://docs.streamlit.io/develop/api-reference/app-testing/st.testing.v1.apptest)
- [Plotly heatmaps](https://plotly.com/python/heatmaps/)

The complete implementation and screenshot examples are packaged in `sprint-8-dashboard.zip`. The archive excludes virtual environments, Python caches and all source datasets.
