import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HistoryStore, atomicWrite } from '../automation/telemetry/history.js'
import { validateHistory } from '../automation/telemetry/schema.js'
import { validateProgression } from '../automation/experiments/progression/run.js'
import { VERSION as PROGRESSION_VERSION, protocolHash } from '../automation/experiments/progression/protocol.js'

export const ML_ROOT = fileURLToPath(new URL('.', import.meta.url))
export const PROJECT_ROOT = path.dirname(ML_ROOT)
export const SPEC = JSON.parse(fs.readFileSync(new URL('./features.json', import.meta.url), 'utf8'))
export const sha256 = data => createHash('sha256').update(data).digest('hex')
const hash = data => sha256(JSON.stringify(data))
const experimental = row => Boolean(row.experiment_id || row.emulated || row.fault_variant || row.locator_mutation || row.fault_type)
const failed = row => ['FAIL', 'TIMED_OUT'].includes(row.status)

export function loadAudit(directory, records) {
  const indexed = new Map(records.map(row => [row.attempt_id, row]))
  const membership = new Map(); const files = []
  const read = file => {
    const bytes = fs.readFileSync(file)
    files.push({ file: path.relative(directory, file), sha256: sha256(bytes) })
    return JSON.parse(bytes)
  }
  for (const runId of [...new Set(records.filter(row => !experimental(row)).map(row => row.run_id))].sort()) {
    const file = path.join(directory, 'runs', runId, 'run.json')
    if (!fs.existsSync(file)) continue
    const manifest = read(file)
    if (!['PASSED', 'FAILED', 'TIMEDOUT'].includes(manifest.status) || !manifest.end_time) continue
    if (manifest.run_id !== runId) throw new Error(`Run identity mismatch: ${file}`)
    for (const row of records.filter(item => item.run_id === runId && !experimental(item) && item.record_type === 'TEST_ATTEMPT')) {
      if (row.app_version !== manifest.app_version || row.test_version !== manifest.test_version || row.end_time > manifest.end_time) throw new Error('Run provenance mismatch')
      membership.set(row.attempt_id, { cohort: 'ordinary', blockId: `run:${runId}`, blockStart: manifest.timestamp, blockEnd: manifest.end_time })
    }
  }
  for (const [folder, name] of [['campaigns', 'campaign.json'], ['healing-evaluations', 'evaluation.json'], ['adaptive-evaluations', 'comparison.json'], ['progression-campaigns', 'campaign.json']]) {
    const root = path.join(directory, folder)
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const manifest = read(path.join(root, entry.name, name))
      if (manifest.status !== 'VERIFIED') continue
      if ((manifest.campaign_id || manifest.evaluation_id) !== entry.name) throw new Error('Experiment manifest identity mismatch')
      const ids = folder === 'adaptive-evaluations' ? [...manifest.training_attempt_ids, ...manifest.heldout_attempt_ids] : manifest.attempt_ids
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || !manifest.completed_at) throw new Error('Incomplete verified manifest')
      if (manifest.expected_rows !== undefined && ids.length !== manifest.expected_rows) throw new Error('Verified manifest row count differs')
      if (folder === 'progression-campaigns') {
        if (manifest.protocol !== PROGRESSION_VERSION || manifest.protocol_sha256 !== protocolHash()) throw new Error('Progression protocol version differs')
        validateProgression(ids.map(id => indexed.get(id)), manifest.seed)
      }
      const runIds = manifest.run_ids || [manifest.run_id, ...(manifest.training_run_ids || []), ...(manifest.heldout_run_ids || [])]
      for (const id of ids) {
        const row = indexed.get(id)
        if (!row || row.record_type !== 'TEST_ATTEMPT' || !experimental(row) || membership.has(id) ||
            row.app_version !== manifest.app_version || row.test_version !== manifest.test_version ||
            !runIds.includes(row.run_id) || row.emulated && !row.injection_verified || row.end_time > manifest.completed_at) throw new Error(`Unverifiable experiment attempt: ${id}`)
        membership.set(id, { cohort: folder === 'progression-campaigns' ? 'progression' : 'controlled', blockId: `${folder}:${entry.name}`, blockStart: manifest.started_at, blockEnd: manifest.completed_at })
      }
    }
  }
  return { membership, files }
}

export function slope(values) {
  if (values.length < 2) return 0
  const center = (values.length - 1) / 2
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return values.reduce((sum, value, i) => sum + (i - center) * (value - mean), 0) /
    values.reduce((sum, _, i) => sum + (i - center) ** 2, 0)
}
export function temporalFeatures(history) {
  const recent = history.slice(-SPEC.short_window_size)
  const durations = recent.map(item => item.duration)
  const middle = Math.max(1, Math.floor(durations.length / 2))
  const mean = values => values.reduce((a,b) => a+b, 0) / values.length
  const older = mean(durations.slice(0, middle)); const newer = mean(durations.slice(middle))
  const streak = value => { let n = 0; for (const item of [...history].reverse()) { if (item.failed !== value) break; n++ } return n }
  const opportunities = recent.filter(item => item.healingAttempted)
  const failures = history.filter(item => item.failed && item.end)
  return { failure_streak: streak(true), pass_streak: streak(false), duration_trend: slope(durations),
    duration_growth_rate: durations.length > 1 ? (newer - older) / Math.max(older, 1) : 0,
    retry_trend: slope(recent.map(item => Number(item.retried))),
    locator_volatility_index: recent.length > 1 ? recent.slice(1).filter((item, i) => item.locatorFailure !== recent[i].locatorFailure).length / (recent.length - 1) : 0,
    healing_reliance_score: opportunities.length / recent.length,
    healing_success_momentum: opportunities.length > 1 ? slope(opportunities.map(item => Number(item.healingSuccessful))) : null,
    mean_time_between_failures: failures.length > 1 ? (Date.parse(failures.at(-1).end) - Date.parse(failures[0].end)) / (failures.length - 1) : null,
    recent_failure_rate: recent.filter(item => item.failed).length / recent.length }
}
export function aggregateHistory(history) {
  if (!history.length) throw new Error('At least one completed historical execution is required')
  const n = history.length
  const fraction = predicate => history.filter(predicate).length / n
  const mean = history.reduce((sum, item) => sum + item.duration, 0) / n
  const failureRate = fraction(item => item.failed)
  const retryRate = fraction(item => item.retried)
  const locatorRate = fraction(item => item.locatorFailure)
  const healing = history.filter(item => item.healingAttempted)
  const learning = history.filter(item => item.learningEnabled && item.healingAttempted)
  return {
    ...temporalFeatures(history), failure_rate: failureRate, retry_rate: retryRate, stability_score: 100 * (1 - failureRate),
    average_duration: mean,
    duration_variance: history.reduce((sum, item) => sum + (item.duration - mean) ** 2, 0) / n,
    locator_failure_rate: locatorRate, actionability_failure_rate: fraction(item => item.actionabilityFailure),
    healing_success_rate: healing.length ? healing.filter(item => item.healingSuccessful).length / healing.length : null,
    knowledge_base_hit_rate: learning.length ? learning.filter(item => item.knowledgeHit).length / learning.length : null,
    risk_score: 100 * (0.60 * failureRate + 0.25 * retryRate + 0.15 * locatorRate),
  }
}

export function buildDataset(records, audit, { asOf = new Date().toISOString(), windowSize = SPEC.window_size, minimumHistory = SPEC.minimum_history } = {}) {
  validateHistory(records)
  if (!Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString() !== asOf || !Number.isInteger(windowSize) || !Number.isInteger(minimumHistory) || minimumHistory < 1 || windowSize < minimumHistory) throw new Error('Invalid dataset policy')
  const exclusions = { runErrors: 0, unauditedAttempts: 0, incompleteExecutions: 0, expectedNonPass: 0, futureOrUnfinishedExecutions: 0, coldStartExecutions: 0 }
  const attempts = new Map()
  for (const row of records) {
    if (row.record_type !== 'TEST_ATTEMPT') { exclusions.runErrors++; continue }
    if (!audit.membership.has(row.attempt_id)) { exclusions.unauditedAttempts++; continue }
    const key = JSON.stringify([row.run_id, row.test_id, row.project_name, row.browser, row.repeat_index])
    if (!attempts.has(key)) attempts.set(key, [])
    attempts.get(key).push(row)
  }
  const series = new Map()
  for (const [key, rows] of attempts) {
    rows.sort((a, b) => a.retry_count - b.retry_count)
    const first = rows[0]; const last = rows.at(-1)
    const source = audit.membership.get(first.attempt_id)
    const identity = { cohort: source.cohort, test_id: first.test_id, suite_name: first.suite_name,
      browser: first.browser, project_name: first.project_name, app_version: first.app_version,
      healing_mode: first.healing_mode || 'NONE', learningEnabled: first.learningEnabled || false }
    const inconsistent = rows.some((row, index) => row.retry_count !== index || !['PASS', 'FAIL', 'TIMED_OUT'].includes(row.status) ||
      index > 0 && (!failed(rows[index - 1]) || row.start_time < rows[index - 1].end_time) ||
      audit.membership.get(row.attempt_id).blockId !== source.blockId ||
      Object.entries(identity).some(([field, value]) => field !== 'cohort' && (row[field] ?? (field === 'learningEnabled' ? false : 'NONE')) !== value))
    if (inconsistent) { exclusions.incompleteExecutions++; continue }
    if (rows.some(row => row.expected_status !== 'PASS')) { exclusions.expectedNonPass++; continue }
    const end = rows.map(row => row.end_time).sort().at(-1)
    if (end >= asOf || source.blockEnd >= asOf) { exclusions.futureOrUnfinishedExecutions++; continue }
    if (!source.blockStart || !source.blockEnd || source.blockStart > first.start_time || source.blockEnd < end) throw new Error('Invalid audit time boundaries')
    const id = hash(key)
    const execution = { id, identity, seriesId: hash(source.cohort === 'progression' ? [identity, source.blockId] : identity), source, start: first.start_time, end,
      attempts: rows.map(row => row.attempt_id), name: last.test_name, failed: failed(last), retried: rows.length > 1,
      duration: rows.reduce((sum, row) => sum + row.duration_ms, 0),
      locatorFailure: rows.some(row => ['LOCATOR_NOT_FOUND', 'LOCATOR_AMBIGUOUS'].includes(row.failure_type) || ['LOCATOR_NOT_FOUND', 'LOCATOR_AMBIGUOUS'].includes(row.original_failure_type)),
      actionabilityFailure: rows.some(row => row.failure_type === 'ACTIONABILITY_FAILURE' || row.original_failure_type === 'ACTIONABILITY_FAILURE'),
      healingAttempted: rows.some(row => row.healing_attempted), healingSuccessful: !failed(last) && Boolean(last.healing_successful),
      learningEnabled: identity.learningEnabled, knowledgeHit: rows.some(row => row.knowledgeBaseHit) }
    if (!series.has(execution.seriesId)) series.set(execution.seriesId, [])
    series.get(execution.seriesId).push(execution)
  }
  const samples = []; const forecasts = []; const quality = {}
  for (const [seriesId, executions] of [...series].sort(([a], [b]) => a.localeCompare(b))) {
    executions.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    for (const target of executions) {
      const history = executions.filter(item => item.id !== target.id && item.end < target.start)
        .sort((a, b) => a.end.localeCompare(b.end) || a.id.localeCompare(b.id)).slice(-windowSize)
      if (history.length < minimumHistory) { exclusions.coldStartExecutions++; continue }
      samples.push({ sample_id: hash([seriesId, target.id]), series_id: seriesId, cohort: target.identity.cohort,
        block_id: target.source.blockId, block_start_time: target.source.blockStart, block_end_time: target.source.blockEnd,
        test_id: target.identity.test_id, test_name: target.name, browser: target.identity.browser, project_name: target.identity.project_name,
        healing_mode: target.identity.healing_mode, learning_enabled: target.identity.learningEnabled, app_version: target.identity.app_version,
        prediction_time: target.start, target_end_time: target.end, history_end_time: history.at(-1).end, history_count: history.length,
        history_execution_ids: history.map(item => item.id), target_execution_id: target.id, target_attempt_ids: target.attempts,
        last_prior_failed: Number(history.at(-1).failed), ...aggregateHistory(history), next_execution_failed: Number(target.failed) })
    }
    const history = executions.filter(item => item.end < asOf).sort((a, b) => a.end.localeCompare(b.end) || a.id.localeCompare(b.id)).slice(-windowSize)
    if (history.length >= minimumHistory) forecasts.push({ series_id: seriesId, cohort: history.at(-1).identity.cohort,
      test_id: history.at(-1).identity.test_id, test_name: history.at(-1).name, browser: history.at(-1).identity.browser,
      project_name: history.at(-1).identity.project_name, healing_mode: history.at(-1).identity.healing_mode,
      learning_enabled: history.at(-1).identity.learningEnabled, app_version: history.at(-1).identity.app_version,
      history_count: history.length, history_end_time: history.at(-1).end, prediction_time: asOf, features: aggregateHistory(history) })
    const cohort = executions[0].identity.cohort
    quality[cohort] ||= { executions: 0, series: 0, seriesWithOutcomeVariation: 0 }
    quality[cohort].executions += executions.length; quality[cohort].series++
    if (new Set(executions.map(item => item.failed)).size > 1) quality[cohort].seriesWithOutcomeVariation++
  }
  samples.sort((a, b) => a.prediction_time.localeCompare(b.prediction_time) || a.sample_id.localeCompare(b.sample_id))
  for (const [cohort, value] of Object.entries(quality)) {
    const rows = samples.filter(row => row.cohort === cohort)
    value.samples = rows.length
    value.classCounts = { '0': rows.filter(row => row.next_execution_failed === 0).length, '1': rows.filter(row => row.next_execution_failed === 1).length }
    value.blocks = new Set(rows.map(row => row.block_id)).size
  }
  return { samples, forecasts, quality, exclusions, asOf, windowSize, minimumHistory,
    lineage: [...series.values()].flat().map(item => ({ id: item.id, series_id: item.seriesId, start: item.start, end: item.end,
      attempts: item.attempts, failed: item.failed, retried: item.retried, duration: item.duration, locatorFailure: item.locatorFailure,
      actionabilityFailure: item.actionabilityFailure, healingAttempted: item.healingAttempted, healingSuccessful: item.healingSuccessful,
      learningEnabled: item.learningEnabled, knowledgeHit: item.knowledgeHit })).sort((a, b) => a.id.localeCompare(b.id)) }
}

export const METADATA_COLUMNS = ['sample_id', 'series_id', 'cohort', 'block_id', 'block_start_time', 'block_end_time', 'test_id', 'test_name', 'browser', 'project_name', 'healing_mode', 'learning_enabled', 'app_version', 'prediction_time', 'target_end_time', 'history_end_time', 'history_count', 'history_execution_ids', 'target_execution_id', 'target_attempt_ids', 'last_prior_failed']
export const COLUMNS = [...METADATA_COLUMNS, ...SPEC.feature_order, SPEC.target]
export function serializeSamples(samples) {
  const cell = value => {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return [COLUMNS.join(','), ...samples.map(row => COLUMNS.map(key => cell(row[key])).join(','))].join('\r\n') + '\r\n'
}

export function generateDataset({ directory = process.env.TELEMETRY_DIR || path.join(PROJECT_ROOT, 'dataset'), output = ML_ROOT, asOf = new Date().toISOString() } = {}) {
  const records = new HistoryStore(directory).validate()
  const audit = loadAudit(directory, records)
  const result = buildDataset(records, audit, { asOf })
  const buildId = randomUUID(); const root = path.join(output, 'datasets', buildId)
  const specBytes = fs.readFileSync(new URL('./features.json', import.meta.url))
  const csv = serializeSamples(result.samples)
  const inputs = JSON.stringify({ schema_version: 1, as_of: asOf, feature_spec_sha256: sha256(specBytes), forecasts: result.forecasts }, null, 2) + '\n'
  const lineage = JSON.stringify(result.lineage, null, 2) + '\n'
  const manifest = { schema_version: 1, build_id: buildId, generated_at: new Date().toISOString(), as_of: asOf,
    feature_spec_sha256: sha256(specBytes), dataset_builder_sha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))), source_records_sha256: hash(records), source_records: records.length,
    source_audits: audit.files, window_size: result.windowSize, minimum_history: result.minimumHistory,
    exclusions: result.exclusions, quality: result.quality, samples: result.samples.length,
    execution_lineage_sha256: sha256(lineage), training_data_sha256: sha256(csv), prediction_input_sha256: sha256(inputs), feature_order: SPEC.feature_order,
    csv_columns: COLUMNS, limitations: SPEC.limitations }
  atomicWrite(path.join(root, 'execution-lineage.json'), lineage)
  atomicWrite(path.join(root, 'training-data.csv'), csv)
  atomicWrite(path.join(root, 'prediction-input.json'), inputs)
  atomicWrite(path.join(root, 'dataset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  // User-friendly copies; training always reads the immutable snapshot referenced
  // by latest-dataset.json and verifies both hashes before consuming it.
  atomicWrite(path.join(output, 'training-data.csv'), csv)
  atomicWrite(path.join(output, 'prediction-input.json'), inputs)
  atomicWrite(path.join(output, 'latest-dataset.json'), JSON.stringify({ build_id: buildId,
    directory: `datasets/${buildId}`, manifest_sha256: sha256(JSON.stringify(manifest, null, 2) + '\n') }, null, 2) + '\n')
  return { root, manifest }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const result = generateDataset(); console.log(JSON.stringify({ output: result.root, quality: result.manifest.quality, exclusions: result.manifest.exclusions }, null, 2)) }
  catch (error) { console.error(`Dataset generation failed: ${error.message}`); process.exitCode = 1 }
}
