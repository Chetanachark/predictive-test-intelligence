import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { KnowledgeBase, canonical, learningScope } from './knowledgeBase.js'
import { HistoryStore } from '../telemetry/history.js'
import { PROJECT_ROOT } from '../telemetry/metadata.js'

export function feedbackObservations(records, { verifiedAttemptIds = new Set() } = {}) {
  const observations = []
  for (const row of records) {
    if (row.record_type !== 'TEST_ATTEMPT' || !row.learningEnabled || row.expected_status !== 'PASS' ||
        !['PASS', 'FAIL'].includes(row.status) || row.failure_phase !== 'test' || row.runtime_errors.length) continue
    const experimental = Boolean(row.experiment_id || row.emulated || row.fault_variant || row.locator_mutation || row.fault_type)
    if (experimental && !verifiedAttemptIds.has(row.attempt_id)) continue
    for (const event of row.healing_events) {
      // Refusals and pre-action identity changes have no executed candidate to
      // learn from. Interrupted/pending actions are unknown, not negative labels.
      if (!event.learningEnabled || !event.healing_attempted || !event.candidate_locator || !event.learningScope ||
          !event.action_completed && event.healing_reason !== 'RECOVERY_ACTION_FAILED') continue
      const expectedScope = learningScope({ appVersion: row.app_version, browser: row.browser }, event.reference, event.learningScope.action)
      if (canonical(expectedScope) !== canonical(event.learningScope)) throw new Error('Feedback scope disagrees with finalized telemetry')
      const successful = row.status === 'PASS' && event.healing_successful && event.original_assertions_passed
      observations.push({ scope: event.learningScope, originalLocator: JSON.parse(event.original_locator),
        candidateLocator: JSON.parse(event.candidate_locator), observation: {
          operationId: event.operation_id, attemptId: row.attempt_id, runId: row.run_id, successful,
          endTime: row.end_time, testVersion: row.test_version, source: experimental ? 'verified-experiment' : 'ordinary',
        } })
    }
  }
  return observations
}

export function applyFeedback(records, { file, verifiedAttemptIds } = {}) {
  if (!file) throw new Error('Feedback requires an explicit knowledge-base file')
  return new KnowledgeBase(file).apply(feedbackObservations(records, { verifiedAttemptIds }))
}

export function syncFeedback(directory) {
  const store = new HistoryStore(directory)
  const records = store.validate()
  const accepted = new Set()
  const root = path.join(directory, 'adaptive-evaluations')
  if (fs.existsSync(root)) for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'comparison.json'), 'utf8'))
    if (manifest.status === 'VERIFIED' && manifest.evaluation_id === entry.name) {
      if (!Array.isArray(manifest.training_attempt_ids) || !Array.isArray(manifest.heldout_attempt_ids) ||
          new Set(manifest.training_attempt_ids).size !== manifest.training_attempt_ids.length ||
          manifest.training_attempt_ids.some(id => manifest.heldout_attempt_ids.includes(id))) throw new Error('Invalid training/held-out feedback split')
      for (const id of manifest.training_attempt_ids) {
        const row = records.find(item => item.attempt_id === id)
        const trainingNote = row?.notes.split('\n').some(line => {
          try { return JSON.parse(line).learning_evaluation?.phase === 'training' }
          catch { return false }
        })
        if (!row || row.project_name !== 'training' || !trainingNote || row.app_version !== manifest.app_version || row.test_version !== manifest.test_version) throw new Error('Unverifiable training feedback membership')
        accepted.add(id)
      }
    }
  }
  return applyFeedback(records, { file: path.join(directory, 'knowledge-base.json'), verifiedAttemptIds: accepted })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const directory = path.resolve(process.env.TELEMETRY_DIR || path.join(PROJECT_ROOT, 'dataset'))
    console.log(JSON.stringify(syncFeedback(directory), null, 2))
  }
  catch (error) { console.error(`Feedback failed: ${error.message}`); process.exitCode = 1 }
}
