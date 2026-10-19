import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import TelemetryReporter from './TelemetryReporter.js'
import { RECORD_SCHEMA, CSV_COLUMNS, validateRecord } from './schema.js'
import { FAILURE_TYPES, classifyFailure } from './taxonomy.js'
import { HistoryStore, atomicWrite, serializeCSV } from './history.js'
import { createRunMetadata, testIdentity, experimentMetadata } from './metadata.js'

const metadata = createRunMetadata({ workers: 2 })
function record(overrides = {}) {
  return {
    schema_version: 1, record_type: 'TEST_ATTEMPT', ...metadata,
    attempt_id: randomUUID(), test_id: 'TEST-001', test_name: 'TEST-001 sample', suite_name: 'Telemetry', browser: 'chromium',
    status: 'PASS', failure_type: null, duration_ms: 5, retry_count: 0,
    start_time: '2026-10-19T10:00:00.000Z', end_time: '2026-10-19T10:00:00.005Z',
    trace_path: null, screenshot_path: null, notes: '',
    locator_mutation: '', fault_variant: '', experiment_id: '', scenario_variant: '',
    expected_status: 'PASS', classification_source: 'NONE', failure_phase: 'test', error_message: '', error_stack: '',
    runtime_errors: [], project_name: 'chromium', worker_index: 0, repeat_index: 0,
    ...overrides,
  }
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sut-telemetry-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}
function fakeTest(title = 'TEST-001 sample') {
  return {
    title, annotations: [], expectedStatus: 'passed', repeatEachIndex: 0,
    location: { file: fileURLToPath(new URL('../tests/login.spec.js', import.meta.url)), line: 1 },
    parent: { title: 'Demo', type: 'describe', project: () => ({ name: 'chromium', use: { browserName: 'chromium' } }) },
  }
}
function fakeResult(overrides = {}) {
  return { startTime: new Date('2026-10-19T10:00:00.000Z'), duration: 5, retry: 0, status: 'passed',
    errors: [], attachments: [], workerIndex: 0, ...overrides }
}
function begin(reporter, candidate = fakeTest()) {
  reporter.onBegin({ workers: 2 }, { allTests: () => [candidate] })
  return candidate
}

// This parser is a test oracle for CSV quoting, not part of production ingestion.
function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false
  for (let i = 0; i < text.length; i++) {
    const character = text[i]
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && character === ',') { row.push(cell); cell = '' }
    else if (!quoted && character === '\r' && text[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++
    } else cell += character
  }
  return rows
}

test('schema JSON and runtime validator describe the same canonical record', () => {
  const saved = JSON.parse(fs.readFileSync(new URL('./record.schema.json', import.meta.url)))
  assert.deepEqual(saved, RECORD_SCHEMA)
  assert.equal(validateRecord(record()).failure_type, null)
})

test('all canonical fields are mandatory, including empty experiment fields', () => {
  for (const key of CSV_COLUMNS) {
    const row = record(); delete row[key]
    assert.throws(() => validateRecord(row), undefined, key)
  }
})

test('schema rejects invalid types, statuses, chronology, paths, and unknown fields', () => {
  for (const changes of [
    { duration_ms: -1 }, { duration_ms: NaN }, { retry_count: 1.5 }, { status: 'GREEN' },
    { failure_type: 'NONE' }, { failure_type: 'LOCATOR_NOT_FOUND' },
    { end_time: '2026-10-19T09:00:00.000Z' }, { duration_ms: 500 },
    { start_time: '2026-02-30T10:00:00.000Z' },
    { screenshot_path: 'artifacts/../../outside.png' }, { trace_path: '/absolute/trace.zip' },
    { extra: true }, { environment: {} }, { attempt_id: '' },
  ]) assert.throws(() => validateRecord(record(changes)))
})

test('taxonomy is frozen and passing business validations have no failure type', () => {
  assert.ok(Object.isFrozen(FAILURE_TYPES))
  assert.equal(FAILURE_TYPES.length, 8)
  assert.deepEqual(classifyFailure({ status: 'PASS', errors: [{ message: 'Invalid coupon code.' }] }), { type: null, source: 'NONE' })
})

for (const [type, options] of [
  ['LOCATOR_AMBIGUOUS', { errors: [{ message: 'strict mode violation: resolved to 2 elements' }] }],
  ['LOCATOR_NOT_FOUND', { errors: [{ message: 'locator.click: Timeout 100ms exceeded.\nCall log:\n - waiting for getByRole(\'button\')' }] }],
  ['ACTIONABILITY_FAILURE', { errors: [{ message: 'element is not visible' }] }],
  ['ASSERTION_MISMATCH', { errors: [{ message: 'expect(locator).toHaveText(expected) failed' }] }],
  ['APPLICATION_RUNTIME_ERROR', { runtimeErrors: ['TypeError: render failed'] }],
  ['SETUP_ENVIRONMENT_FAILURE', { phase: 'setup', errors: [{ message: 'beforeEach failed' }] }],
  ['STATE_CONSISTENCY_FAILURE', { annotation: 'STATE_CONSISTENCY_FAILURE' }],
  ['UNKNOWN', { errors: [{ message: 'Timeout with insufficient evidence' }] }],
]) {
  test(`classification supports ${type} without conflating it with status`, () => {
    assert.equal(classifyFailure({ status: 'FAIL', ...options }).type, type)
  })
}

test('assertion timeout is not automatically a missing locator', () => {
  assert.equal(classifyFailure({ status: 'TIMED_OUT', category: 'expect', errors: [{ message: 'waiting for getByRole' }] }).type, 'ASSERTION_MISMATCH')
})

test('stable explicit test identity survives title changes', () => {
  assert.equal(testIdentity(fakeTest('TEST-001 renamed description')), 'TEST-001')
  const fallback = fakeTest('unnumbered description')
  assert.equal(testIdentity(fallback), testIdentity(fallback))
})

test('experiment annotations override run environment defaults', () => {
  assert.equal(experimentMetadata([{ type: 'experiment_id', description: 'study-001' }]).experiment_id, 'study-001')
})

test('append preserves earlier attempts and JSON/CSV agree including quoted multiline text', t => {
  const store = new HistoryStore(temporary(t))
  const first = record({ notes: 'comma, quote " and\nnew line' })
  const second = record({ test_id: 'TEST-002', test_name: 'Second' })
  store.append(first); store.append(second)
  assert.deepEqual(store.validate(), [first, second])
  const parsed = parseCSV(fs.readFileSync(store.csv, 'utf8'))
  assert.deepEqual(parsed[0], CSV_COLUMNS)
  assert.equal(parsed.length, 3)
  for (const [index, row] of [first, second].entries()) {
    assert.deepEqual(parsed[index + 1], CSV_COLUMNS.map(key => row[key] === null ? '' : typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key])))
  }
})

test('invalid records leave both historical outputs untouched', t => {
  const store = new HistoryStore(temporary(t))
  store.append(record())
  const before = [fs.readFileSync(store.json, 'utf8'), fs.readFileSync(store.csv, 'utf8')]
  assert.throws(() => store.append(record({ test_name: '' })))
  assert.deepEqual([fs.readFileSync(store.json, 'utf8'), fs.readFileSync(store.csv, 'utf8')], before)
})

test('duplicate delivery is idempotent and conflicting duplicate IDs are rejected', t => {
  const store = new HistoryStore(temporary(t)); const row = record()
  assert.equal(store.append(row), true)
  assert.equal(store.append(row), false)
  assert.throws(() => store.append({ ...row, notes: 'changed' }), /Conflicting duplicate/)
  assert.equal(store.validate().length, 1)
})

test('write-ahead journal recovers an interrupted JSON/CSV publication', t => {
  const store = new HistoryStore(temporary(t)); const first = record(); const second = record()
  store.append(first)
  atomicWrite(store.pending, JSON.stringify([first, second]))
  fs.writeFileSync(store.csv, 'interrupted publication')
  assert.deepEqual(store.validate(), [first, second])
  assert.equal(fs.readFileSync(store.csv, 'utf8'), serializeCSV([first, second]))
  assert.equal(fs.existsSync(store.pending), false)
})

test('unexplained corruption is rejected rather than silently erasing history', t => {
  const store = new HistoryStore(temporary(t)); store.append(record())
  fs.writeFileSync(store.csv, 'corrupted')
  assert.throws(() => store.validate(), /inconsistent/)
  assert.throws(() => store.append(record()), /inconsistent/)
  assert.equal(JSON.parse(fs.readFileSync(store.json)).length, 1)
})

test('concurrent reporter processes append without losing rows', async t => {
  const directory = temporary(t)
  const module = new URL('./history.js', import.meta.url).href
  const code = `import { HistoryStore } from ${JSON.stringify(module)}; new HistoryStore(process.argv[1]).append(JSON.parse(process.argv[2]));`
  await Promise.all(Array.from({ length: 5 }, () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', code, directory, JSON.stringify(record())])))
  assert.equal(new HistoryStore(directory).validate().length, 5)
})

test('reporter keeps first failure and successful retry as separate attempts', async t => {
  const reporter = new TelemetryReporter({ directory: temporary(t) })
  const candidate = begin(reporter)
  const failure = fakeResult({ status: 'failed', errors: [{ message: 'expect(locator).toHaveText(expected) failed' }] })
  reporter.onTestBegin(candidate, failure); reporter.onTestEnd(candidate, failure)
  const success = fakeResult({ retry: 1 })
  reporter.onTestBegin(candidate, success); reporter.onTestEnd(candidate, success)
  assert.equal(await reporter.onEnd({ status: 'passed' }), undefined)
  const rows = reporter.store.validate()
  assert.deepEqual(rows.map(row => row.status), ['FAIL', 'PASS'])
  assert.deepEqual(rows.map(row => row.retry_count), [0, 1])
  assert.notEqual(rows[0].attempt_id, rows[1].attempt_id)
  assert.equal(rows[0].run_id, rows[1].run_id)
  assert.equal(rows[0].test_id, rows[1].test_id)
  assert.equal(rows[1].failure_type, null)
})

test('failure artifacts are copied to durable storage outside Playwright output', async t => {
  const directory = temporary(t); const reporter = new TelemetryReporter({ directory })
  const candidate = begin(reporter)
  const source = path.join(directory, 'temporary-source.png'); fs.writeFileSync(source, 'image-test-data')
  const result = fakeResult({ status: 'failed', errors: [{ message: 'no element matches selector' }], attachments: [
    { name: 'screenshot', contentType: 'image/png', path: source },
    { name: 'trace', contentType: 'application/zip', body: Buffer.from('trace-test-data') },
  ] })
  reporter.onTestEnd(candidate, result)
  assert.equal(await reporter.onEnd({ status: 'failed' }), undefined)
  fs.unlinkSync(source)
  const [row] = reporter.store.validate()
  assert.equal(fs.readFileSync(path.join(directory, row.screenshot_path), 'utf8'), 'image-test-data')
  assert.equal(fs.readFileSync(path.join(directory, row.trace_path), 'utf8'), 'trace-test-data')
})

test('runtime errors are retained without relabeling a passing test as failed', async t => {
  const reporter = new TelemetryReporter({ directory: temporary(t) }); const candidate = begin(reporter)
  reporter.onTestEnd(candidate, fakeResult({ attachments: [{ name: 'telemetry-runtime-errors', body: Buffer.from('["TypeError: observed"]') }] }))
  await reporter.onEnd({ status: 'passed' })
  const [row] = reporter.store.validate()
  assert.equal(row.status, 'PASS'); assert.equal(row.failure_type, null)
  assert.deepEqual(row.runtime_errors, ['TypeError: observed'])
})

test('runner errors use a distinct record type instead of inventing failed tests', async t => {
  const reporter = new TelemetryReporter({ directory: temporary(t) })
  reporter.onError({ message: 'Web server failed to start' })
  await reporter.onEnd({ status: 'failed' })
  const [row] = reporter.store.validate()
  assert.equal(row.record_type, 'RUN_ERROR'); assert.equal(row.test_id, '__RUN__')
  assert.equal(row.failure_type, 'SETUP_ENVIRONMENT_FAILURE')
})

test('telemetry errors explicitly fail the run instead of being swallowed by Playwright', async t => {
  const reporter = new TelemetryReporter({ directory: temporary(t) }); const candidate = begin(reporter)
  reporter.onTestEnd(candidate, fakeResult({ duration: -1 }))
  assert.deepEqual(await reporter.onEnd({ status: 'passed' }), { status: 'failed' })
  assert.equal(JSON.parse(fs.readFileSync(reporter.manifest)).status, 'TELEMETRY_ERROR')
})
