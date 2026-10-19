SPRINT 5 — TEST INTELLIGENCE

Purpose
Read validated historical telemetry and produce retrospective, deterministic
prioritization scores and recommendations. No application changes, dependencies,
ML, self-healing, or dashboard. This score is not a failure probability.

Commands (from automation/)
  npm run intelligence
  npm run test:intelligence

Optional input directory (must contain synchronized telemetry JSON and CSV):
  TELEMETRY_DIR=/absolute/path/to/dataset npm run intelligence

Input validation
Uses HistoryStore.validate(): checks the canonical schema, duplicate attempt IDs,
JSON/CSV agreement, and linked artifact existence. Invalid input fails the command
without publishing a new latest pointer. The existing telemetry journal recovery
protocol still applies if a previous telemetry write was interrupted.

Output
  dataset/intelligence/<analysis-id>/intelligence-report.json
  dataset/intelligence/<analysis-id>/test-intelligence.csv
  dataset/intelligence/latest.json

Each run writes a new snapshot. latest.json points to the completed JSON/CSV pair
and contains both file hashes. Reports are ignored by Git. Original telemetry is
never enriched or overwritten by this layer. Historical snapshots remain intact.
Artifact paths are relative to the input dataset directory, not the report folder.
JSON contains full provenance; CSV is a compact projection of those same results.

Selection and identity
- RUN_ERROR events are listed separately, never counted as test executions.
- Ordinary runs: no experiment or fault metadata recorded. Legacy metadata cannot
  prove the absence of injection. This label is not a production reliability claim.
- Verified experiment runs: attempt membership, recipe/version, run identity,
  source versions, manifest row count, and injection confirmation are checked.
- Experimental attempts absent from a VERIFIED campaign are excluded. Healthy
  campaign controls also remain experimental even though emulated=false.
- Invalid campaigns are never used to estimate ordinary reliability.
- No failure label is inferred from expected_failure_type or injected fault_type.
- Per-test identity includes test ID, suite, project, browser, cohort, experiment,
  variant, scenario, and mutation version. groupId is a stable hash of that identity.
- App/test versions and environment fingerprints are retained in JSON. Available
  versions/environments within an identity are aggregated, with no recency weight.
  Compare only appropriate provenance when interpreting historical scores.

Logical executions and denominators
Within one identity, group attempts by run_id, test_id, project_name, browser,
and repeat_index. retry_count is a zero-based attempt index. Sort by that index.
A scored execution requires a contiguous chain starting at zero, every outcome
PASS/FAIL/TIMED_OUT, expected_status=PASS, and retries following failed attempts.
Skipped/interrupted/truncated chains and expected non-pass tests are excluded
from scores, with exclusion counts and all source attempt IDs retained in JSON.
Expected non-pass tests need separate oracle review; this layer does not treat
them as evidence of ordinary reliability. Invalid business inputs rejected by a
passing test remain PASS.

Metrics (N = number of scored logical executions)
  failureRate = executions whose FIRST attempt failed or timed out / N
  stabilityScore = 100 * (1 - failureRate)
  finalFailureRate = executions whose LAST attempt failed or timed out / N
  retryRate = executions with additional attempts / N
  retryCost = sum of duration_ms for additional attempts (milliseconds)
  retryDurationRatio = retryCost / total scored attempt duration
  locatorVolatility = executions with at least one observed LOCATOR_NOT_FOUND
    or LOCATOR_AMBIGUOUS failure / N

locatorVolatility is explicitly a LOCATOR_FAILURE_INCIDENCE_PROXY. Current
telemetry cannot measure actual locator/DOM revision frequency. It is correlated
with failureRate and is a deliberate additional locator-risk weight, not an
independent scientific signal. Metadata describing injected mechanisms is not
used as a substitute for observed outcomes. No automatic locator recovery occurs.
Stability is the inverse of first-attempt failure rate, not an independent risk
input or a statistical flakiness estimate. Recovered executions are also reported.

Risk model: heuristic-v1
  score = 100 * (0.60 * failureRate + 0.25 * retryRate
                 + 0.15 * locatorVolatility)
  LOW: score < 30
  MEDIUM: 30 <= score < 60
  HIGH: score >= 60

Thresholds use the unrounded score; the displayed score has two decimal places.
Weights and thresholds are project policy, not learned or empirically calibrated.
Zero scored executions: metrics/score/level are null, never a fabricated LOW.
Fewer than 10 scored executions: LIMITED_HISTORY. This is an advisory minimum,
not a confidence interval. A LOW score on passing history does not establish
safety or adequate fault coverage. Experimental scores describe fault sensitivity,
not an estimate of ordinary regression likelihood.

Failure analysis and recommendations
Count the observed eight taxonomy classes on scored attempts, retaining failure
phase and classification source. Primary classes are sorted by frequency.
Recommend locator review, unique scoping, actionability diagnosis, assertion
review, state invariant inspection, runtime error investigation, environment
repair, or manual classification as appropriate. Retry and recovered-failure
advice is evidence-driven. Failure counts are per attempt; rates are per logical
execution. Recommendations do not assert a confirmed root cause or execute fixes.

Integration
Run npm run intelligence after ordinary test runs and/or verified campaigns.
Existing Playwright reporters, HTML reports, tests, and telemetry schema remain
unchanged. No frontend or browser server is needed to analyze an existing dataset.
The source telemetry hash, campaign-manifest hash, intelligence-code hash, model
version, source attempt IDs, campaigns, versions, environments, and artifact links
are retained for audit and later comparisons.

Verification
  npm run test:intelligence
  npm run test:telemetry
  npm run test:experiments
  npm run telemetry:validate
  npm run intelligence

Inspect latest.json to locate the completed reports. Check selection exclusions,
cohort, scoredExecutionCount, evidence, and source versions before using scores.
Unit tests include synthetic retries, all failure classes, expected failures,
empty/corrupt data, campaign separation, artifact publication, and CLI execution.
A report-only change does not require rerunning browser tests or generating new
telemetry records. Real retries are currently absent from the supplied history;
retry calculations are verified with synthetic test fixtures.
