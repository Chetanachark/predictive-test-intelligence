import { FAILURE_TYPES } from './taxonomy.js'

const text = { type: 'string' }
const requiredText = { type: 'string', minLength: 1 }
const date = { type: 'string', format: 'date-time' }
const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }
const path = { type: ['string', 'null'], pattern: '^artifacts/[A-Za-z0-9_./-]+$' }
const statuses = ['PASS', 'FAIL', 'TIMED_OUT', 'SKIPPED', 'INTERRUPTED']

export const RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Playwright execution telemetry v1',
  type: 'object',
  additionalProperties: false,
  properties: {
    schema_version: { const: 1 },
    record_type: { enum: ['TEST_ATTEMPT', 'RUN_ERROR'] },
    run_id: uuid,
    attempt_id: uuid,
    test_id: requiredText,
    test_name: requiredText,
    suite_name: requiredText,
    browser: requiredText,
    status: { enum: statuses },
    failure_type: { enum: [null, ...FAILURE_TYPES] },
    duration_ms: { type: 'number', minimum: 0 },
    retry_count: { type: 'integer', minimum: 0 },
    start_time: date,
    end_time: date,
    app_version: requiredText,
    test_version: requiredText,
    trace_path: path,
    screenshot_path: path,
    notes: text,
    framework_version: requiredText,
    playwright_version: requiredText,
    timestamp: date,
    environment: {
      type: 'object', additionalProperties: false,
      required: ['node_version', 'platform', 'architecture', 'os_release', 'hostname', 'ci', 'workers', 'git_commit'],
      properties: {
        node_version: requiredText, platform: requiredText, architecture: requiredText,
        os_release: requiredText, hostname: requiredText, ci: { type: 'boolean' },
        workers: { type: 'integer', minimum: 0 }, git_commit: requiredText,
      },
    },
    locator_mutation: text,
    fault_variant: text,
    experiment_id: text,
    scenario_variant: text,
    expected_status: { enum: statuses },
    classification_source: { enum: ['NONE', 'ANNOTATION', 'HEURISTIC', 'UNKNOWN'] },
    failure_phase: { enum: ['test', 'setup', 'teardown', 'run'] },
    error_message: text,
    error_stack: text,
    runtime_errors: { type: 'array', items: text },
    project_name: requiredText,
    worker_index: { type: 'integer', minimum: -1 },
    repeat_index: { type: 'integer', minimum: 0 },
  },
}
RECORD_SCHEMA.required = Object.keys(RECORD_SCHEMA.properties)
export const CSV_COLUMNS = Object.freeze([...RECORD_SCHEMA.required])

function validateValue(value, schema, name) {
  if ('const' in schema && value !== schema.const) throw new Error(`${name}: invalid constant`)
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${name}: invalid value ${value}`)
  const types = schema.type ? [].concat(schema.type) : []
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (types.length && !types.some(expected => expected === type || (expected === 'integer' && Number.isInteger(value)))) {
    throw new Error(`${name}: expected ${types.join('|')}`)
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity))) {
    throw new Error(`${name}: invalid number`)
  }
  if (typeof value === 'string') {
    if (value.length < (schema.minLength ?? 0)) throw new Error(`${name}: empty value`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`${name}: invalid format`)
    if (schema.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)) {
      throw new Error(`${name}: expected UTC ISO timestamp`)
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => validateValue(item, schema.items, `${name}[${index}]`))
  if (schema.properties) {
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) throw new Error(`${name}.${key}: required`)
      validateValue(value[key], schema.properties[key], `${name}.${key}`)
    }
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) {
      throw new Error(`${name}: unknown field`)
    }
  }
}

export function validateRecord(record) {
  validateValue(record, RECORD_SCHEMA, 'record')
  const successful = ['PASS', 'SKIPPED'].includes(record.status)
  if (successful !== (record.failure_type === null)) throw new Error('status and failure_type are inconsistent')
  if ((record.failure_type === null) !== (record.classification_source === 'NONE')) throw new Error('classification_source is inconsistent')
  const elapsed = Date.parse(record.end_time) - Date.parse(record.start_time)
  if (elapsed < 0 || Math.abs(elapsed - record.duration_ms) > 1) throw new Error('duration and timestamps are inconsistent')
  for (const key of ['trace_path', 'screenshot_path']) {
    if (record[key]?.split('/').includes('..')) throw new Error(`${key}: unsafe path`)
  }
  const environment = record.environment
  for (const key of ['node_version', 'platform', 'architecture', 'os_release', 'hostname']) {
    if (typeof environment[key] !== 'string' || !environment[key]) throw new Error(`environment.${key}: required`)
  }
  if (record.record_type === 'RUN_ERROR' && (record.test_id !== '__RUN__' || record.failure_phase !== 'run')) {
    throw new Error('RUN_ERROR must use the run-level identity and phase')
  }
  // Environment and notes must remain serializable and reproducible in CSV.
  JSON.stringify(record)
  return record
}

export function validateHistory(records) {
  if (!Array.isArray(records)) throw new Error('History must be a JSON array')
  const ids = new Set()
  for (const record of records) {
    validateRecord(record)
    if (ids.has(record.attempt_id)) throw new Error(`Duplicate attempt_id: ${record.attempt_id}`)
    ids.add(record.attempt_id)
  }
  return records
}
