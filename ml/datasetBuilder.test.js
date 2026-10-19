import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildDataset, aggregateHistory, loadAudit, generateDataset, SPEC } from './datasetBuilder.js'
import { HEALING_DEFAULTS } from '../automation/healing/healingHistory.js'
import { createRunMetadata, experimentMetadata } from '../automation/telemetry/metadata.js'
import { HistoryStore } from '../automation/telemetry/history.js'

const metadata = createRunMetadata({ workers: 1 })
const origin = Date.parse('2026-10-19T00:00:00.000Z')
const time = ms => new Date(origin + ms).toISOString()
function record({ at = 0, duration = 5, status = 'PASS', ...changes } = {}) {
  return { schema_version: 4, record_type: 'TEST_ATTEMPT', ...metadata, ...HEALING_DEFAULTS, healing_events: [], ...experimentMetadata(),
    run_id: randomUUID(), attempt_id: randomUUID(), test_id: 'ML-001', test_name: 'Checkout', suite_name: 'Checkout',
    browser: 'chromium', project_name: 'chromium', status, failure_type: status === 'PASS' ? null : 'ASSERTION_MISMATCH',
    classification_source: status === 'PASS' ? 'NONE' : 'HEURISTIC', duration_ms: duration, retry_count: 0,
    start_time: time(at), end_time: time(at + duration), trace_path: null, screenshot_path: null, notes: '', expected_status: 'PASS',
    failure_phase: 'test', error_message: '', error_stack: '', runtime_errors: [], worker_index: 0, repeat_index: 0, ...changes }
}
function auditFor(rows) {
  const membership = new Map()
  for (const row of rows) {
    const run = rows.filter(item => item.run_id === row.run_id)
    membership.set(row.attempt_id, { cohort: row.experiment_id ? 'controlled' : 'ordinary', blockId: row.run_id,
      blockStart: new Date(Math.min(...run.map(item => Date.parse(item.start_time))) - 1).toISOString(),
      blockEnd: new Date(Math.max(...run.map(item => Date.parse(item.end_time))) + 1).toISOString() })
  }
  return { membership, files: [] }
}
const build = (rows, options = {}) => buildDataset(rows, auditFor(rows), { asOf: time(100_000), ...options })
const features = row => Object.fromEntries(SPEC.feature_order.map(key => [key, row[key]]))
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'test-ml-builder-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('target outcome and duration never enter their own feature vector', () => {
  const rows = [record(), record({ at: 1000 }), record({ at: 2000 })]
  const original = build(rows).samples[0]
  const changed = [...rows.slice(0, 2), { ...rows[2], status: 'FAIL', failure_type: 'LOCATOR_NOT_FOUND', classification_source: 'HEURISTIC', duration_ms: 400, end_time: time(2400) }]
  const next = build(changed).samples[0]
  assert.deepEqual(features(next), features(original))
  assert.equal(original.next_execution_failed, 0)
  assert.equal(next.next_execution_failed, 1)
  assert.ok(!next.history_execution_ids.includes(next.target_execution_id))
})

test('appending future executions cannot alter earlier supervised samples', () => {
  const rows = [record(), record({ at: 1000 }), record({ at: 2000 })]
  const before = build(rows).samples[0]
  const after = build([...rows, record({ at: 4000, status: 'FAIL' })]).samples.find(row => row.sample_id === before.sample_id)
  assert.deepEqual(after, before)
})

test('shuffling telemetry input does not alter chronology or features', () => {
  const rows = [record(), record({ at: 1000, status: 'FAIL' }), record({ at: 2000 }), record({ at: 3000 })]
  assert.deepEqual(build([...rows].reverse()).samples, build(rows).samples)
})

test('retries form one execution; target and historical failure rates use final outcomes', () => {
  const run = randomUUID()
  const rows = [record(), record({ at: 1000, duration: 9, status: 'FAIL', failure_type: 'LOCATOR_NOT_FOUND', run_id: run }),
    record({ at: 1020, duration: 6, retry_count: 1, run_id: run }), record({ at: 2000, status: 'FAIL' })]
  const row = build(rows).samples[0]
  assert.equal(row.history_count, 2)
  assert.equal(row.failure_rate, 0)
  assert.equal(row.retry_rate, 0.5)
  assert.equal(row.average_duration, 10)
  assert.equal(row.duration_variance, 25)
  assert.equal(row.locator_failure_rate, 0.5)
  assert.equal(row.risk_score, 20)
  assert.equal(row.next_execution_failed, 1)
})

test('an overlapping earlier execution is unavailable until it completes', () => {
  const rows = [record({ duration: 20 }), record({ at: 10 }), record({ at: 30 })]
  const result = build(rows, { minimumHistory: 1 })
  assert.equal(result.samples.length, 1)
  assert.equal(result.samples[0].prediction_time, time(30))
  assert.equal(result.samples[0].history_count, 2)
})

test('as-of excludes executions or audited blocks not completed by the cutoff', () => {
  const rows = [record(), record({ at: 1000 }), record({ at: 2000 }), record({ at: 3000 })]
  const result = build(rows, { asOf: time(2500) })
  assert.equal(result.samples.length, 1)
  assert.equal(result.exclusions.futureOrUnfinishedExecutions, 1)
  assert.equal(result.forecasts[0].history_count, 3)
})

test('business rejection passing tests remain label zero', () => {
  const result = build([record(), record({ at: 1000 }), record({ at: 2000, test_name: 'Invalid coupon rejected' })])
  assert.equal(result.samples[0].next_execution_failed, 0)
})

test('window truncation uses only the most recent completed executions', () => {
  const rows = [record({ status: 'FAIL' }), record({ at: 1000 }), record({ at: 2000 }), record({ at: 3000 })]
  const last = build(rows, { windowSize: 2 }).samples.at(-1)
  assert.equal(last.history_count, 2)
  assert.equal(last.failure_rate, 0)
})

test('ordinary/controlled and learning configurations do not share historical series', () => {
  const rows = [record(), record({ at: 1000, learningEnabled: true }), record({ at: 2000, experiment_id: 'S4-v1' })]
  const result = build(rows)
  assert.equal(result.samples.length, 0)
  assert.equal(result.exclusions.coldStartExecutions, 3)
})

test('unmeasured healing and knowledge rates are null rather than fabricated zero', () => {
  const row = build([record(), record({ at: 1000 }), record({ at: 2000 })]).samples[0]
  assert.equal(row.healing_success_rate, null)
  assert.equal(row.knowledge_base_hit_rate, null)
})

test('healing and knowledge rates count opportunities from past executions only', () => {
  const base = { failed: false, retried: false, duration: 10, locatorFailure: true, actionabilityFailure: false,
    healingAttempted: true, healingSuccessful: true, learningEnabled: true, knowledgeHit: true }
  const result = aggregateHistory([base, { ...base, healingSuccessful: false, knowledgeHit: false }])
  assert.equal(result.healing_success_rate, 0.5)
  assert.equal(result.knowledge_base_hit_rate, 0.5)
})

test('incomplete retry chains and expected non-pass tests are excluded', () => {
  const result = build([record({ retry_count: 1 }), record({ at: 1000, status: 'FAIL', expected_status: 'FAIL' })])
  assert.equal(result.samples.length, 0)
  assert.equal(result.exclusions.incompleteExecutions, 1)
  assert.equal(result.exclusions.expectedNonPass, 1)
})

test('missing audit membership and invalid telemetry are rejected or excluded', () => {
  const rows = [record()]
  assert.equal(buildDataset(rows, { membership: new Map() }, { asOf: time(1000) }).exclusions.unauditedAttempts, 1)
  assert.throws(() => build([{ ...rows[0], duration_ms: -1 }]))
  assert.throws(() => build([rows[0], rows[0]]))
})

test('verified manifest membership is checked without using expected labels as outcomes', t => {
  const directory = temporary(t)
  const row = record({ experiment_id: 'S4-v1', fault_variant: 'rename', expected_failure_type: 'LOCATOR_NOT_FOUND' })
  const root = path.join(directory, 'campaigns', randomUUID())
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, 'campaign.json')
  const manifest = { campaign_id: path.basename(root), status: 'VERIFIED', expected_rows: 1, attempt_ids: [row.attempt_id],
    run_id: row.run_id, app_version: row.app_version, test_version: row.test_version, started_at: time(0), completed_at: time(20) }
  fs.writeFileSync(file, JSON.stringify(manifest))
  assert.equal(loadAudit(directory, [row]).membership.get(row.attempt_id).cohort, 'controlled')
  manifest.attempt_ids = [randomUUID()]
  fs.writeFileSync(file, JSON.stringify(manifest))
  assert.throws(() => loadAudit(directory, [row]), /Unverifiable/)
})

test('dataset publication preserves raw telemetry and publishes a completed snapshot', t => {
  const root = temporary(t); const directory = path.join(root, 'dataset'); const output = path.join(root, 'ml')
  const store = new HistoryStore(directory)
  for (const at of [0, 1000, 2000]) {
    const row = record({ at }); store.append(row)
    const run = path.join(directory, 'runs', row.run_id)
    fs.mkdirSync(run, { recursive: true })
    fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ ...metadata, run_id: row.run_id, status: 'PASSED', timestamp: new Date(Date.parse(row.start_time) - 1).toISOString(), end_time: new Date(Date.parse(row.end_time) + 1).toISOString() }))
  }
  const before = fs.readFileSync(store.json, 'utf8')
  const result = generateDataset({ directory, output, asOf: time(10_000) })
  assert.equal(result.manifest.samples, 1)
  assert.equal(fs.readFileSync(store.json, 'utf8'), before)
  assert.ok(fs.existsSync(path.join(result.root, 'execution-lineage.json')))
  const pointer = JSON.parse(fs.readFileSync(path.join(output, 'latest-dataset.json')))
  assert.equal(pointer.build_id, result.manifest.build_id)
})

test('temporal features encode past trends, streaks, volatility and recovery momentum', () => {
  const history = Array.from({ length: 5 }, (_, i) => ({ duration: (i + 1) * 100,
    failed: [2,3].includes(i), retried: i >= 2, locatorFailure: [1,2,4].includes(i), actionabilityFailure: false,
    healingAttempted: [1,2,3].includes(i), healingSuccessful: [1,2].includes(i),
    learningEnabled: false, knowledgeHit: false, end: time((i+1) * 1000) }))
  const values = aggregateHistory(history)
  assert.equal(values.duration_trend, 100)
  assert.ok(Math.abs(values.duration_growth_rate - 5/3) < 1e-10)
  assert.equal(values.retry_trend, .3)
  assert.equal(values.locator_volatility_index, .75)
  assert.equal(values.healing_success_momentum, -.5)
  assert.equal(values.pass_streak, 1)
  assert.equal(values.failure_streak, 0)
  assert.equal(values.mean_time_between_failures, 1000)
  assert.equal(values.recent_failure_rate, .4)
})

test('progression campaigns reset series history so held-out episodes have no training-episode observations', () => {
  const rows = Array.from({length:6}, (_, i) => record({at:i*1000, experiment_id:'S75-locator-v1'}))
  const audit = auditFor(rows)
  for (const [i,row] of rows.entries()) audit.membership.set(row.attempt_id, {
    cohort:'progression', blockId:i < 3 ? 'first-episode' : 'later-episode',
    blockStart:time(i < 3 ? 0 : 3000), blockEnd:time(i < 3 ? 2500 : 5500),
  })
  const result = buildDataset(rows,audit,{asOf:time(10000)})
  assert.equal(result.samples.length,2)
  assert.notEqual(result.samples[0].series_id,result.samples[1].series_id)
  assert.equal(result.samples[1].history_count,2)
})
