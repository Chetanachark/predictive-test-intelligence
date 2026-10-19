import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { confidenceScore, textSimilarity } from './confidenceScore.js'
import { rankCandidates, selectCandidate } from './candidateRanking.js'
import { locatorFromDescriptor } from './candidateDiscovery.js'
import { HealingEngine } from './healingEngine.js'
import { HEALING_DEFAULTS, summarizeHealing, validateHealingEvent, healingRows, serializeHealingCSV } from './healingHistory.js'
import { readHealingResult } from './healingReporter.js'
import { createRunMetadata, experimentMetadata } from '../telemetry/metadata.js'
import { V2_SCHEMA, validateRecord } from '../telemetry/schema.js'
import { HistoryStore, atomicWrite, serializeCSV } from '../telemetry/history.js'
import { buildIntelligenceReport } from '../intelligence/intelligenceReport.js'

const reference = { tag: 'a', role: 'link', name: 'Proceed to checkout', text: 'Proceed to checkout', label: '',
  testId: '', ariaLabel: '', attributes: { href: '/checkout', id: '', type: '', name: '' }, context: 'section Your cart', pageURL: 'http://localhost/cart' }
const candidate = changes => ({ descriptor: { strategy: 'role', role: 'link', value: 'Proceed to purchase' },
  features: { ...reference, ...changes }, discoveredBy: ['role', 'semanticSimilarity'] })
function event(changes = {}) {
  return { operation_id: randomUUID(), healing_mode: 'ADAPTIVE', healing_attempted: true, healing_successful: true,
    original_locator: '{"strategy":"role","role":"link","value":"Proceed to checkout"}',
    candidate_locator: '{"strategy":"role","role":"link","value":"Proceed to purchase"}',
    candidate_count: 1, confidence_score: 1, healing_duration_ms: 5, healing_reason: 'RECOVERED_AND_ORIGINAL_ASSERTIONS_PASSED',
    original_failure_type: 'LOCATOR_NOT_FOUND', original_error: 'locator.click: no element matches',
    original_assertions_passed: true, action_completed: true, action_duration_ms: 2, total_duration_ms: 7,
    reference, candidates: rankCandidates(reference, [candidate({ name: 'Proceed to purchase' })]), policy_version: 'semantic-v1', ...changes }
}
const metadata = createRunMetadata({ workers: 1 })
function record(changes = {}) {
  return { schema_version: 4, record_type: 'TEST_ATTEMPT', ...metadata,
    run_id: randomUUID(), attempt_id: randomUUID(), test_id: 'TEST-001', test_name: 'Checkout', suite_name: 'Checkout',
    browser: 'chromium', project_name: 'chromium', status: 'PASS', failure_type: null, duration_ms: 100,
    retry_count: 0, start_time: '2026-10-19T10:00:00.000Z', end_time: '2026-10-19T10:00:00.100Z',
    trace_path: null, screenshot_path: null, notes: '', ...experimentMetadata(), expected_status: 'PASS',
    classification_source: 'NONE', failure_phase: 'test', error_message: '', error_stack: '', runtime_errors: [],
    worker_index: 0, repeat_index: 0, ...HEALING_DEFAULTS, healing_events: [], ...changes }
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sut-healing-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}
function fakeEngine({ mode = 'ADAPTIVE', error } = {}) {
  const events = []
  let actions = 0
  const locator = { count: async () => error?.message.includes('strict mode') ? 2 : error?.message.includes('no element matches') ? 0 : 1, click: async () => { actions++; if (error) throw error }, fill: async () => { actions++; if (error) throw error } }
  const page = { getByRole: () => locator, url: () => 'http://localhost/cart' }
  return { engine: new HealingEngine(page, { mode, record: async e => events.push(e) }), events, actions: () => actions }
}
const descriptor = { strategy: 'role', role: 'link', value: 'Proceed to checkout' }

test('semantic similarity is a bounded deterministic lexical/synonym heuristic', () => {
  assert.equal(textSimilarity('Proceed to checkout', 'Proceed to purchase'), 1)
  assert.equal(textSimilarity('Checkout', 'Cancel'), 0)
  assert.equal(textSimilarity('', ''), 0)
  assert.ok(confidenceScore(reference, candidate({ name: 'Proceed to purchase' }).features).confidence > 0.82)
})

test('contract attributes reject a text-perfect link to the wrong destination', () => {
  const ranked = rankCandidates(reference, [candidate({ attributes: { ...reference.attributes, href: '/products' } }), candidate({ name: 'Proceed to purchase' })])
  assert.equal(ranked.find(item => item.features.attributes.href === '/products').eligible, false)
  assert.equal(selectCandidate(ranked).candidate.features.attributes.href, '/checkout')
})

test('identical unaddressable duplicates are refused rather than clicked by position', () => {
  const ranked = rankCandidates(reference, [{ ...candidate({}), descriptor: null }, { ...candidate({}), descriptor: null }])
  assert.equal(selectCandidate(ranked).reason, 'NO_SAFE_CANDIDATE')
})

test('an ambiguous runner-up blocks a confident candidate', () => {
  const ranked = rankCandidates(reference, [candidate({}), { ...candidate({}), descriptor: null }])
  assert.equal(selectCandidate(ranked).reason, 'INSUFFICIENT_MARGIN')
})

test('low confidence and absence of a stable identity anchor cause refusal', () => {
  const low = candidate({ name: 'Cancel', text: 'Cancel', context: 'unrelated' })
  assert.equal(selectCandidate(rankCandidates(reference, [low])).reason, 'LOW_CONFIDENCE')
  const unanchored = { ...reference, attributes: { href: '', id: '', name: '', type: '' } }
  assert.equal(rankCandidates(unanchored, [candidate({ attributes: unanchored.attributes })])[0].reason, 'NO_STABLE_ANCHOR')
})

test('all five locator strategies construct supported Playwright locators', () => {
  const calls = []
  const locator = { and: other => { calls.push(['and', other]); return locator } }
  const page = Object.fromEntries(['getByRole', 'getByLabel', 'getByText', 'getByTestId', 'locator'].map(name => [name, (...args) => { calls.push([name, ...args]); return locator }]))
  for (const option of [descriptor, { strategy: 'label', value: 'Name' }, { strategy: 'text', value: 'Continue' },
    { strategy: 'testId', value: 'checkout' }, { strategy: 'ariaLabel', value: 'Checkout' }]) assert.equal(locatorFromDescriptor(page, option), locator)
  assert.deepEqual(calls.map(call => call[0]), ['getByRole', 'getByLabel', 'getByText', 'getByTestId', 'locator'])
  assert.throws(() => locatorFromDescriptor(page, { strategy: 'xpath', value: '//button' }))
  assert.throws(() => locatorFromDescriptor(page, { ...descriptor, attributes: { onclick: 'bad' } }))
})

test('business assertion failure is rethrown unchanged with no recovery attempt', async () => {
  const { engine, events, actions } = fakeEngine()
  const defect = new Error('Expected 50000 but received 51000')
  let validations = 0
  await assert.rejects(engine.perform({ descriptor, validate: async () => { validations++; throw defect } }), error => error === defect)
  assert.equal(validations, 1)
  assert.equal(actions(), 1)
  assert.equal(events[0].healing_attempted, false)
  assert.equal(events[0].healing_successful, false)
  assert.equal(events[0].healing_reason, 'ORIGINAL_ASSERTION_FAILED')
  validateHealingEvent(events[0])
})

test('healthy action validates the original oracle once without claiming healing', async () => {
  const { engine, events } = fakeEngine()
  let validations = 0
  await engine.perform({ descriptor, validate: async () => { validations++ } })
  assert.equal(validations, 1)
  assert.equal(events[0].original_assertions_passed, true)
  assert.equal(events[0].healing_successful, false)
})

test('actionability errors never trigger discovery or another action', async () => {
  const error = new Error('locator.click: element is not enabled')
  const { engine, events, actions } = fakeEngine({ error })
  await assert.rejects(engine.perform({ descriptor, validate: async () => assert.fail('Oracle must not run') }), error)
  assert.equal(events[0].original_failure_type, 'ACTIONABILITY_FAILURE')
  assert.equal(events[0].healing_attempted, false)
  assert.equal(actions(), 1)
})

test('baseline retains the original locator error and never attempts healing', async () => {
  const error = new Error('locator.click: strict mode violation: resolved to 2 elements')
  const { engine, events } = fakeEngine({ mode: 'BASELINE', error })
  await assert.rejects(engine.perform({ descriptor, validate: async () => {} }), error)
  assert.equal(events[0].healing_attempted, false)
  assert.equal(events[0].healing_reason, 'BASELINE_NO_HEALING')
})

test('adaptive failure without a trusted same-page reference is refused and logged', async () => {
  const error = new Error('locator.click: no element matches')
  const { engine, events } = fakeEngine({ error })
  await assert.rejects(engine.perform({ descriptor, validate: async () => {} }), error)
  assert.equal(events[0].healing_attempted, true)
  assert.equal(events[0].healing_successful, false)
  assert.equal(events[0].healing_reason, 'NO_TRUSTED_REFERENCE_FOR_PAGE')
  validateHealingEvent(events[0])
})

test('unsupported actions or missing original assertions are rejected before execution', async () => {
  const { engine, actions } = fakeEngine()
  await assert.rejects(engine.perform({ descriptor, action: 'forceClick', validate: async () => {} }))
  await assert.rejects(engine.perform({ descriptor }))
  assert.equal(actions(), 0)
})

test('a later test failure revokes a locally verified recovery', () => {
  const attachment = { name: 'healing-events', body: Buffer.from(JSON.stringify({ mode: 'ADAPTIVE', events: [event()] })) }
  const result = readHealingResult([attachment], 'FAIL')
  assert.equal(result.healing_successful, false)
  assert.equal(result.healing_reason, 'FINAL_TEST_DID_NOT_PASS')
  assert.equal(result.healing_events[0].original_assertions_passed, true)
})

test('a recovered PASS preserves original failure separately from final failure taxonomy', () => {
  const row = record(summarizeHealing([event()], 'ADAPTIVE'))
  validateRecord(row)
  assert.equal(row.failure_type, null)
  assert.equal(row.original_failure_type, 'LOCATOR_NOT_FOUND')
  assert.equal(row.healing_successful, true)
})

test('invalid confidence, mode, false success and inconsistent summaries are rejected', () => {
  for (const changes of [{ confidence_score: 1.01 }, { original_assertions_passed: false }, { action_completed: false },
    { original_failure_type: 'ASSERTION_MISMATCH' }, { candidate_count: 2 }]) assert.throws(() => validateHealingEvent(event(changes)))
  assert.throws(() => validateRecord(record({ ...summarizeHealing([event()], 'ADAPTIVE'), healing_successful: false })))
  assert.throws(() => validateRecord(record(summarizeHealing([event()], 'BASELINE'))))
})

test('healing history is a synchronized joinable projection with full ranking evidence', t => {
  const directory = temporary(t)
  const row = record(summarizeHealing([event()], 'ADAPTIVE'))
  const store = new HistoryStore(directory)
  store.append(row)
  const projected = JSON.parse(fs.readFileSync(path.join(directory, 'healing-history.json')))
  assert.deepEqual(projected, healingRows([row]))
  assert.equal(projected[0].attempt_id, row.attempt_id)
  assert.equal(fs.readFileSync(path.join(directory, 'healing-history.csv'), 'utf8'), serializeHealingCSV(projected))
  const second = record()
  atomicWrite(store.pending, JSON.stringify([row, second]))
  fs.writeFileSync(path.join(directory, 'healing-history.csv'), 'interrupted')
  assert.equal(store.validate().length, 2)
  assert.equal(fs.readFileSync(path.join(directory, 'healing-history.csv'), 'utf8'), serializeHealingCSV(projected))
})

test('unexplained healing projection corruption is rejected', t => {
  const directory = temporary(t)
  const store = new HistoryStore(directory)
  store.append(record())
  fs.writeFileSync(path.join(directory, 'healing-history.json'), '[]')
  assert.throws(() => store.validate(), /projection is inconsistent/)
})

test('v2 migration preserves every historical field and backs up source bytes', t => {
  const directory = temporary(t)
  const next = record()
  const old = Object.fromEntries(V2_SCHEMA.required.map(key => [key, key === 'schema_version' ? 2 : next[key]]))
  const json = JSON.stringify([old], null, 2) + '\n'
  const store = new HistoryStore(directory)
  fs.writeFileSync(store.json, json); fs.writeFileSync(store.csv, serializeCSV([old]))
  const result = store.migrate()
  assert.equal(fs.readFileSync(path.join(result.backup, 'execution-history.v2.json'), 'utf8'), json)
  const migrated = store.validate()[0]
  for (const key of Object.keys(old).filter(key => key !== 'schema_version')) assert.deepEqual(migrated[key], old[key])
  assert.equal(migrated.healing_mode, 'NONE')
  assert.equal(migrated.healing_attempted, false)
  assert.equal(store.migrate().migrated, 0)
})

test('intelligence groups healing-enabled and ordinary observations separately', () => {
  const result = buildIntelligenceReport([record(), record({ healing_mode: 'ADAPTIVE' })])
  assert.equal(result.tests.length, 2)
  assert.deepEqual(result.tests.map(row => row.healingMode).sort(), ['ADAPTIVE', 'NONE'])
})


test('reporter reads the latest eager snapshot rather than the pending first attachment', () => {
  const pending = event({ healing_successful: false, original_assertions_passed: false, action_completed: false, healing_reason: 'RECOVERY_ACTION_IN_PROGRESS' })
  const attachment = evidence => ({ name: 'healing-events', body: Buffer.from(JSON.stringify({ mode: 'ADAPTIVE', events: [evidence] })) })
  const result = readHealingResult([attachment(pending), attachment(event())], 'PASS')
  assert.equal(result.healing_successful, true)
  assert.equal(result.healing_events.length, 1)
  assert.equal(result.healing_reason, 'RECOVERED_AND_ORIGINAL_ASSERTIONS_PASSED')
})
