SPRINT 6.5 — HISTORICAL LEARNING FOR LOCATOR RECOVERY

Scope
Adds durable successful/failed recovery observations and history-aware ranking.
No machine learning, application changes, business-logic changes, dependencies,
or modifications to the original 34 E2E test files. Existing safety gates remain.

Files and outputs
  automation/healing/knowledgeBase.js       Validated, locked, atomic JSON store
  automation/healing/adaptiveRanking.js     Semantic + historical ranking
  automation/healing/feedbackLoop.js        Final-result feedback and replay
  automation/healing/adaptive.test.js       Learning, storage and integration tests
  automation/healing/learning-evaluation/   Teacher/held-out experiments and reports
  dataset/knowledge-base.json               Reusable, scoped historical evidence
  dataset/adaptive-evaluations/<id>/        Frozen knowledge and comparison outputs

Commands (from automation/)
  npm run test:adaptive
  npm run telemetry:migrate
  npm run healing:compare -- --repeat 2
  npm run healing:feedback
  npm run telemetry:validate

healing:compare always collects two positive and two negative teacher outcomes.
--repeat controls held-out repetitions (1..20, default 2). A new, initially empty
knowledge base is created per comparison. It is populated only after teaching
runs pass their independent audit, then frozen throughout both held-out arms.
Root knowledge is updated only with those audited teacher outcomes after a
VERIFIED comparison; held-out observations never enter the reusable knowledge
base. Run one comparison at a time into a dataset. Other experiment runners
must also be idle, and sources must remain unchanged throughout the comparison.

Optional isolated dataset:
  TELEMETRY_DIR=/absolute/path/to/dataset npm run healing:compare -- --repeat 2

Reports
  dataset/adaptive-evaluations/<id>/comparison.json
  dataset/adaptive-evaluations/<id>/comparison.html
  dataset/adaptive-evaluations/<id>/knowledge-base.json
  dataset/adaptive-evaluations/latest.json

Only latest VERIFIED comparisons are published to latest.json. Invalid raw
executions remain in canonical telemetry for audit. Use the manifest's heldout
attempt IDs for comparison metrics; do not pool teaching runs or invalid runs.
The comparison command verifies statuses, positive/negative teaching evidence,
independent clicked-element identities, artifacts, source versions, knowledge
snapshot hashes, and frozen knowledge bytes. Real injected failures remain FAIL
in Playwright HTML/telemetry. The wrapper returns zero for a verified experiment;
it never suppresses errors with test.fail() or changes original assertions.

Definitions
Sprint 6 retained healing_mode=BASELINE for NO healing and ADAPTIVE for semantic
healing. These legacy meanings are preserved. Sprint 6.5 compares two arms that
BOTH use healing_mode=ADAPTIVE:
  baseline-healing: learningEnabled=false, original semantic ranking
  adaptive-healing: learningEnabled=true, semantic + historical ranking

Opt-in usage
Import the existing healing/fixtures.js fixture and enable:
  test.use({ learningEnabled: true })
Use the existing remember()/Page Object healing options and original assertion
callback. Unknown/stale references still refuse. learningEnabled defaults to
false so existing tests retain their behavior. No automatic source-locator edits.
HEALING_KNOWLEDGE_BASE optionally selects a knowledge JSON file. By default it is
inside TELEMETRY_DIR or the project dataset directory. HEALING_FEEDBACK=off
suppresses ordinary automatic feedback during controlled/frozen evaluations.

Knowledge entry
Key = canonical hash of scope + original locator + candidate locator.
Scope includes exact app_version, browser engine, page URL, action, semantic
policy version, and the original reference fingerprint (role/name/text/labels,
attributes and DOM context). Canonical sorted object keys avoid property-order
misses. Different app versions, origins/paths, browser engines, actions or
reference context do not share observations. test_version is retained in each
observation, not used as a key, allowing framework-only revisions to use evidence
under the same explicit semantic policy. Change the policy version if its safety
meaning changes. Exact scope matching is intentionally conservative and may
limit generalization across dynamic page content.

Each entry stores:
  originalLocator, candidateLocator
  attempts, successfulRecoveries, failedRecoveries
  observations: operationId, attemptId, runId, successful, endTime, testVersion,
                source (ordinary or verified-experiment)
Counts are derived/validated against unique observations; attempts=success+fail.
Corrupt data and conflicting duplicate operation IDs are rejected. Identical
replay is a no-op. Updates use a bounded process lock and fsync/atomic rename.
Readers see complete snapshots. Snapshots have canonical SHA256 versions and
immutable data; candidate lookups return copies. Locks are never auto-deleted
as stale: confirm the owner has exited before manual cleanup.

Feedback lifecycle
Worker evidence -> final Playwright test status -> canonical telemetry append
  -> eligible feedback -> atomic knowledge update.
The reporter automatically records eligible ordinary outcomes when learning is
enabled. Experimental observations are excluded unless an evaluation explicitly
audits them. Interrupted/skipped/timed-out results, setup/teardown failures,
expected-failure tests, runtime-error attempts, refusals, and pre-action identity
changes do not teach. A selected recovery action must actually have been
attempted. An incomplete pending action is unknown, not a negative example.
A locally successful recovery followed by a final test failure counts as a failed
end-to-end recovery, never a success. Failures are not proof of a wrong locator:
unrelated later assertions can confound end-to-end feedback. Inspect source
attempts before interpreting historical rate as locator reliability.

Knowledge storage and canonical telemetry are separate atomic publications.
If a process stops after telemetry append but before feedback publication,
healing:feedback replays eligible records idempotently. It includes audited
teacher IDs from VERIFIED manifests and rejects overlap with held-out IDs.
Historical v1/v2/v3 records lack measured learning scope; they are not treated as
training evidence. No synthetic successes or post-hoc guessed scopes are seeded.

Ranking: historical-v1
Keep the existing role/name/text/attribute/context confidence and hard gates.
For an entry:
  historicalSuccessRate = successfulRecoveries / attempts
  smoothed rate = (successfulRecoveries + 1) / (attempts + 2)
Minimum usable evidence: 2 observations per candidate. Smoothing uses explicit
Beta(1,1) pseudocounts and is a deterministic count rule, not a trained ML model.

When at least one eligible candidate has enough evidence:
  final confidence = 0.75 * semantic confidence + 0.25 * smoothed historical rate
Unknown/under-supported candidates use neutral 0.5 in this shared score space.
With no usable history, scores and decisions exactly match semantic healing.

Existing semantic confidence >=0.82 remains mandatory BEFORE history can make a
candidate eligible. Stable anchors, role/tag agreement, destination/type/name
contracts, uniqueness and confidence margin >=0.12 all remain. History never
bypasses an unsafe href, unaddressable duplicates, or weak semantic identity.
At most one recovery action; unchanged original business assertions and final
PASS are still required for successful healing.

Telemetry v4
New required top-level and event fields:
  knowledgeBaseHit       boolean; any discovered candidate matched scoped history
  historicalSuccessRate number [0,1] or null; selected candidate's raw prior rate
  learningEnabled        boolean
Event evidence additionally includes learningScope and knowledgeBaseVersion.
Each candidate logs baseConfidence, historicalAttempts, smoothedHistoricalSuccess,
historyApplied and its final confidence. Unknown rates are null, never fabricated
zero. A hit can occur on an ineligible candidate; safety still takes precedence.

Frozen v1/v2/v3 schemas remain readable. Migration backs up original JSON/CSV,
preserves all prior field values including original healing_events arrays, and
adds false/null learning defaults. Derived healing-history JSON/CSV gain new
columns with defaults for old events. Existing data is not retroactively learned.
The intelligence report groups learningEnabled separately from semantic-only
healing and continues to exclude controlled S6 experiments from ordinary risk.

Evaluation design
Teacher examples (separate browser contexts, four executions):
  good-only: original missing; correct semantic substitute -> original oracle PASS
  bad-only: original missing; plausible same-route decoy -> original oracle FAIL
No expected recovery label is provided to the engine. Feedback uses measured
final status, original assertions and action evidence. Independent clicked-target
identity validates teacher labels. DOM-only decoys and the existing coupon fault
are isolated browser experiments; no application/business source file is edited.

Held-out scenarios, both arms, fresh contexts each time:
  healthy original action
  good-only replacement (both healers can recover)
  both replacements (semantic tie; history may disambiguate)
  identical duplicates (both must refuse)
  changed destination (history must not override the href contract)
  existing coupon-defect control (both must keep the original assertion failure)
The held-out data has new execution/operation identities. UI variants deliberately
overlap teaching to demonstrate memory-based decisions; this is not a claim of
unseen-layout generalization or a representative benchmark. Cold start and stale
scope behavior are covered separately by deterministic unit tests.

Metrics
  healingSuccessRate = final verified recoveries / healing attempts (incl refusals)
  wrongRecoveryRate = completed recovery actions on the wrong independently
    observed target / completed recovery actions
  maskedDefectRate = incorrect PASS on the injected coupon defect / coupon cases
  knowledgeBaseHits and knowledgeBaseHitRateAmongAttempts
  meanHealingDurationMs includes ranking, recovery action and original oracle.
Timing includes successful workflow continuation and fixed project ordering;
it is descriptive, not an isolated computational cost or causal speed claim.
Null rates mean no denominator. Reports separate training and held-out counts,
include exact knowledge/source versions and disclose finite-sample limitations.
