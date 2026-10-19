Sprint 7 + 7.5: offline predictive failure modeling
==================================================

Scope
-----
JavaScript builds validated, immutable telemetry snapshots. Python/scikit-learn
trains and evaluates fixed classifiers. Application code, business logic, the
34 original E2E tests, the telemetry writer and the healing engine are unchanged.
Predictions do not trigger healing or skip tests. No dashboard is introduced.

Setup (from project root)
-------------------------
Requires Node.js 22+ and Python 3.11. No additional JavaScript packages are needed.
  python3.11 -m venv ml/.venv
  ml/.venv/bin/python -m pip install -r ml/requirements-lock.txt

Collect the preregistered browser campaigns in order; see the progression guide:
  automation/experiments/progression/README.txt
Then run:
  npm run build --prefix ml
  ml/.venv/bin/python ml/train.py
  ml/.venv/bin/python ml/evaluate.py
  ml/.venv/bin/python ml/predict.py

Validate after generating the dataset:
  node --test automation/experiments/progression/progression.test.js
  npm test --prefix ml
  ml/.venv/bin/python -m unittest discover -s ml -p 'test_*.py' -v
  ml/.venv/bin/python -m pip check

Files
-----
  datasetBuilder.js       Telemetry validation, audit admission, temporal features
  features.json          Active v2 contract: 20 predictors, target and ranges
  common.py              Independent lineage/feature checks, split and artifact IO
  train.py               Fixed Decision Tree/Random Forest plus two ablations
  evaluate.py            Temporal holdout, baselines, PR curves and importance
  predict.py             Next-execution forecasts or explicit abstention
  datasetBuilder.test.js
  test_pipeline.py
  requirements.txt       Direct pinned dependencies
  requirements-lock.txt  Complete Python dependency versions
  package.json           Build/test scripts; no dependencies
  training-data.csv      Convenience copy of latest snapshot
  prediction-input.json  Features computed at snapshot as_of time
  latest-dataset.json    Atomically published snapshot pointer
  evaluation-report.json
  prediction-report.json
  feature-importance.json
  comparison-report.json
  datasets/<build-id>/
    dataset-manifest.json
    execution-lineage.json
    training-data.csv
    prediction-input.json
  models/latest.json
  models/<training-id>/
    training-manifest.json
    <cohort>-decision_tree.pkl
    <cohort>-random_forest.pkl
    <cohort>-label_history_only.pkl
    <cohort>-warning_signals_only.pkl
    evaluation-report.json
    prediction-report.json
    feature-importance.json
    comparison-report.json

Each build/training session receives a UUID. Generated artifacts, datasets and
.venv are ignored by Git. Preserve complete snapshot/model directories externally
when archiving dissertation results. Models are created only for eligible cohorts.
TELEMETRY_DIR can select another compatible telemetry store. Python commands
accept --ml-dir for isolated compatible snapshot/output directories.

Target and admission policy
----------------------------
next_execution_failed = 1 when the next logical execution finally FAILs or
TIMED_OUTs after configured retries/healing; PASS = 0. Correct rejection of invalid
business input is PASS/0. A failed first attempt followed by a passing retry is
final target 0, with a retry signal for later executions. Passing verified healing
is also final target 0, with its original locator symptom retained historically.
Attempts group by run/test/project/browser/repeat. Retries must be contiguous and
chronologically valid. SKIPPED, INTERRUPTED, expected failures, run-level errors,
incomplete attempts and unfinished blocks do not receive target labels.

Ordinary runs need completed terminal run manifests. Controlled rows need VERIFIED
campaign/evaluation membership, matching versions/run IDs, and verified emulated
injection evidence. Progression campaigns also pass independent protocol validation.
INVALID/unaudited experiments remain archived but are excluded, with counts.
Expected experiment labels never replace observed outcomes. The first pilots
exposed runner/setup and timing/classification issues; their INVALID evidence is
retained. Admission checks were fixed before collecting/evaluating the final set.

Leakage prevention and histories
---------------------------------
Series identity includes cohort, test_id, suite_name, browser, project_name,
app_version, healing_mode and learningEnabled. Ordinary and fixed-fault controlled
histories stay separate. Progression histories also isolate campaign episodes;
no history crosses from a training campaign into a later holdout episode. Version
hashes are audited in source manifests; a new app version starts fresh history.

Each supervised row predicts at target start time. Only executions ending strictly
BEFORE that time enter its latest-10 window. At least two earlier executions are
required. Current outcome, duration, retries, healing result, planned stage, seed,
step, experiment ID and future records are never predictors. Only the 20 declared
feature columns reach sklearn; labels and audit/control fields cannot enter the
matrix. Forecast rows use completed history at the snapshot as_of boundary.

Python independently reconstructs all windows, features, labels and persistence
baselines from execution-lineage.json. Snapshots fingerprint raw history, audit
files, feature contract, builder code and output artifacts. Models fingerprint
training data, sample IDs, feature order, runtime versions and source code. Stale
contracts, forged feature/label lineage or mismatched artifact hashes fail closed.
These hashes detect accidental corruption; they are not signatures against a
malicious writer rewriting every artifact. Only load locally produced pickles.

Features (v2)
--------------
Prior window N = up to 10 completed logical executions:
  failure_rate: final failed / N
  retry_rate: executions with additional attempts / N
  stability_score: 100 * (1 - failure_rate)
  average_duration: mean summed attempt durations, ms; excludes retry waiting
  duration_variance: population variance of summed durations, ms squared
  locator_failure_rate: prior executions with missing/ambiguous locator symptoms / N
  actionability_failure_rate: prior executions with actionability symptoms / N
  healing_success_rate: final verified recoveries / healing opportunities
  knowledge_base_hit_rate: hits / learning-enabled healing opportunities
  risk_score: 100 * (0.60*failure_rate + 0.25*retry_rate + 0.15*locator_failure_rate)
  failure_streak: consecutive final failures at window end
  pass_streak: consecutive final passes at window end
  mean_time_between_failures: elapsed ms between final failure end times, averaged

Latest-5 subset of the prior window:
  duration_trend: OLS slope of durations, ms per execution
  duration_growth_rate: (newer-half mean - older-half mean) / max(older mean, 1)
  retry_trend: OLS slope of binary retry indicators
  locator_volatility_index: fraction of adjacent locator-symptom indicators changing
  healing_reliance_score: fraction attempting healing
  healing_success_momentum: OLS slope of verified healing outcomes at opportunities
  recent_failure_rate: final failures / subset size

Streaks are capped by available window length. Healing/knowledge rates are null
without opportunities. Healing momentum is null with <2 opportunities; MTBF is
null with <2 failures. Missing-value imputation is fitted on training rows only.
Original failure symptoms are read from failure_type/original_failure_type.
Risk is recomputed past-only, never read from a later intelligence report. Stability
and risk are derived features, not independent research signals. See features.json
for all exact ranges, definitions and nullability rules.

Training and temporal evaluation
---------------------------------
Ordinary, fixed-fault controlled and temporal progression cohorts train separately.
Runs/campaigns form complete temporal blocks. Latest ceil(20% of blocks) are held
out; a training block must finish strictly before the earliest holdout block starts.
Overlapping blocks are purged. In the six preregistered progression campaigns,
four train and the final two are held out. Both classes, >=30 training rows,
>=10 holdout rows, >=5 training examples/class and >=2 training blocks are required.
Otherwise NOT_TRAINED is reported; no one-class ordinary predictor is fabricated.

Fixed seed 42, threshold 0.5, no holdout tuning or selection:
  Decision Tree: max_depth 4, min_samples_leaf 3, balanced class weights.
  Random Forest: 200 trees, max_depth 6, min_samples_leaf 2, balanced weights.
Median imputation with missing indicators fits only on training rows.

Two same-hyperparameter Decision Tree ablations:
  label_history_only: failure rate, stability, failure/pass streaks, recent failure
    rate, MTBF; excludes duration/retry/locator/healing warning signals.
  warning_signals_only: excludes label-history features and derived risk score.
Training manifests explicitly record each artifact's predictor list. Ablations are
for evaluation only; predict.py emits the two primary models.

Evaluation is rolling one-step-ahead with frozen models: later holdout predictions
may use earlier completed observations in the SAME holdout episode. This is not
fixed-horizon batch forecasting. No holdout labels update model parameters.
Always-pass, historical-failure-rate >=0.5, training-majority and persistence
baselines are reported alongside both primary models and ablations.

Metrics: accuracy, precision, recall, F1, balanced accuracy, class support,
confusion matrix [[TN,FP],[FN,TP]], per-campaign scores, PR curve arrays and average
precision. Undefined precision/recall/F1 explicitly use zero; balanced accuracy
and PR curves are null for single-label holdouts. PR precision/recall arrays have
one more entry than thresholds. Per-model prediction_evidence retains every holdout row, prediction boundary,
last history timestamp, prior outcome, actual label and forecast. Onset recall
counts prior PASS -> current FAIL;
repair recognition counts prior FAIL -> current PASS. Persistence cannot anticipate
onset. Disagreement counts show whether a model simply copies prior outcomes.

Importance and claim limits
----------------------------
feature-importance.json reports heldout permutation F1 decrease (10 repeats,
seed 42) and training impurity importance; missing-indicator importance is grouped
under its source feature. Importance is model reliance, not a causal explanation;
correlated features can share/mask importance. No importance-based feature selection
uses this holdout. Changes after inspecting results require a NEW final holdout.

comparison-report.json requires positive F1 gains over persistence AND the
label-history-only ablation, balanced accuracy gain over persistence, and nonzero
onset recall before flagging controlled warning-signal evidence. Failed comparisons
remain visible. This flag is not a significance test. Two holdout campaigns are
insufficient for robust population-level significance claims.

Progression stimuli are designed and emulated, with jitter, slow healthy controls,
aborted degradation and repair phases. Locator/recovery families intentionally
overlap. Successful later-seed prediction is evidence within this generator,
not proof of natural regression prediction, unseen-family generalization or
calibrated failure probability. Ordinary telemetry still needs genuine failures.
Current-phase metadata are audit-only; predictions never trigger application actions.

Primary methodological references
-----------------------------------
https://scikit-learn.org/stable/common_pitfalls.html
https://scikit-learn.org/stable/modules/cross_validation.html
https://scikit-learn.org/stable/modules/permutation_importance.html

Measured Sprint 7.5 results (training ID 4a6dc29d-f744-4efd-821b-805507fd8323)
------------------------------------------------------------------------------
Six VERIFIED campaigns: seeds 103,211,307,419,521,631; 624 logical observations,
744 attempts, 72 final failures, 48 retry-recovered observations. All 24 episode
series change outcome. The progression feature table has 576 samples; after the
first four campaigns train on 384 rows, later two evaluate on 192 (168 pass/24 fail).
The complete three-cohort feature table has 828 supervised rows. Raw history has
1478 attempts/run records; JSON/CSV synchronization and archived artifact links
validate. One run error and 311 unaudited attempts are excluded; 218 accepted
logical executions are cold starts across all cohorts. Invalid pilots are retained.

Progression holdout (failure is positive class):
  method                     accuracy precision recall   F1       balanced_acc
  always_pass                .875000  .000000   .000000  .000000  .500000
  historical_failure_rate    .875000  .000000   .000000  .000000  .500000
  persistence                .833333  .333333   .333333  .333333  .619048
  decision_tree             1.000000 1.000000  1.000000 1.000000 1.000000
  random_forest             1.000000 1.000000  1.000000 1.000000 1.000000
  label_history_only         .937500  .666667  1.000000  .800000  .964286
  warning_signals_only       .994792  .960000  1.000000  .979592  .997024

Both primary confusion matrices: [[168,0],[0,24]]. Persistence: [[152,16],[16,8]].
Both primary models correctly identify all 16 first failures after a passing
execution and all 16 repairs; persistence identifies zero onsets. Both disagree
with persistence on 32 rows. Both achieve F1 1.0 in each separate holdout campaign,
and PR average precision 1.0. The label-only ablation ALSO detects every onset,
but makes 12 false alerts. Thus warning features improve precision beyond that
stronger label-history comparator; onset recall alone would not prove their value.

Top Random Forest heldout permutation F1 decreases:
  retry_trend .088852, average_duration .036082, stability_score .030157,
  duration_growth_rate .029257, failure_rate .025355, failure_streak .019149,
  duration_trend .016668.
The Decision Tree relies most on retry_trend, MTBF (including missingness),
retry_rate and stability_score. The generator always introduces planned retry
warnings before failures: models can learn this designed temporal position.
Duration and retry signals add information, but perfect scores must NOT be
presented as evidence of predicting unplanned/natural regressions. Label-history
learning is still strong, and the same generator is shared by training/holdout.

A measured onset example (Random Forest): PROG-001, prediction_time
2026-10-19T14:27:10.539Z, history_end_time 2026-10-19T14:27:02.362Z,
previous_failed=0, actual_failed=1, predicted_failed=1, probability=.919438.
Full row-level evidence, probabilities and PR arrays are in evaluation-report.json.
No settings were adjusted after inspecting these holdout scores.

Ordinary model remains NOT_TRAINED because its training data contain no failures.
Fixed-fault controlled models still show zero F1 gain over persistence. The positive
progression comparison is narrow controlled evidence, not a general ML efficacy
claim. More independent episodes, different warning-to-failure relationships,
and a fresh final holdout are needed for robust dissertation conclusions.

Validation: 17 dataset-builder checks, 14 Python checks, 2 progression protocol
checks and 111 existing framework unit checks pass (144 total). Browser experiment
failures are intentional observed failures; campaigns are separately VERIFIED.
