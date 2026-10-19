import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { validateComparison } from './learning-evaluation/metrics.js'
import { KnowledgeBase, KnowledgeSnapshot, emptyKnowledge, canonical, learningScope, validateKnowledge } from './knowledgeBase.js'
import { adaptiveRanking } from './adaptiveRanking.js'
import { rankCandidates, selectCandidate } from './candidateRanking.js'
import { feedbackObservations, applyFeedback, syncFeedback } from './feedbackLoop.js'
import { HEALING_DEFAULTS, LEARNING_EVENT_DEFAULTS, summarizeHealing, healingRows, serializeHealingCSV } from './healingHistory.js'
import { HistoryStore, serializeCSV } from '../telemetry/history.js'
import { V3_SCHEMA, validateRecord } from '../telemetry/schema.js'
import TelemetryReporter from '../telemetry/TelemetryReporter.js'
import { createRunMetadata, experimentMetadata } from '../telemetry/metadata.js'
import { buildIntelligenceReport } from '../intelligence/intelligenceReport.js'

const metadata = createRunMetadata({ workers: 1 })
const reference = { tag: 'a', role: 'link', name: 'Proceed to checkout', text: 'Proceed to checkout', label: '', testId: '', ariaLabel: '',
  attributes: { href: '/checkout', id: '', name: '', type: '' }, context: 'main Your cart', pageURL: 'http://localhost/cart' }
const scope = learningScope({ appVersion: metadata.app_version, browser: 'chromium' }, reference, 'click')
const originalLocator = { strategy: 'role', role: 'link', value: 'Proceed to checkout' }
const good = { strategy: 'role', role: 'link', value: 'Proceed to purchase' }
const bad = { strategy: 'role', role: 'link', value: 'Continue to checkout' }
const candidate = descriptor => ({ descriptor, features: { ...reference, name: descriptor.value, text: descriptor.value }, discoveredBy: ['role', 'semanticSimilarity'] })
const base = () => rankCandidates(reference, [candidate(good), candidate(bad)])
function observation(candidateLocator = good, successful = true, changes = {}) {
  return { scope, originalLocator, candidateLocator, observation: { operationId: randomUUID(), attemptId: randomUUID(), runId: randomUUID(),
    successful, endTime: '2026-10-19T10:00:00.100Z', testVersion: 'tests-v1', source: 'ordinary', ...changes } }
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sut-adaptive-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}
function teaching(knowledge) { knowledge.apply([observation(), observation(), observation(bad, false), observation(bad, false)]); return knowledge.snapshot() }
function learnedEvent(changes = {}) {
  const ranked = base().map(item => ({ ...item, baseConfidence: item.confidence, knowledgeBaseHit: true,
    historicalSuccessRate: item.descriptor.value === good.value ? 1 : 0, historicalAttempts: 2, historyApplied: true,
    confidence: item.descriptor.value === good.value ? 0.9375 : 0.8125 }))
  return { ...LEARNING_EVENT_DEFAULTS, operation_id: randomUUID(), healing_mode: 'ADAPTIVE', healing_attempted: true,
    healing_successful: true, original_locator: JSON.stringify(originalLocator), candidate_locator: JSON.stringify(good),
    candidate_count: 2, confidence_score: 0.9375, healing_duration_ms: 5, healing_reason: 'RECOVERED_AND_ORIGINAL_ASSERTIONS_PASSED',
    original_failure_type: 'LOCATOR_NOT_FOUND', original_error: 'locator.click: no element matches', original_assertions_passed: true,
    action_completed: true, action_duration_ms: 2, total_duration_ms: 7, reference, candidates: ranked, policy_version: 'historical-v1',
    learningEnabled: true, knowledgeBaseHit: true, historicalSuccessRate: 1, learningScope: scope,
    knowledgeBaseVersion: 'a'.repeat(64), ...changes }
}
function record(changes = {}) {
  return { schema_version: 4, record_type: 'TEST_ATTEMPT', ...metadata, run_id: randomUUID(), attempt_id: randomUUID(),
    test_id: 'ADAPT-001', test_name: 'Adaptive recovery', suite_name: 'Adaptive', browser: 'chromium', project_name: 'chromium',
    status: 'PASS', failure_type: null, duration_ms: 100, retry_count: 0, start_time: '2026-10-19T10:00:00.000Z', end_time: '2026-10-19T10:00:00.100Z',
    trace_path: null, screenshot_path: null, notes: '', ...experimentMetadata(), expected_status: 'PASS', classification_source: 'NONE', failure_phase: 'test',
    error_message: '', error_stack: '', runtime_errors: [], worker_index: 0, repeat_index: 0, ...HEALING_DEFAULTS, healing_events: [], ...changes }
}

test('canonical keys ignore object property ordering', () => {
  assert.equal(canonical({ b: 2, a: { z: 1, x: 2 } }), canonical({ a: { x: 2, z: 1 }, b: 2 }))
})

test('knowledge initializes empty and never invents successes', t => {
  const knowledge = new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json'))
  assert.deepEqual(knowledge.initialize().data, emptyKnowledge())
  assert.equal(knowledge.snapshot().lookup(scope, originalLocator, good), null)
})

test('durable feedback counts successes and failures with idempotent replay', t => {
  const knowledge = new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json'))
  const rows = [observation(), observation(good, false)]
  assert.equal(knowledge.apply(rows).added, 2)
  assert.equal(knowledge.apply(rows).added, 0)
  const saved = new KnowledgeBase(knowledge.file).snapshot().lookup(scope, originalLocator, good)
  assert.equal(saved.attempts, 2); assert.equal(saved.successfulRecoveries, 1); assert.equal(saved.failedRecoveries, 1)
})

test('conflicting duplicate observations reject the whole update without rewriting data', t => {
  const knowledge = new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json'))
  const row = observation(); knowledge.apply([row])
  const before = fs.readFileSync(knowledge.file, 'utf8')
  assert.throws(() => knowledge.apply([observation(), { ...row, observation: { ...row.observation, successful: false } }]), /Conflicting/)
  assert.equal(fs.readFileSync(knowledge.file, 'utf8'), before)
})

test('invalid counters and duplicate evidence are rejected', t => {
  const knowledge = new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json'))
  teaching(knowledge)
  const data = JSON.parse(fs.readFileSync(knowledge.file))
  data.entries[0].attempts++
  assert.throws(() => validateKnowledge(data), /counters/)
  fs.writeFileSync(knowledge.file, '{invalid')
  assert.throws(() => knowledge.snapshot())
})

test('history stays scoped to app version, browser, page, action, and reference fingerprint', t => {
  const knowledge = new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json'))
  const snapshot = teaching(knowledge)
  assert.ok(snapshot.lookup(scope, originalLocator, good))
  for (const changes of [{ appVersion: 'different' }, { browser: 'firefox' }, { pageURL: 'http://other/cart' },
    { action: 'fill' }, { referenceFingerprint: 'b'.repeat(64) }]) assert.equal(snapshot.lookup({ ...scope, ...changes }, originalLocator, good), null)
})

test('disabled learning never queries knowledge and preserves heuristic scores', () => {
  const ranked = adaptiveRanking(base(), { learningEnabled: false, snapshot: { lookup: () => assert.fail('Must not read history') } })
  assert.deepEqual(ranked.map(item => item.confidence), [1, 1])
  assert.equal(selectCandidate(ranked).reason, 'INSUFFICIENT_MARGIN')
})

test('cold start reproduces the baseline decision with unknown success rates', () => {
  const ranked = adaptiveRanking(base(), { learningEnabled: true, snapshot: new KnowledgeSnapshot(emptyKnowledge()), scope, originalLocator })
  assert.equal(selectCandidate(ranked).reason, 'INSUFFICIENT_MARGIN')
  assert.ok(ranked.every(item => item.historicalSuccessRate === null && !item.knowledgeBaseHit && !item.historyApplied))
})

test('positive and negative historical evidence resolve a semantic tie', t => {
  const snapshot = teaching(new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json')))
  const ranked = adaptiveRanking(base(), { learningEnabled: true, snapshot, scope, originalLocator })
  const selected = selectCandidate(ranked).candidate
  assert.equal(selected.descriptor.value, good.value)
  assert.equal(selected.confidence, 0.9375)
  assert.equal(selected.historicalSuccessRate, 1)
  assert.equal(ranked[1].confidence, 0.8125)
})

test('one observation per candidate is insufficient to alter the baseline ranking', t => {
  const knowledge = new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json'))
  knowledge.apply([observation(), observation(bad, false)])
  const ranked = adaptiveRanking(base(), { learningEnabled: true, snapshot: knowledge.snapshot(), scope, originalLocator })
  assert.equal(selectCandidate(ranked).reason, 'INSUFFICIENT_MARGIN')
  assert.ok(ranked.every(item => !item.historyApplied))
})

test('later failures reduce historical confidence and can remove acceptance', t => {
  const knowledge = new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json'))
  teaching(knowledge)
  knowledge.apply([observation(good, false), observation(good, false)])
  const ranked = adaptiveRanking(base(), { learningEnabled: true, snapshot: knowledge.snapshot(), scope, originalLocator })
  assert.equal(ranked.find(item => item.descriptor.value === good.value).historicalSuccessRate, 0.5)
  assert.equal(selectCandidate(ranked).reason, 'INSUFFICIENT_MARGIN')
})

test('historical success cannot override a conflicting href or low semantic score', t => {
  const snapshot = teaching(new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json')))
  const conflict = rankCandidates(reference, [{ ...candidate(good), features: { ...candidate(good).features, attributes: { ...reference.attributes, href: '/wrong' } } }])
  assert.equal(selectCandidate(adaptiveRanking(conflict, { learningEnabled: true, snapshot, scope, originalLocator })).candidate, null)
  const low = [{ ...base()[0], descriptor: good, confidence: 0.79 }]
  const ranked = adaptiveRanking(low, { learningEnabled: true, snapshot, scope, originalLocator })
  assert.equal(ranked[0].eligible, false)
  assert.equal(selectCandidate(ranked).candidate, null)
})

test('identical duplicates remain unaddressable even with populated history', t => {
  const snapshot = teaching(new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json')))
  const duplicates = base().map(item => ({ ...item, descriptor: null, eligible: false, reason: 'NO_UNIQUE_LOCATOR' }))
  assert.equal(selectCandidate(adaptiveRanking(duplicates, { learningEnabled: true, snapshot, scope, originalLocator })).candidate, null)
})

test('final-test failure becomes negative feedback and cannot retain a success label', () => {
  const event = learnedEvent({ healing_successful: false, healing_reason: 'FINAL_TEST_DID_NOT_PASS' })
  const row = record({ status: 'FAIL', failure_type: 'ASSERTION_MISMATCH', classification_source: 'HEURISTIC', ...summarizeHealing([event], 'ADAPTIVE') })
  validateRecord(row)
  assert.equal(feedbackObservations([row])[0].observation.successful, false)
})

test('refusals, setup problems, interrupted tests, runtime errors and expected failures do not teach', () => {
  const normal = record(summarizeHealing([learnedEvent()], 'ADAPTIVE'))
  for (const changes of [{ failure_phase: 'setup' }, { status: 'INTERRUPTED' }, { expected_status: 'FAIL' }, { runtime_errors: ['error'] }, { learningEnabled: false }]) {
    assert.deepEqual(feedbackObservations([{ ...normal, ...changes }]), [])
  }
  const refused = learnedEvent({ healing_successful: false, candidate_locator: '', historicalSuccessRate: null, healing_reason: 'NO_SAFE_CANDIDATE', action_completed: false })
  assert.deepEqual(feedbackObservations([record(summarizeHealing([refused], 'ADAPTIVE'))]), [])
})

test('experimental feedback is excluded unless its attempt is explicitly audited', () => {
  const row = record({ ...summarizeHealing([learnedEvent()], 'ADAPTIVE'), experiment_id: 'S6-LEARNING-good-only-v1' })
  assert.deepEqual(feedbackObservations([row]), [])
  assert.equal(feedbackObservations([row], { verifiedAttemptIds: new Set([row.attempt_id]) }).length, 1)
})

test('a feedback scope inconsistent with the finalized telemetry is rejected', () => {
  const row = record(summarizeHealing([learnedEvent({ learningScope: { ...scope, appVersion: 'wrong' } })], 'ADAPTIVE'))
  assert.throws(() => feedbackObservations([row]), /scope/)
})

test('knowledge snapshot remains frozen when later feedback updates the backing file', t => {
  const knowledge = new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json'))
  const snapshot = teaching(knowledge)
  const before = snapshot.lookup(scope, originalLocator, good)
  knowledge.apply([observation(good, false)])
  assert.deepEqual(snapshot.lookup(scope, originalLocator, good), before)
  assert.notEqual(snapshot.version, knowledge.snapshot().version)
})

test('concurrent feedback processes preserve every unique observation', async t => {
  const knowledge = new KnowledgeBase(path.join(temporary(t), 'knowledge-base.json'))
  const url = new URL('./knowledgeBase.js', import.meta.url).href
  const code = `import { KnowledgeBase } from ${JSON.stringify(url)}; new KnowledgeBase(process.argv[1]).apply(JSON.parse(process.argv[2]));`
  await Promise.all(Array.from({ length: 5 }, () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', code, knowledge.file, JSON.stringify([observation()])])))
  assert.equal(knowledge.snapshot().lookup(scope, originalLocator, good).attempts, 5)
})

test('v3 migration adds learning defaults while preserving original healing evidence exactly', t => {
  const directory = temporary(t)
  const current = record()
  const old = Object.fromEntries(V3_SCHEMA.required.map(key => [key, key === 'schema_version' ? 3 : current[key]]))
  // A legacy event has no learning fields and must remain byte-equivalent as data.
  const legacy = learnedEvent({ policy_version: 'semantic-v1' })
  for (const key of Object.keys(LEARNING_EVENT_DEFAULTS)) delete legacy[key]
  old.healing_events = [legacy]
  const legacySummary = summarizeHealing([legacy], 'ADAPTIVE')
  for (const key of V3_SCHEMA.required) if (Object.hasOwn(legacySummary, key)) old[key] = legacySummary[key]
  const store = new HistoryStore(directory)
  fs.writeFileSync(store.json, JSON.stringify([old], null, 2) + '\n'); fs.writeFileSync(store.csv, serializeCSV([old]))
  fs.writeFileSync(path.join(directory, 'healing-history.json'), JSON.stringify(healingRows([old]), null, 2) + '\n')
  fs.writeFileSync(path.join(directory, 'healing-history.csv'), serializeHealingCSV(healingRows([old]), { legacy: true }))
  store.migrate()
  const migrated = store.validate()[0]
  for (const key of Object.keys(old).filter(key => key !== 'schema_version')) assert.deepEqual(migrated[key], old[key], key)
  assert.equal(migrated.learningEnabled, false)
  assert.equal(migrated.historicalSuccessRate, null)
})

test('learning telemetry round-trips in JSON and CSV without pooling ranking policies', t => {
  const directory = temporary(t)
  const store = new HistoryStore(directory)
  store.append(record({ healing_mode: 'ADAPTIVE' }))
  store.append(record(summarizeHealing([learnedEvent()], 'ADAPTIVE')))
  assert.equal(store.validate()[1].historicalSuccessRate, 1)
  const report = buildIntelligenceReport(store.validate())
  assert.equal(report.tests.length, 2)
  assert.deepEqual(report.tests.map(item => item.learningEnabled).sort(), [false, true])
  assert.ok(fs.readFileSync(store.csv, 'utf8').includes('knowledgeBaseHit,historicalSuccessRate,learningEnabled'))
})


test('finalized ordinary test outcomes automatically update knowledge through the reporter', async t => {
  const directory = temporary(t)
  const reporter = new TelemetryReporter({ directory })
  const candidate = { title: 'ADAPT-001 ordinary recovery', annotations: [], expectedStatus: 'passed', repeatEachIndex: 0,
    location: { file: new URL('../tests/checkout.spec.js', import.meta.url).pathname },
    parent: { title: 'Adaptive', type: 'describe', project: () => ({ name: 'chromium', use: { browserName: 'chromium' } }) } }
  reporter.onBegin({ workers: 1 }, { allTests: () => [candidate] })
  const result = { startTime: new Date('2026-10-19T10:00:00.000Z'), duration: 100, retry: 0, status: 'passed', errors: [], workerIndex: 0,
    attachments: [{ name: 'healing-events', body: Buffer.from(JSON.stringify({ mode: 'ADAPTIVE', learningEnabled: true, events: [learnedEvent()] })) }] }
  reporter.onTestEnd(candidate, result)
  assert.equal(await reporter.onEnd({ status: 'passed' }), undefined)
  const knowledge = new KnowledgeBase(path.join(directory, 'knowledge-base.json')).snapshot()
  assert.equal(knowledge.lookup(scope, originalLocator, good).successfulRecoveries, 1)
  assert.equal(syncFeedback(directory).added, 0)
})

test('feedback replay accepts only verified teacher IDs and rejects held-out leakage', t => {
  const directory = temporary(t)
  const store = new HistoryStore(directory)
  const training = record({ ...summarizeHealing([learnedEvent()], 'ADAPTIVE'), project_name: 'training', experiment_id: 'S6-LEARNING-good-only-v1',
    notes: JSON.stringify({ learning_evaluation: { phase: 'training' } }) })
  const heldout = record({ ...summarizeHealing([learnedEvent()], 'ADAPTIVE'), project_name: 'adaptive-healing', experiment_id: 'S6-LEARNING-good-only-v1' })
  store.append(training); store.append(heldout)
  const id = randomUUID(); const root = path.join(directory, 'adaptive-evaluations', id)
  fs.mkdirSync(root, { recursive: true })
  const manifest = { status: 'VERIFIED', evaluation_id: id, training_attempt_ids: [training.attempt_id], heldout_attempt_ids: [heldout.attempt_id],
    app_version: training.app_version, test_version: training.test_version }
  const file = path.join(root, 'comparison.json')
  fs.writeFileSync(file, JSON.stringify(manifest))
  assert.equal(syncFeedback(directory).added, 1)
  assert.equal(syncFeedback(directory).added, 0)
  assert.equal(new KnowledgeBase(path.join(directory, 'knowledge-base.json')).snapshot().lookup(scope, originalLocator, good).attempts, 1)
  manifest.training_attempt_ids.push(heldout.attempt_id)
  fs.writeFileSync(file, JSON.stringify(manifest))
  assert.throws(() => syncFeedback(directory), /split/)
})


test('comparison audit supports numeric repetition indexes through the advertised limit of 20', () => {
  const rows = []
  const run = randomUUID()
  for (const scenario of ['healthy', 'good-only', 'both', 'identical', 'unsafe-href', 'business-control']) {
    for (const project of ['baseline-healing', 'adaptive-healing']) for (let index = 0; index < 20; index++) {
      const adaptive = project === 'adaptive-healing'
      const pass = ['healthy', 'good-only'].includes(scenario) || adaptive && scenario === 'both'
      const hit = adaptive && ['good-only', 'both'].includes(scenario)
      rows.push({ run_id: run, project_name: project, repeat_index: index, learningEnabled: adaptive, healing_mode: 'ADAPTIVE',
        expected_status: 'PASS', retry_count: 0, failure_phase: 'test', runtime_errors: [], status: pass ? 'PASS' : 'FAIL',
        healing_successful: pass && scenario !== 'healthy', injection_verified: scenario !== 'healthy',
        healing_attempted: !['healthy', 'business-control'].includes(scenario), knowledgeBaseHit: hit,
        historicalSuccessRate: hit ? 1 : null, healing_events: [{ knowledgeBaseVersion: 'snapshot' }],
        trace_path: 'artifacts/test/trace.zip', screenshot_path: 'artifacts/test/screenshot.png',
        notes: JSON.stringify({ learning_evaluation: { phase: 'heldout', scenario, intendedTargetClicked: pass } }) })
    }
  }
  validateComparison(rows, 20, 'snapshot')
})
