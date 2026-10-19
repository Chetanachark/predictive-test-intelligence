SCHEMA UPDATE: Sprint 4 adds telemetry schema v2. Run npm run telemetry:migrate before ordinary E2E writes to legacy history; the experiment runner migrates automatically. See experiments/README.md and telemetry/record.schema.json for the current experiment fields. The Sprint 3 guide below documents the original foundation.

SPRINT 3 — DATASET FOUNDATION AND TELEMETRY

Scope
Automatic, durable per-attempt Playwright telemetry. No ML, risk scoring, recommendation engine,
self-healing, dashboard, backend services, or application feature changes are implemented.
No new dependencies are required. Existing E2E specs and page objects are unchanged.

FILES / INTEGRATION
New automation/telemetry/ files:
  taxonomy.js                 frozen failure taxonomy and conservative symptom classifier
  schema.js                   canonical schema and runtime/cross-field validation
  record.schema.json          exported JSON Schema, synchronized with schema.js by a unit test
  metadata.js                 run IDs, source fingerprints, stable test IDs, experiment metadata
  history.js                  locked historical append, CSV projection, journal recovery
  TelemetryReporter.js        reporter lifecycle instrumentation and artifact archival
  validate-history.js         validation/recovery command
  telemetry.test.js           dependency-free Node tests
New dataset/.gitignore: excludes generated history, run metadata, and artifacts from Git.
Modified automation/playwright.config.js: adds the reporter beside existing list and HTML reporters.
Modified automation/fixtures/test.js: an automatic fixture captures uncaught page runtime errors.
Modified automation/package.json: adds test:telemetry and telemetry:validate commands.

FROZEN FAILURE TAXONOMY V1
LOCATOR_NOT_FOUND             Required locator failed to resolve within its action timeout.
LOCATOR_AMBIGUOUS             Multiple elements matched a locator requiring one element.
ACTIONABILITY_FAILURE        Target was found but could not be acted on (disabled, hidden, covered, etc.).
ASSERTION_MISMATCH           Actual observable result differs from the test expectation.
STATE_CONSISTENCY_FAILURE    Verified inconsistency across related application state/postconditions.
APPLICATION_RUNTIME_ERROR   Runtime error observed in the failing test or its page.
SETUP_ENVIRONMENT_FAILURE    Hook, fixture, runner, or execution-environment failure.
UNKNOWN                     Evidence is insufficient for a supported classification.

The names above are frozen for schema version 1; changes require a versioned migration.
They describe observed failure categories, not automatically verified root causes.
classification_source is NONE, HEURISTIC, ANNOTATION, or UNKNOWN.
Generic timeouts are UNKNOWN unless additional evidence supports a category.
An assertion timeout remains ASSERTION_MISMATCH; it is not automatically a missing locator.
STATE_CONSISTENCY_FAILURE requires an explicit failure_type annotation; it cannot be safely
inferred from arbitrary failed assertions. An annotation is supplied evidence, not proof.
Setup/teardown failures carry their phase and are separated from business assertions.

STATUS VS FAILURE TYPE
PASS          -> failure_type=null
SKIPPED       -> failure_type=null
FAIL          -> one frozen failure type
TIMED_OUT     -> one frozen failure type
INTERRUPTED   -> one frozen failure type, UNKNOWN when evidence is insufficient

Invalid coupon correctly rejected is PASS, not a failure training example.
An action-level TimeoutError normally maps to Playwright failed -> FAIL.
TIMED_OUT is reserved for Playwright's test-result status timedOut.
Expected-to-fail tests retain actual status plus expected_status; do not collapse these fields.
Retries retain the failed initial attempt even if a later attempt passes.

CANONICAL SCHEMA
Every field in record.schema.json is required, including nullable paths and empty experiment fields.
The user-requested fields are all present:
run_id, attempt_id, test_id, test_name, suite_name, browser, status, failure_type, duration_ms,
retry_count, start_time, end_time, app_version, test_version, trace_path, screenshot_path, notes.
Additional required provenance fields:
schema_version, record_type, framework_version, playwright_version, timestamp, environment,
locator_mutation, fault_variant, experiment_id, scenario_variant, expected_status,
classification_source, failure_phase, error_message, error_stack, runtime_errors,
project_name, worker_index, repeat_index.

run_id and attempt_id are UUID v4 strings. A new run_id is created per runner invocation.
Each retry has a unique attempt_id and the same logical test_id.
retry_count is the zero-based attempt retry index: initial=0, first retry=1.
The explicit ID at the beginning of each existing test title is stable across description changes.
Duplicate explicit IDs for different tests are rejected. Unnumbered tests use a deterministic
file/describe/title hash; moving or renaming those tests changes their fallback ID.
Browser is the configured engine (for example chromium); project_name is recorded separately.
All timestamps are UTC ISO strings. timestamp is the run creation time; start_time/end_time are
attempt times. end_time is start_time plus Playwright's measured duration_ms.
app_version and test_version include package version and source-content SHA-256 fingerprints.
framework_version and playwright_version are recorded separately.
Environment includes Node version, OS/platform, architecture, host, CI flag, worker count, and Git commit.
Source hashes identify the standard application/framework sources, including uncommitted changes;
they do not replace storing the source revision for reproducible experiments.

TEST_ATTEMPT rows represent actual test attempts. RUN_ERROR rows represent reporter onError events
outside a test, using test_id=__RUN__, browser=runner, and failure_phase=run. Exclude these rows from
per-test modeling; do not invent failed attempts for tests that never started.
Errors occurring before Playwright can load a reporter cannot be captured by that reporter.
A force-killed process cannot emit final events; completed rows survive and its run manifest can remain RUNNING.

HISTORICAL STORAGE
Default directory: project-root/dataset (independent of the command's working directory).
Outputs:
  execution-history.json                 canonical JSON array
  test-history.csv                       deterministic RFC-style CSV projection
  runs/<run_id>/run.json                 run metadata and completion manifest
  artifacts/<run_id>/<attempt_id>/       durable copies of trace.zip and screenshot.png

History appends logically: previous rows are preserved, and the array is atomically replaced.
The CSV includes all schema columns in a fixed order. Objects/arrays are JSON-encoded cells;
null becomes an empty cell; commas, quotes, and newlines are quoted and escaped correctly.

A local inter-process lock serializes writers. Each completed attempt is validated before writing.
A write-ahead journal records the intended complete snapshot; each output is replaced atomically.
If publication is interrupted, the next append/validation replays the journal and repairs both files.
There is no portable simultaneous atomic rename of two independent files. Consumers needing a
consistent snapshot should use HistoryStore.validate(), which takes the same lock and recovers first.
Unexplained corruption without a journal is rejected, never silently replaced by empty history.
Duplicate delivery of an identical attempt is idempotent; conflicting duplicate IDs are rejected.
Storage/validation errors explicitly fail the runner rather than being swallowed by Playwright.

If a process crashes while holding .history-lock, confirm no writer is active before removing
that lock directory. Automatic stale-lock stealing is intentionally avoided to prevent writer races.
After releasing a confirmed stale lock, run telemetry:validate to recover any pending publication.
The JSON/CSV strategy is intended for this project's initial local dataset scale, not large distributed storage.

ARTIFACTS
Existing HTML reports, screenshots, and traces remain configured as before.
The reporter additionally archives the first standard screenshot and trace attachment per attempt,
so later Playwright cleanup cannot erase the telemetry-linked copy.
trace_path and screenshot_path are relative to the telemetry dataset directory, not the reports directory.
Paths are null when Playwright generated no such artifact (normal for passing/skipped tests).
Runtime page errors are retained in runtime_errors; observing one does not turn a passing test into FAIL.
Classification records evidence and uncertainty rather than silently changing Playwright outcomes.

EXPERIMENT METADATA (NO HEALING OR FAULT ENGINE)
Optional run-level environment variables:
  LOCATOR_MUTATION
  FAULT_VARIANT
  EXPERIMENT_ID
  SCENARIO_VARIANT
These default to empty strings and can be overridden by matching test annotations.
Future tests may supply annotations without changing the reporter, for example:

  test('EXPERIMENT-001 locator change', {
    annotation: [
      { type: 'experiment_id', description: 'study-001' },
      { type: 'fault_variant', description: 'accessible-name-change' },
      { type: 'locator_mutation', description: 'button-name' },
      { type: 'scenario_variant', description: 'checkout' },
    ],
  }, async ({ page }) => { /* future experiment actions */ })

Optional annotations failure_type and telemetry_note supply a verified category and notes.
Current tests need no annotations or manual modification. Metadata alone does not inject faults.

COMMANDS (FROM automation/)
  npm run test:telemetry
  npm test
  npm run telemetry:validate
  npm run report

Run again and validate to confirm append behavior:
  npm test
  npm run telemetry:validate

Optional separate experiment dataset:
  TELEMETRY_DIR=/absolute/path/to/study EXPERIMENT_ID=study-001 npm test
  TELEMETRY_DIR=/absolute/path/to/study npm run telemetry:validate

Use a separate directory/experiment_id for deliberate failure campaigns to avoid mixing them
unlabeled with the normal baseline. All paths in its records resolve relative to that directory.
No package installation is needed beyond Sprint 2's existing dependencies.

COMPLETED VERIFICATION
- 26 Node telemetry tests passed: mandatory fields, type/status validation, all taxonomy categories,
  business validation PASS, explicit stable IDs, CSV round-trip escaping, append, duplicate handling,
  interrupted-publication recovery, corruption rejection, concurrent writers, retries, artifacts,
  runtime-error evidence, run-level errors, and explicit failure on telemetry errors.
- Two normal Chromium runs passed all 34 E2E tests each (9.4 seconds each).
- Main dataset contains 68 rows, two run IDs, 34 stable test IDs, and 68 distinct attempt IDs.
- JSON and CSV synchronization and artifact existence validation passed.
- Controlled browser probes used a separate dataset under reports/telemetry-probe-dataset:
  invalid coupon rejected=PASS; unresolved locator=FAIL then retry PASS;
  assertion mismatch=FAIL; uncaught page runtime error=FAIL.
- Real PNG screenshots and Playwright ZIP trace contents were verified.
- Durable artifact links still resolved after the probe's original Playwright output was deleted.
- No original E2E spec, page object, frontend, or backend source was modified.

Complete example JSON/CSV files are under dataset/examples/. They contain real representative
records copied from the normal run and the explicitly labeled verification run. They are examples,
not additional rows appended to the main baseline. Example failure artifacts are archived beneath
that directory so its relative links resolve.

API references:
https://playwright.dev/docs/api/class-reporter
https://playwright.dev/docs/api/class-testresult
