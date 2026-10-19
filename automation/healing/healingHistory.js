import { HEALING_POLICY } from './confidenceScore.js'
import { FAILURE_TYPES } from '../telemetry/taxonomy.js'

export const HEALING_DEFAULTS = Object.freeze({
  healing_mode: 'NONE', healing_attempted: false, healing_successful: false,
  original_locator: '', candidate_locator: '', candidate_count: 0, confidence_score: 0,
  healing_duration_ms: 0, healing_reason: '', original_failure_type: null, healing_events: Object.freeze([]),
})
export const HEALING_FIELDS = Object.freeze(Object.keys(HEALING_DEFAULTS))
const eventKeys = ['operation_id', 'healing_mode', 'healing_attempted', 'healing_successful', 'original_locator',
  'candidate_locator', 'candidate_count', 'confidence_score', 'healing_duration_ms', 'healing_reason',
  'original_failure_type', 'original_error', 'original_assertions_passed', 'action_completed', 'action_duration_ms',
  'total_duration_ms', 'reference', 'candidates', 'policy_version']
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function validateHealingEvent(event) {
  if (!event || Object.keys(event).length !== eventKeys.length || eventKeys.some(key => !Object.hasOwn(event, key))) throw new Error('Incomplete healing event')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(event.operation_id) || !['BASELINE', 'ADAPTIVE'].includes(event.healing_mode)) throw new Error('Invalid healing identity/mode')
  for (const field of ['healing_attempted', 'healing_successful', 'original_assertions_passed', 'action_completed']) if (typeof event[field] !== 'boolean') throw new Error(`Invalid ${field}`)
  for (const field of ['original_locator', 'candidate_locator', 'healing_reason', 'original_error', 'policy_version']) if (typeof event[field] !== 'string') throw new Error(`Invalid ${field}`)
  if (!event.original_locator || !event.healing_reason || !event.policy_version) throw new Error('Healing evidence is missing')
  if (!Number.isInteger(event.candidate_count) || event.candidate_count < 0 || event.candidate_count > HEALING_POLICY.maxCandidates || !Array.isArray(event.candidates) || event.candidates.length !== event.candidate_count) throw new Error('Invalid candidate count')
  for (const field of ['confidence_score', 'healing_duration_ms', 'action_duration_ms', 'total_duration_ms']) if (!finite(event[field])) throw new Error(`Invalid ${field}`)
  if (event.confidence_score > 1 || ![null, ...FAILURE_TYPES].includes(event.original_failure_type)) throw new Error('Invalid confidence or failure type')
  if (event.healing_attempted && (event.healing_mode !== 'ADAPTIVE' || !['LOCATOR_NOT_FOUND', 'LOCATOR_AMBIGUOUS'].includes(event.original_failure_type))) throw new Error('Only locator failures may trigger healing')
  if (event.healing_successful && (!event.healing_attempted || !event.original_assertions_passed || !event.action_completed || !event.candidate_locator)) throw new Error('Unverified healing success')
  if (!event.healing_attempted && (event.candidate_count || event.candidate_locator || event.confidence_score || event.healing_duration_ms)) throw new Error('Non-healing event contains recovery evidence')
  if (event.healing_successful && (event.confidence_score < HEALING_POLICY.threshold || !event.candidates.some(candidate => candidate.eligible && JSON.stringify(candidate.descriptor) === event.candidate_locator && candidate.confidence === event.confidence_score))) throw new Error('Successful recovery lacks selected candidate evidence')
  if (!event.reference || typeof event.reference !== 'object') throw new Error('Missing reference evidence')
  for (const candidate of event.candidates) {
    if (!finite(candidate.confidence) || candidate.confidence > 1 || typeof candidate.eligible !== 'boolean' || !candidate.features || !candidate.signals || !Array.isArray(candidate.discoveredBy)) throw new Error('Invalid candidate evidence')
    if (Object.values(candidate.signals).some(value => value !== null && (!finite(value) || value > 1))) throw new Error('Invalid ranking signal')
  }
  return event
}

export function summarizeHealing(events, mode = 'NONE') {
  if (!events.length) return { ...HEALING_DEFAULTS, healing_mode: mode, healing_events: [] }
  events.forEach(validateHealingEvent)
  const selected = events.findLast(event => event.healing_attempted) || events.at(-1)
  return {
    healing_mode: mode, healing_attempted: events.some(event => event.healing_attempted),
    healing_successful: events.some(event => event.healing_attempted) && events.filter(event => event.healing_attempted).every(event => event.healing_successful),
    original_locator: selected.original_locator, candidate_locator: selected.candidate_locator,
    candidate_count: selected.candidate_count, confidence_score: selected.confidence_score,
    healing_duration_ms: events.reduce((sum, event) => sum + event.healing_duration_ms, 0),
    healing_reason: selected.healing_reason, original_failure_type: selected.original_failure_type,
    healing_events: events,
  }
}

export function validateHealingFields(row) {
  if (row.healing_events.some(event => event.healing_mode !== row.healing_mode)) throw new Error('Mixed healing modes in telemetry')
  row.healing_events.forEach(validateHealingEvent)
  const summary = summarizeHealing(row.healing_events, row.healing_mode)
  for (const field of HEALING_FIELDS) if (JSON.stringify(row[field]) !== JSON.stringify(summary[field])) throw new Error(`Inconsistent healing summary: ${field}`)
  if (row.healing_successful && row.status !== 'PASS') throw new Error('A failing test cannot be a successful recovery')
}

export function healingRows(records) {
  return records.flatMap(row => (row.healing_events || []).map(event => ({
    run_id: row.run_id, attempt_id: row.attempt_id, test_id: row.test_id, test_name: row.test_name,
    browser: row.browser, status: row.status, experiment_id: row.experiment_id, scenario_variant: row.scenario_variant,
    fault_variant: row.fault_variant, app_version: row.app_version, test_version: row.test_version,
    trace_path: row.trace_path, screenshot_path: row.screenshot_path, ...event,
  })))
}
export const HEALING_COLUMNS = ['run_id', 'attempt_id', 'test_id', 'test_name', 'browser', 'status', 'experiment_id', 'scenario_variant',
  'fault_variant', 'app_version', 'test_version', 'trace_path', 'screenshot_path', ...eventKeys]
export function serializeHealingCSV(rows) {
  const cell = value => {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return [HEALING_COLUMNS.join(','), ...rows.map(row => HEALING_COLUMNS.map(key => cell(row[key])).join(','))].join('\r\n') + '\r\n'
}
