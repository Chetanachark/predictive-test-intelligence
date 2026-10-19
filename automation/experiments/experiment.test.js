import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { EXPERIMENTS, experimentById, mutateSource } from './registry.js'
import { validateCampaign } from './campaign.js'
import { createRunMetadata, experimentMetadata } from '../telemetry/metadata.js'
import { HistoryStore, serializeCSV } from '../telemetry/history.js'
import { validateRecord, upgradeRecord } from '../telemetry/schema.js'

const appModule = new URL('../../frontend/src/context/shopState.js', import.meta.url)
const productModule = new URL('../../frontend/src/data/products.js', import.meta.url)
const original = fs.readFileSync(appModule, 'utf8')
const metadata = createRunMetadata({ workers: 1 })

function legacyRecord() {
  return {
    schema_version: 1, record_type: 'TEST_ATTEMPT', ...metadata,
    attempt_id: randomUUID(), test_id: 'TEST-001', test_name: 'TEST-001 legacy', suite_name: 'Legacy', browser: 'chromium',
    status: 'PASS', failure_type: null, duration_ms: 5, retry_count: 0,
    start_time: '2026-10-19T10:00:00.000Z', end_time: '2026-10-19T10:00:00.005Z',
    trace_path: null, screenshot_path: null, notes: '', locator_mutation: '', fault_variant: '', experiment_id: '', scenario_variant: '',
    expected_status: 'PASS', classification_source: 'NONE', failure_phase: 'test', error_message: '', error_stack: '',
    runtime_errors: [], project_name: 'chromium', worker_index: 0, repeat_index: 0,
  }
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sut-experiments-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('registry is frozen, uniquely versioned, and includes six controls and nine faults', () => {
  assert.ok(Object.isFrozen(EXPERIMENTS))
  assert.ok(EXPERIMENTS.every(Object.isFrozen))
  assert.equal(EXPERIMENTS.length, 15)
  assert.equal(new Set(EXPERIMENTS.map(item => item.id)).size, 15)
  assert.equal(new Set(EXPERIMENTS.map(item => item.testId)).size, 15)
  assert.equal(EXPERIMENTS.filter(item => item.kind === 'none').length, 6)
  assert.equal(EXPERIMENTS.filter(item => item.expected).length, 9)
  assert.throws(() => experimentById('unknown'), /Unknown/)
})

for (const definition of EXPERIMENTS.filter(item => item.kind === 'source')) {
  test(`${definition.id}: source patch creates the specified business defect without writing the SUT`, async () => {
    const patched = mutateSource(definition, original)
    assert.notEqual(patched, original)
    const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: patched, encoding: 'utf8' })
    assert.equal(syntax.status, 0, syntax.stderr)
    const absoluteImports = patched.replace("'../data/products.js'", JSON.stringify(productModule.href))
    const module = await import(`data:text/javascript;base64,${Buffer.from(absoluteImports).toString('base64')}`)
    let state = module.createShopState()
    state = module.updateCart(state, { type: 'add', id: 1 })
    const next = module.completeOrder(state, { name: 'Student', email: 'student@example.com', address: 'Campus' }, 'SAVE10', 'ORD-TEST', '2026-10-19T10:00:00.000Z')
    if (definition.id === 'S4-ASSERT-001-v1') assert.equal(next.orders[0].discount, 2500)
    if (definition.id === 'S4-STATE-001-v1') assert.equal(next.products.find(product => product.id === 1).stock, 5)
    if (definition.id === 'S4-STATE-002-v1') assert.equal(next.cart.length, 1)
    if (definition.id === 'S4-STATE-003-v1') assert.equal(next.orders[0].total, 46000)
    assert.equal(fs.readFileSync(appModule, 'utf8'), original)
  })
}

test('source changes that remove or duplicate anchors are rejected', () => {
  const definition = experimentById('S4-ASSERT-001-v1')
  assert.throws(() => mutateSource(definition, 'no anchor'), /exactly one/)
  assert.throws(() => mutateSource(definition, original + original), /exactly one/)
})

test('v3 preserves all legacy values and adds explicit migration defaults', () => {
  const legacy = legacyRecord()
  const next = upgradeRecord(legacy)
  assert.equal(next.schema_version, 3)
  for (const key of Object.keys(legacy).filter(key => key !== 'schema_version')) assert.deepEqual(next[key], legacy[key])
  assert.equal(next.emulated, false)
  assert.equal(next.injected_at, null)
  assert.equal(next.injection_verified, false)
  assert.equal(next.expected_failure_type, null)
})

test('migration is backed up, synchronized, idempotent, and preserves rows', t => {
  const directory = temporary(t); const store = new HistoryStore(directory)
  const legacy = [legacyRecord(), legacyRecord()]
  const json = JSON.stringify(legacy, null, 2) + '\n'
  const csv = serializeCSV(legacy)
  fs.writeFileSync(store.json, json); fs.writeFileSync(store.csv, csv)
  const result = store.migrate()
  assert.equal(result.migrated, 2)
  assert.equal(fs.readFileSync(path.join(result.backup, 'execution-history.v1.json'), 'utf8'), json)
  assert.equal(fs.readFileSync(path.join(result.backup, 'test-history.v1.csv'), 'utf8'), csv)
  assert.deepEqual(store.validate(), legacy.map(upgradeRecord))
  assert.deepEqual(store.migrate(), { migrated: 0, backup: null })
})

test('append refuses unmigrated history without losing original data', t => {
  const store = new HistoryStore(temporary(t)); const row = legacyRecord()
  fs.writeFileSync(store.json, JSON.stringify([row])); fs.writeFileSync(store.csv, serializeCSV([row]))
  assert.throws(() => store.append(upgradeRecord(legacyRecord())), /telemetry:migrate/)
  assert.deepEqual(store.validate(), [row])
})

test('typed experiment metadata rejects malformed booleans and unverified timestamps', () => {
  assert.throws(() => experimentMetadata([{ type: 'emulated', description: 'yes' }]))
  const row = upgradeRecord(legacyRecord())
  assert.throws(() => validateRecord({ ...row, emulated: true, injection_verified: true }))
  assert.throws(() => validateRecord({ ...row, injected_at: 'not-a-date' }))
})

function campaignRows() {
  const run = randomUUID()
  return EXPERIMENTS.map(definition => ({
    ...upgradeRecord(legacyRecord()), run_id: run, test_id: definition.testId,
    experiment_id: definition.id, fault_variant: definition.variant, fault_type: definition.faultType,
    mutation_version: definition.version, scenario_variant: definition.scenario,
    expected_failure_type: definition.expected, failure_type: definition.expected,
    classification_source: definition.expected ? 'HEURISTIC' : 'NONE',
    status: definition.expected ? 'FAIL' : 'PASS', emulated: Boolean(definition.expected),
    injection_verified: Boolean(definition.expected), injected_at: definition.expected ? '2026-10-19T10:00:00.001Z' : null,
    screenshot_path: definition.expected ? 'artifacts/test/screenshot.png' : null,
    trace_path: definition.expected ? 'artifacts/test/trace.zip' : null,
    notes: definition.kind === 'source' ? 'mutated_sha256 evidence' : '',
  }))
}

test('campaign audit verifies observed diversity separately from expected labels', () => {
  const counts = validateCampaign(campaignRows(), EXPERIMENTS)
  assert.equal(counts.PASS, 6); assert.equal(counts.FAIL, 9)
  assert.equal(counts.LOCATOR_NOT_FOUND, 1); assert.equal(counts.LOCATOR_AMBIGUOUS, 1)
  assert.equal(counts.ASSERTION_MISMATCH, 1); assert.equal(counts.STATE_CONSISTENCY_FAILURE, 3)
  assert.equal(counts.ACTIONABILITY_FAILURE, 3)
})

for (const [name, change] of [
  ['surviving mutation', row => { row.status = 'PASS' }],
  ['wrong observed category', row => { row.failure_type = 'UNKNOWN' }],
  ['unverified injection', row => { row.injection_verified = false }],
  ['setup failure', row => { row.failure_phase = 'setup' }],
  ['missing artifact', row => { row.trace_path = null }],
  ['suppressed failure', row => { row.expected_status = 'FAIL' }],
]) {
  test(`campaign audit rejects ${name}`, () => {
    const rows = campaignRows(); change(rows.find(row => row.emulated))
    assert.throws(() => validateCampaign(rows, EXPERIMENTS))
  })
}

test('source mutation patterns accept Vite decimal and arrow-parameter normalization', () => {
  const served = original.replace('SAVE10: 0.1', 'SAVE10: .1').replace('find(item =>', 'find((item) =>')
  for (const definition of EXPERIMENTS.filter(item => item.kind === 'source')) {
    assert.notEqual(mutateSource(definition, served), served)
  }
})

test('inspection filters consume arguments once and exclude invalid campaigns', t => {
  const directory = temporary(t)
  const store = new HistoryStore(directory)
  const pass = upgradeRecord(legacyRecord())
  const fail = { ...upgradeRecord(legacyRecord()), status: 'FAIL', failure_type: 'UNKNOWN', classification_source: 'UNKNOWN' }
  store.append(pass); store.append(fail)
  fs.mkdirSync(path.join(directory, 'campaigns', 'good'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'campaigns', 'good', 'campaign.json'), JSON.stringify({ status: 'VERIFIED', attempt_ids: [pass.attempt_id] }))
  fs.mkdirSync(path.join(directory, 'campaigns', 'bad'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'campaigns', 'bad', 'campaign.json'), JSON.stringify({ status: 'INVALID', attempt_ids: [fail.attempt_id] }))
  const script = new URL('./inspect.js', import.meta.url)
  for (const [args, expected] of [[['--status', 'FAIL'], 'FAIL'], [['--verified-campaigns'], 'PASS']]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8', env: { ...process.env, TELEMETRY_DIR: directory } })
    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.records, 1)
    assert.equal(summary.status[expected], 1)
  }
})
