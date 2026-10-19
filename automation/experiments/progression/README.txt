Sprint 7.5: temporal progression protocol v1

Execute from project root, in this order:
  node --test automation/experiments/progression/progression.test.js
  node automation/experiments/progression/run.js 103
  node automation/experiments/progression/run.js 211
  node automation/experiments/progression/run.js 307
  node automation/experiments/progression/run.js 419
  node automation/experiments/progression/run.js 521
  node automation/experiments/progression/run.js 631

Use one campaign at a time, a local Vite server and installed Chromium. Each seed
runs 26 ordered observations of four stable Playwright test IDs with one retry.
The first four campaigns train; the final two form the later temporal holdout
with the default 20% ceiling split. Seeds and plans are predeclared in protocol.js.
Do not tune the schedule/model after examining those holdout outcomes. For future
research, preregister new seeds/protocol versions and reserve a fresh final set.

Each isolated browser context logs into the actual SUT, adds a Laptop, and opens
the cart. Browser DOM/timer perturbations emulate progressive degradation:
healthy -> transient failure recovered by actual Playwright retry -> warning ->
critical -> failure -> failure -> repair. The later cycle includes an aborted
warning and a single final failure. Warmup lengths and timer jitter vary by seed
and family. One slow healthy observation is a negative control. State perturbation
changes rendered totals only; underlying business logic and source files stay
unchanged. It is a display-state consistency experiment, not a backend defect.

No outcome, duration, retry or healing result is fabricated. Playwright observes
original action/assertion results; TelemetryReporter records the actual attempts.
The existing HealingEngine handles locator recovery and refuses ambiguous unsafe
recovery. Hidden controls use includeHidden so they resolve and fail actionability
rather than silently becoming missing role locators. Transient locator removal
is retried, not healed without safe candidates. State oracles are never healed.
No knowledge-base feedback is applied during experiments.

FaultController records injection evidence and notes with seed/phase/step solely
for audit. These fields are NEVER ML predictors. A campaign is VERIFIED only if
all 104 observations, retry sequences, fault evidence, failure classes, times and
source versions match the protocol. Failed setup/invalid campaigns remain stored
but are excluded by the dataset builder; do not delete adverse evidence.

Each campaign gets dataset/progression-campaigns/<UUID>/campaign.json, paired with
canonical telemetry JSON/CSV, run manifests, traces and screenshots. Later builds
isolate each episode's historical window and preserve whole campaigns as blocks.
Current planned stage and next fault severity must never be passed to the model.

These are designed, emulated temporal stimuli. Good performance on later seeds
of this same generator is controlled evidence only; it does not establish natural
regression prediction or unseen failure-family generalization. Outcomes still
follow a designed schedule. Report persistence, label-history-only ablation,
warning-signals-only ablation and failure-onset recall rather than just accuracy.
