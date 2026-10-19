import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { calculateMetrics } from './metrics.js'
import { calculateRisk } from './riskCalculator.js'
import { analyzeFailures } from './failureAnalyzer.js'
import { generateRecommendations } from './recommendationEngine.js'
import { buildIntelligenceReport, generateIntelligenceReport, reportCSV, loadCampaigns } from './intelligenceReport.js'
import { createRunMetadata, experimentMetadata } from '../telemetry/metadata.js'
import { HistoryStore } from '../telemetry/history.js'
import { FAILURE_TYPES } from '../telemetry/taxonomy.js'

const metadata = createRunMetadata({ workers: 1 })
function record(overrides = {}) {
  const row = {
    schema_version: 2, record_type: 'TEST_ATTEMPT', ...metadata,
    run_id: randomUUID(), attempt_id: randomUUID(), test_id: 'TEST-001', test_name: 'Checkout', suite_name: 'Checkout',
    browser: 'chromium', project_name: 'chromium', status: 'PASS', failure_type: null, duration_ms: 100,
    retry_count: 0, start_time: '2026-10-19T10:00:00.000Z', end_time: '2026-10-19T10:00:00.100Z',
    trace_path: null, screenshot_path: null, notes: '', ...experimentMetadata(), expected_status: 'PASS',
    classification_source: 'NONE', failure_phase: 'test', error_message: '', error_stack: '', runtime_errors: [],
    worker_index: 0, repeat_index: 0, ...overrides,
  }
  row.end_time = new Date(Date.parse(row.start_time) + row.duration_ms).toISOString()
  return row
}
const fail = (changes = {}) => record({ status: 'FAIL', failure_type: 'ASSERTION_MISMATCH', classification_source: 'HEURISTIC', ...changes })
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sut-intelligence-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}
function experiment(changes = {}) {
  return fail({ experiment_id: 'EXP-v1', fault_variant: 'rename.v1', mutation_version: '1.0.1',
    fault_type: 'ACCESSIBLE_NAME_CHANGE', emulated: true, injected_at: '2026-10-19T09:59:59.000Z',
    injection_verified: true, failure_type: 'LOCATOR_NOT_FOUND', expected_failure_type: 'LOCATOR_NOT_FOUND', ...changes })
}
function campaign(rows, changes = {}) {
  return { campaign_id: randomUUID(), status: 'VERIFIED', expected_rows: rows.length,
    attempt_ids: rows.map(row => row.attempt_id), run_ids: [...new Set(rows.map(row => row.run_id))],
    experiments: [{ id: 'EXP-v1', variant: 'rename.v1', version: '1.0.1' }],
    app_version: rows[0].app_version, test_version: rows[0].test_version, ...changes }
}

test('first-attempt failures, recovery, and final failures have distinct denominators', () => {
  const run = randomUUID()
  const metrics = calculateMetrics([record(), record({ run_id: run, retry_count: 1, duration_ms: 40 }), fail({ run_id: run }), fail()])
  assert.equal(metrics.scoredExecutionCount, 3)
  assert.equal(metrics.failureRate, 2 / 3)
  assert.equal(metrics.finalFailureRate, 1 / 3)
  assert.equal(metrics.recoveredExecutions, 1)
  assert.equal(metrics.stabilityScore, 100 * (1 - 2 / 3))
  assert.equal(metrics.retryRate, 1 / 3)
  assert.equal(metrics.retryCost, 40)
})

test('retry cost sums additional durations once, never retry indexes', () => {
  const run = randomUUID()
  const metrics = calculateMetrics([fail({ run_id: run }), fail({ run_id: run, retry_count: 1, duration_ms: 70 }),
    record({ run_id: run, retry_count: 2, duration_ms: 30 })])
  assert.equal(metrics.retryAttempts, 2)
  assert.equal(metrics.retryCost, 100)
  assert.equal(metrics.retryDurationRatio, 0.5)
  assert.equal(metrics.retryRate, 1)
})

test('repeats and projects are independent logical executions', () => {
  const run = randomUUID()
  const metrics = calculateMetrics([record({ run_id: run }), fail({ run_id: run, repeat_index: 1 }), record({ run_id: run, project_name: 'mobile' })])
  assert.equal(metrics.scoredExecutionCount, 3)
})

test('skipped, interrupted, incomplete, duplicate retry indexes, and expected failures are excluded', () => {
  const run = randomUUID()
  const rows = [record({ status: 'SKIPPED' }), fail({ status: 'INTERRUPTED' }), fail({ retry_count: 1 }),
    fail({ expected_status: 'FAIL' }), record({ run_id: run }), record({ run_id: run })]
  const result = calculateMetrics(rows)
  assert.equal(result.scoredExecutionCount, 0)
  assert.equal(result.excludedExecutions.incompleteExecution, 4)
  assert.equal(result.excludedExecutions.expectedNonPass, 1)
  assert.equal(result.failureRate, null)
  assert.deepEqual(calculateRisk(result), { riskScore: null, riskLevel: null, evidence: 'NO_SCORABLE_EXECUTIONS' })
})

test('passing negative business validation is stable and has no failure recommendations', () => {
  const rows = Array.from({ length: 10 }, () => record({ test_name: 'Invalid coupon rejected' }))
  const report = buildIntelligenceReport(rows)
  assert.equal(report.tests[0].riskScore, 0)
  assert.equal(report.tests[0].riskLevel, 'LOW')
  assert.equal(report.tests[0].stabilityScore, 100)
  assert.deepEqual(report.tests[0].recommendations, [])
})

test('locator volatility proxy uses observed failure evidence, not mutation or expected labels', () => {
  const metrics = calculateMetrics([record({ locator_mutation: 'rename', expected_failure_type: 'LOCATOR_NOT_FOUND' }),
    fail({ failure_type: 'LOCATOR_AMBIGUOUS' }), fail()])
  assert.equal(metrics.locatorVolatility, 1 / 3)
  assert.equal(metrics.locatorAffectedExecutions, 1)
})

test('risk weights, thresholds, and limited evidence are explicit', () => {
  const calculate = changes => calculateRisk({ failureRate: 0, retryRate: 0, locatorVolatility: 0, scoredExecutionCount: 10, ...changes })
  assert.equal(calculate({ failureRate: 0.49 }).riskLevel, 'LOW')
  assert.equal(calculate({ failureRate: 0.5 }).riskLevel, 'MEDIUM')
  assert.equal(calculate({ failureRate: 1 }).riskLevel, 'HIGH')
  assert.equal(calculate({ failureRate: 1, retryRate: 1, locatorVolatility: 1 }).riskScore, 100)
  assert.equal(calculate({ scoredExecutionCount: 2 }).evidence, 'LIMITED_HISTORY')
  assert.throws(() => calculate({ retryRate: 1.01 }))
})

test('all eight observed failure classes have actionable recommendations', () => {
  for (const type of FAILURE_TYPES) {
    const rows = [fail({ failure_type: type })]
    const metrics = calculateMetrics(rows)
    const analysis = analyzeFailures(rows)
    assert.equal(analysis.counts[type], 1)
    assert.equal(analysis.failedAttempts, 1)
    assert.ok(generateRecommendations(metrics, analysis).length >= 2)
  }
})

test('retry advice appears for recovered failures and evidence remains linked', () => {
  const first = fail()
  const second = record({ run_id: first.run_id, retry_count: 1 })
  const result = buildIntelligenceReport([second, first]).tests[0]
  assert.ok(result.recommendations.some(text => text.includes('Investigate retries')))
  assert.ok(result.recommendations.some(text => text.includes('intermittent')))
  assert.deepEqual(result.scoredAttemptIds, [first.attempt_id, second.attempt_id].sort())
})

test('verified experiments remain separate; invalid and unregistered experiments are excluded', () => {
  const ordinary = record()
  const accepted = experiment()
  const rejected = experiment()
  const report = buildIntelligenceReport([ordinary, accepted, rejected], [campaign([accepted]), campaign([rejected], { status: 'INVALID' })])
  assert.equal(report.tests.length, 2)
  assert.equal(report.selection.acceptedAttempts, 2)
  assert.equal(report.selection.excluded.unverifiedExperimentAttempts, 1)
  assert.equal(report.tests.find(row => row.cohort === 'ordinary').riskScore, 0)
  assert.equal(report.tests.find(row => row.cohort === 'verified-experiment').riskScore, 75)
})

test('healthy experiment controls stay in the experiment cohort despite emulated=false', () => {
  const row = experiment({ status: 'PASS', failure_type: null, classification_source: 'NONE', emulated: false,
    injected_at: null, injection_verified: false, fault_type: '', expected_failure_type: null })
  const result = buildIntelligenceReport([row], [campaign([row])]).tests[0]
  assert.equal(result.cohort, 'verified-experiment')
  assert.equal(result.riskScore, 0)
})

test('verified manifests fail closed on missing, duplicate, mismatched, or unconfirmed membership', () => {
  const row = experiment()
  for (const manifest of [campaign([row], { expected_rows: 2 }), campaign([row], { attempt_ids: [randomUUID()] }),
    campaign([row], { app_version: 'wrong' }), campaign([row], { run_ids: [] }), campaign([row], { experiments: [] })]) {
    assert.throws(() => buildIntelligenceReport([row], [manifest]))
  }
  assert.throws(() => buildIntelligenceReport([row], [campaign([row]), campaign([row])]))
  assert.throws(() => buildIntelligenceReport([{ ...row, injection_verified: false }], [campaign([row])]))
})

test('run errors are reported separately and cannot inflate per-test risk', () => {
  const row = fail({ record_type: 'RUN_ERROR', test_id: '__RUN__', failure_phase: 'run', failure_type: 'SETUP_ENVIRONMENT_FAILURE' })
  const result = buildIntelligenceReport([record(), row])
  assert.equal(result.selection.excluded.runErrors, 1)
  assert.equal(result.runErrors[0].failureType, 'SETUP_ENVIRONMENT_FAILURE')
  assert.equal(result.tests[0].riskScore, 0)
})

test('schema errors and duplicate telemetry identities are rejected', () => {
  const row = record()
  assert.throws(() => buildIntelligenceReport([row, row]))
  assert.throws(() => buildIntelligenceReport([{ ...row, duration_ms: -1 }]))
})

test('empty history has no fabricated low-risk tests', () => {
  const result = buildIntelligenceReport([])
  assert.deepEqual(result.tests, [])
  assert.equal(result.selection.acceptedAttempts, 0)
  assert.equal(reportCSV(result).split('\r\n').length, 2)
})

test('CSV safely quotes test names and recommendation arrays', () => {
  const result = reportCSV(buildIntelligenceReport([fail({ test_name: 'Coupon, "SAVE10"\nrejected' })]))
  assert.ok(result.includes('"Coupon, ""SAVE10""\nrejected"'))
  assert.ok(result.includes('"[""'))
})

test('report snapshots and latest pointer agree; raw history bytes stay unchanged', t => {
  const directory = temporary(t)
  const store = new HistoryStore(directory)
  store.append(record())
  const before = [store.json, store.csv].map(file => fs.readFileSync(file, 'utf8'))
  const { report, output } = generateIntelligenceReport({ directory })
  const latest = JSON.parse(fs.readFileSync(path.join(directory, 'intelligence/latest.json')))
  const json = fs.readFileSync(path.join(output, 'intelligence-report.json'))
  const csv = fs.readFileSync(path.join(output, 'test-intelligence.csv'))
  assert.deepEqual(JSON.parse(json), report)
  assert.equal(latest.jsonSha256, createHash('sha256').update(json).digest('hex'))
  assert.equal(latest.csvSha256, createHash('sha256').update(csv).digest('hex'))
  assert.deepEqual([store.json, store.csv].map(file => fs.readFileSync(file, 'utf8')), before)
  const next = generateIntelligenceReport({ directory })
  assert.notEqual(next.report.analysisId, report.analysisId)
  assert.ok(fs.existsSync(output))
})

test('corrupt history or malformed campaign does not replace the latest report', t => {
  const directory = temporary(t)
  const store = new HistoryStore(directory)
  store.append(record())
  generateIntelligenceReport({ directory })
  const latestPath = path.join(directory, 'intelligence/latest.json')
  const before = fs.readFileSync(latestPath, 'utf8')
  fs.writeFileSync(store.csv, 'corrupt')
  assert.throws(() => generateIntelligenceReport({ directory }), /inconsistent/)
  assert.equal(fs.readFileSync(latestPath, 'utf8'), before)
  const root = path.join(directory, 'campaigns', 'bad')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'campaign.json'), '{}')
  assert.throws(() => loadCampaigns(directory), /Invalid campaign/)
})

test('CLI supports TELEMETRY_DIR without requiring a browser or app server', t => {
  const directory = temporary(t)
  new HistoryStore(directory).append(record())
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('./intelligenceReport.js', import.meta.url))],
    { env: { ...process.env, TELEMETRY_DIR: directory }, encoding: 'utf8' })
  assert.equal(JSON.parse(output).source.recordCount, 1)
})

test('a retry after an already passing attempt is not a valid retry chain', () => {
  const row = record()
  const result = calculateMetrics([row, fail({ run_id: row.run_id, retry_count: 1 })])
  assert.equal(result.scoredExecutionCount, 0)
  assert.equal(result.excludedExecutions.incompleteExecution, 1)
})

test('report preserves artifact references and uses observed labels despite experiment expectations', () => {
  const row = experiment({ failure_type: 'ASSERTION_MISMATCH', trace_path: 'artifacts/run/trace.zip', screenshot_path: 'artifacts/run/screen.png' })
  const result = buildIntelligenceReport([row], [campaign([row])]).tests[0]
  assert.equal(result.riskScore, 60)
  assert.equal(result.locatorVolatility, 0)
  assert.equal(result.failures.counts.ASSERTION_MISMATCH, 1)
  assert.equal(result.failures.counts.LOCATOR_NOT_FOUND, 0)
  assert.equal(result.artifacts[0].tracePath, row.trace_path)
  assert.ok(result.recommendations.some(text => text.includes('business requirement')))
  assert.ok(!result.recommendations.some(text => text.includes('Review locator strategy')))
})
