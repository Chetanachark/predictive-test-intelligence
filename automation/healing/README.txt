SPRINT 6 — ADAPTIVE SELF-HEALING

Goal
Controlled locator recovery with unchanged business assertions, audit evidence,
and paired baseline evaluation. JavaScript only; no ML, dashboard, dependencies,
application changes, assertion rewriting, or automatic source-code edits.

Architecture
  Page Object action + explicit locator descriptor + trusted healthy reference
    -> original Playwright action
    -> observed failure classifier
    -> only missing/ambiguous locators with reproducible match counts
    -> same-page candidate discovery
    -> ranking + hard identity gates + threshold + runner-up margin
    -> revalidate selected candidate
    -> at most ONE recovery action
    -> unchanged original assertion callback
    -> final Playwright outcome
    -> TelemetryReporter + healingReporter bridge
    -> journaled execution/healing JSON + CSV

Existing 34 application tests keep their default behavior. Healing is opt-in via
healing/fixtures.js and explicit Page Object options. This prevents silently
turning regression failures into passes throughout the framework.

Files
  healingEngine.js       Original action, failure gating, recovery, original oracle
  candidateDiscovery.js  Real Playwright locators and accessible element features
  candidateRanking.js    Hard gates, explainable ranking, conservative selection
  confidenceScore.js     Frozen deterministic heuristic policy, similarity signals
  healingHistory.js      Event validation, summaries, joined history projection
  healingReporter.js     Attachment bridge, final-test success enforcement
  fixtures.js            Opt-in engine and eager per-operation audit attachment
  healing.test.js        Unit/integration checks for safety, schema and storage
  playwright.config.js   Paired baseline/adaptive evaluation projects
  engine.playwright.config.js  Isolated browser checks without the SUT server
  evaluation/registry.js Controlled cases and expected experimental outcomes
  evaluation/evaluation.spec.js  Same healthy oracles in both project modes
  evaluation/metrics.js  Independent outcome audit and measured evaluation metrics
  evaluation/run.js      Durable evaluation manifest and outcome verification
  tests/engine.spec.js   Five locator strategies and refusal/oracle browser checks
                        (separate reports/healing-engine/telemetry dataset)

How to use (from automation/)
  npm run test:healing
  npm run test:healing:browser
  npm run telemetry:migrate
  npm run healing:evaluate -- --repeat 2
  npm run telemetry:validate
  npm run healing:report

Optional isolated dataset:
  TELEMETRY_DIR=/absolute/path/to/dataset npm run healing:evaluate -- --repeat 2

healing:evaluate defaults to two repetitions, supports 1..20, migrates legacy
telemetry with backups, and returns zero ONLY when paired outcomes, injection
confirmation, target identity, source versions, and artifacts verify correctly.
Injected faults remain real failures in Playwright's HTML report and telemetry.
Running Playwright directly for these experiments intentionally returns nonzero.
The wrapper independently audits expected outcomes; it never uses test.fail().
Concurrent evaluations into the same dataset are unsupported: run one campaign
at a time. Framework sources must remain unchanged throughout a campaign.

Opt-in API example (a remembered target must exist before the locator changes):
  import { test, expect } from './healing/fixtures.js'
  const reference = await healing.remember(app.cart.checkoutLink)
  // In evaluation, inject a verified mutation here; in a session, reuse the
  // trusted reference only for the same unchanged page URL.
  await app.cart.openCheckout({
    healing, reference,
    validate: async () => {
      await expect(app.checkout.heading).toBeVisible()
      // Keep the rest of the original business assertions in this callback
      // or in the test. A later final-test failure revokes healing success.
    },
  })

CartPage.openCheckout and CheckoutPage.applyCoupon/submit accept these optional
arguments. Without healing they run exactly the original action. Engine.perform
also supports fill with a supplied value; values are never stored in audit data.
Every healed action requires an explicit original-assertion callback. The engine
cannot prove that a researcher supplied a sufficiently strong business oracle;
that remains part of experiment and test review.

Reference scope
remember() waits for one visible healthy element, then captures role/name via
Playwright ariaSnapshot, stable attributes, text/labels, and ancestor/heading
context. A reference is scoped to the same page URL and test session. If no
trusted reference exists when the locator breaks, refuse recovery. This sprint
does not auto-learn references across app versions or deploy healed locators.
A disappearing element can reflect a real application defect; observed locator
symptoms and confidence alone never establish the root cause.

Discovery
Supports getByRole, getByLabel, getByText, getByTestId (data-testid), aria-label,
and a deterministic lexical/synonym similarity heuristic. Discovery inspects
visible same-role candidates, also requiring the original tag. All applicable
semantic descriptors are logged in discoveredBy. Candidate nodes are deduplicated
by their role-pool enumeration rather than counted repeatedly for each strategy.
No XPath, nth()/first() recovery, forced action, synthetic DOM IDs, or DOM writes.
Only the experiment injector mutates the page.

Confidence and selection: semantic-v1
  role match              0.20
  accessible name match   0.25
  text/label similarity   0.15
  attribute similarity    0.25
  DOM context similarity  0.15

Unavailable attribute/context signals are excluded and remaining weights are
renormalized. Empty text/name comparisons provide zero similarity. Scores are
bounded [0,1], logged with each factor, and are NOT calibrated probabilities.
The small frozen synonym dictionary (purchase/checkout, basket/cart, etc.) is
explicitly heuristic semantic similarity; no embeddings, model or ML is involved.

Hard gates: unique supported descriptor, matching role/tag, at least one stable
attribute/test ID/label anchor, and no conflicting href, input name, or type.
Threshold >= 0.82; lead over any plausible competitor >= 0.12. If either fails,
refuse. Identical duplicated nodes remain in the candidate pool and force refusal.
Distinct duplicate links can recover via unchanged href plus semantic locator.
The selected features and uniqueness are rechecked immediately before action.
One recovery action only, then the original oracle; never try another candidate
after any action or assertion failure. This avoids repeated side effects.

Budgets
Original and recovery click/fill each use a 700 ms research action budget.
Discovery inspects at most 80 same-role nodes with a cooperative 4 s time budget,
checked between reads and before candidate selection/action. Feature reads and
ARIA snapshots have bounded timeouts. Original assertion validation uses the
existing Playwright test/expect deadlines. These are explicit experimental policy
settings in confidenceScore.js, not production timing recommendations.

Safety
Heal only observed LOCATOR_NOT_FOUND or LOCATOR_AMBIGUOUS action failures, with
current match counts confirming that symptom. Assertions execute outside the
locator recovery catch. Arithmetic, coupon, inventory, state, runtime, setup,
unknown, and actionability failures never receive business-oracle relaxation.
The final test must PASS before healing_successful can remain true. Recovery
that passes locally but has a later test failure is revoked by healingReporter.
Independent controlled evaluation also checks the exact clicked target identity.
It is never passed to the ranking engine, nor are injected expected labels.

Telemetry v3
Adds the requested fields:
  healing_attempted, healing_successful, original_locator, candidate_locator,
  candidate_count, confidence_score, healing_duration_ms, healing_reason.
Also adds healing_mode (NONE/BASELINE/ADAPTIVE), original_failure_type, and
healing_events (full per-operation signals, candidates, reference, timing, oracle).
Summary locator/confidence/count/reason describe the last attempted healing
operation (or last original operation if none); duration sums all recovery paths.
A successful recovered test remains status=PASS and failure_type=null while its
original locator failure is retained separately. This prevents confusing the
initial failure with the final test outcome.

The immutable v1 and v2 schemas remain readable. Migration to v3 backs up original
JSON/CSV, preserves every old field and identity except schema_version, and adds
NONE/false/empty defaults. Defaults mean healing was not recorded, not evidence
that an old run used any particular healing policy. Existing experiment source
versions and original observations remain unchanged. New writes require v3.

Artifacts and durable storage
  dataset/execution-history.json / test-history.csv  Canonical v3 test attempts
  dataset/healing-history.json / healing-history.csv Per-operation joined dataset
  dataset/healing-evaluations/<id>/evaluation.json    Audit manifest and metrics
  dataset/healing-evaluations/latest.json             Latest VERIFIED evaluation
  dataset/artifacts/<run>/<attempt>/                 Durable traces/screenshots

The main HistoryStore publishes all four history outputs under the existing
process lock and one write-ahead journal. A crash resumes the whole projection;
there is no independent reporter racing a second dataset writer. Healing rows
join by run_id, attempt_id and operation_id. Repeated publication is idempotent.
Unexpected projection corruption is rejected; no silent repair/record deletion.
Raw candidate/reference/error evidence remains in JSON and quoted CSV cells.
Raw histories also retain INVALID evaluation rows. Select the attempt_ids from
a VERIFIED evaluation manifest before calculating research metrics.
Eager immutable attachment snapshots preserve intermediate evidence if later
validation times out. The reporter consumes the last published snapshot.
The final reporter reconciles successful events against the final test status.

Intelligence integration
Ordinary summaries now group by healingMode so recovered passes are not pooled
with no-healing observations. Sprint 6 experimental rows have S6 experiment IDs
and separate evaluation manifests; the existing Sprint 5 report intentionally
excludes them from its verified Sprint 4 campaign cohort. Use the dedicated
healing evaluation report for Sprint 6 metrics. Do not compare healed pass rates
against ordinary no-healing reliability without examining original failures.

Controlled evaluation (11 scenarios x 2 modes x repetitions)
  Healthy checkout
  Accessible-name rename: expected recovery
  Identical duplicate: expected conservative refusal
  Distinct duplicate with wrong href: expected recovery to the original target
  Coupon percentage defect, stock defect, cart-clearing defect, total defect
  Delayed rendering, hidden control, disabled control

Each browser context starts fresh; faults are reversible browser/module-response
mutations, never frontend source edits. Same original oracle in both modes.
Both modes retain traces and screenshots, including successful recoveries.
No registration, backend, app feature, dashboard or machine learning was added.

Evaluation metrics and denominators
  healing_success_rate = final-test verified recoveries / healing attempts
    Includes safe refusals in the denominator; not just selected candidates.
  wrong_recovery_rate = completed recovery actions on the wrong independent
    clicked-element identity / completed recovery actions
  masked_defect_rate = adaptive business-defect cases incorrectly passing the
    original oracle / evaluated adaptive business-defect cases
  healing_overhead.meanRecoveryPathMs = mean recovery duration among attempts,
    including discovery, ranking, selected action, and original oracle validation
  meanPairedOperationDeltaMs = mean adaptive minus baseline operation durations
    matched by test ID/repetition; includes workflow continuation after recovery.

Null rates mean no denominator. These are observed finite-sample results, not
validated production accuracy or generalization claims. Four business defects
cannot establish universal absence of masking. Fixed baseline-then-adaptive
project order means timing deltas are descriptive, not causal performance proof.
No learned policy update is performed; this sprint creates auditable evidence for
later research. Check status=VERIFIED before using any evaluation in a paper.

Primary API references
https://playwright.dev/docs/locators
https://playwright.dev/docs/api/class-locator#locator-aria-snapshot
