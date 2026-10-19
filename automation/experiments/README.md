# Sprint 4 — Controlled Failure Framework

This suite generates **emulated, reproducible failures** for research. It does not implement risk scoring, recommendations, self-healing, ML, or a dashboard. It adds no application features or package dependencies.

## Architecture and files

```text
experiments/
├── baseline/baseline.spec.js
├── locator-mutation/locator.spec.js
├── assertion-mutation/assertion.spec.js
├── state-mutation/state.spec.js
├── timeout-mutation/actionability.spec.js
├── registry.js
├── injector.js
├── fixtures.js
├── campaign.js
├── run.js
├── inspect.js
├── experiment.test.js
├── playwright.config.js
└── README.md
```

- `registry.js` defines immutable major-version experiment IDs, patch-version mutation recipes, expected observation types, and exact source anchors.
- `injector.js` applies one fault per isolated page and records evidence. Missing or duplicated source anchors fail closed.
- `fixtures.js` extends the existing POM fixture. Every attempt gets a fresh browser context.
- `campaign.js` audits **observed** telemetry against the independently specified experiment protocol.
- `run.js` orchestrates a campaign, retains a manifest, and verifies source fingerprints before/after execution.
- `inspect.js` queries historical data and can restrict analysis to verified campaigns.

Normal `npm test` continues to run the original 34 E2E tests. Experiments have their own config, HTML report, and Playwright result directory. Both append to the existing historical dataset unless `TELEMETRY_DIR` selects another location.

## Versioned mutation matrix

All released recipes in this implementation use mutation version **1.0.1**, with stable major-version IDs ending in `-v1`. Preserve released recipes; add a new version instead of silently changing their meaning. The source fingerprint records the exact framework and experiment code.

| Experiment | Controlled change | Observed failure required |
|---|---|---|
| S4-LOC-001-v1 | Rename the actual checkout link's accessible text | LOCATOR_NOT_FOUND |
| S4-LOC-002-v1 | Clone the actual checkout link | LOCATOR_AMBIGUOUS |
| S4-ASSERT-001-v1 | SAVE10 rate becomes 5% instead of 10% | ASSERTION_MISMATCH |
| S4-STATE-001-v1 | Completed order leaves stock unchanged | STATE_CONSISTENCY_FAILURE |
| S4-STATE-002-v1 | Completed order leaves cart unchanged | STATE_CONSISTENCY_FAILURE |
| S4-STATE-003-v1 | Persisted order total has an extra INR 1,000 | STATE_CONSISTENCY_FAILURE |
| S4-ACTION-001-v1 | Submit control is not rendered for 30 seconds | ACTIONABILITY_FAILURE |
| S4-ACTION-002-v1 | Submit control remains hidden | ACTIONABILITY_FAILURE |
| S4-ACTION-003-v1 | Submit control is disabled | ACTIONABILITY_FAILURE |

Six healthy controls cover checkout navigation, SAVE10 calculation, stock reduction, cart clearing, order totals, and submit actionability. `scenario_variant` links a control to its corresponding fault scenario.

The application uses accessible role/name locators, not a `checkout-btn` ID. Therefore, changing an unused ID would not be a valid locator-failure experiment. The locator cases mutate the real accessible name or matching cardinality.

## Reversibility and business-defect injection

No frontend file is edited. Locator/actionability experiments change only the isolated browser DOM. Coupon and state experiments intercept the Vite response for `/src/context/shopState.js` and patch its JavaScript in that browser, before module execution. This changes actual business calculations/state transitions rather than merely falsifying displayed text or changing the expected test result.

Patches accept the documented raw/Vite-normalized forms and require exactly one anchor. Evidence records original/mutated module SHA-256 hashes, anchor, replacement, version, and the observed consequence. Patch behavior is also tested directly against the business module in Node.

Browser-context closure discards DOM mutations, routes, timers, module instances, and React state. Faults remain present until screenshots/traces are captured. Subsequent healthy tests verify isolation. The runner also rejects a campaign if application/framework source fingerprints change during execution.

For hidden/delayed controls, an explicit role locator with `includeHidden: true` isolates **actionability** from role-locator visibility filtering. A normal role locator may instead report an unresolved locator for a hidden element. The delayed control remains in the DOM but is not rendered until after 30 seconds; its click budget is 500 ms. This tests delayed visibility, not a new asynchronous business feature. No arbitrary sleep is added to the tests.

## Telemetry schema v2

Existing required fields and the frozen eight-category failure taxonomy are retained. New required fields:

| Field | Type | Meaning |
|---|---|---|
| fault_type | string | Injected mechanism, such as COUPON_RATE_DEFECT or HIDDEN_CONTROL |
| emulated | boolean | Whether an emulated mutation is configured |
| injected_at | UTC timestamp or null | Time the mutation was applied, not simply scheduled |
| mutation_version | string | Pinned recipe patch version |
| expected_failure_type | category or null | Protocol expectation; never used to overwrite observed failure_type |
| injection_verified | boolean | Whether its actual DOM/business consequence was independently checked |

Existing `experiment_id`, `fault_variant`, `locator_mutation`, and `scenario_variant` fields remain available. Typed annotations override environment defaults. Healthy controls have `emulated=false`, `injected_at=null`, `injection_verified=false`, and no expected failure type.

The reporter's classification is independent of the injected mechanism. State inconsistency is explicitly researcher-labeled **only after a verified mutation causes the selected original state invariant assertion to fail**. Other failures use normal telemetry classification. Incorrect input rejected as expected remains PASS.

Schema migration creates byte-for-byte v1 JSON/CSV backups under `dataset/migrations/<id>/`, preserves all original values except the schema-version marker, adds defaults, and atomically republishes synchronized v2 history through the existing journal. It is idempotent. Migration cannot retrospectively establish missing fault provenance: legacy `emulated=false` is a backfilled default, not proof of a naturally occurring execution. The original backups and revision metadata remain available.

## Execution commands

Run from `automation/`:

```bash
npm run telemetry:migrate
npm run test:telemetry
npm run test:experiments
npm run experiments:list
npm run experiments
npm run telemetry:validate
npm run experiments:report
```

The campaign runner performs migration automatically if needed. No additional npm package installation is required.

Select one fault family (healthy controls are still included):

```bash
npm run experiments -- --group locator-mutation
npm run experiments -- --group assertion-mutation
npm run experiments -- --group state-mutation
npm run experiments -- --group timeout-mutation
npm run experiments -- --group baseline
```

Repeat each case with fresh state:

```bash
npm run experiments -- --repeat 2
```

For a separate study directory:

```bash
TELEMETRY_DIR=/absolute/path/to/study npm run experiments
TELEMETRY_DIR=/absolute/path/to/study npm run experiments:inspect -- --latest-campaign
```

Only point this suite at this project's Vite development SUT. Response-mutation cases intentionally reject a build/server that does not expose the expected module. No backend is used.

## Interpreting results

A full single-repetition campaign should record:

| Observation | Count |
|---|---:|
| Healthy PASS | 6 |
| Injected FAIL | 9 |
| LOCATOR_NOT_FOUND | 1 |
| LOCATOR_AMBIGUOUS | 1 |
| ASSERTION_MISMATCH | 1 |
| STATE_CONSISTENCY_FAILURE | 3 |
| ACTIONABILITY_FAILURE | 3 |

The underlying Playwright process should exit **1** because healthy oracles detected nine injected defects. Tests are not marked with `test.fail()`, skipped, or caught and converted into PASS. The campaign command exits **0 only when its separate audit confirms exactly the required observations**. This is campaign verification success, not fifteen passing E2E tests.

Missing/unconfirmed injections, surviving mutations, setup failures, wrong categories, unexpected attempts, missing artifacts, retries, and unexpected process termination invalidate the campaign. Raw rows remain in history; the immutable campaign manifest records INVALID. Such rows must not be quietly relabeled or included as successful fault experiments.

Manifests live under `dataset/campaigns/<campaign_id>/campaign.json`. `latest.json` points to the most recent verified campaign. Use the verified-campaign queries below instead of treating every historical development attempt as an accepted research observation. The initial development campaign was rejected because two Vite source anchors did not match and button CSS overrode `hidden`; those records and its INVALID manifest were retained. Recipe 1.0.1 corrects these mechanics.

## Validation and dataset inspection

```bash
# Full history: schema, CSV synchronization and artifact existence
npm run telemetry:validate

# Most recent verified campaign
npm run experiments:inspect -- --latest-campaign

# Accepted observations across all verified campaigns only
npm run experiments:inspect -- --verified-campaigns

# Further filters can be combined
npm run experiments:inspect -- --verified-campaigns --status FAIL
npm run experiments:inspect -- --verified-campaigns --failure-type LOCATOR_AMBIGUOUS
npm run experiments:inspect -- --experiment S4-STATE-001-v1
npm run experiments:inspect -- --run-id RUN_UUID

# Confirm the unmodified application still passes after fault execution
npm test
```

Check expected counts, one attempt per case/repetition, independent observed failure types, `injection_verified=true` for injected faults, and archived screenshots/traces. The normal report is under `reports/html`; the separate experiment report is under `reports/experiments/html`.

Reproducibility means the same versioned fault produces the same specified observation from a fresh state. UUIDs, order numbers, timestamps, and execution durations naturally differ.

## Research limits

These are controlled emulations in one SUT, not evidence of production failure prevalence or generalization. Repeating the same mutation does not create independent fault mechanisms. Retain raw evidence, exclude invalid campaigns, and group repeated variants appropriately in any later evaluation. Expected fault types, injected mechanism, experiment identity, injection verification, and other post-execution labels must not leak into a future pre-execution predictor.

No risk engine, recommendations, healing, or ML is included in this sprint.
