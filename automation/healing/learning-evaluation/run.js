import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { HistoryStore, atomicWrite } from '../../telemetry/history.js'
import { AUTOMATION_ROOT, PROJECT_ROOT, createRunMetadata } from '../../telemetry/metadata.js'
import { KnowledgeBase } from '../knowledgeBase.js'
import { applyFeedback } from '../feedbackLoop.js'
import { ADAPTIVE_POLICY } from '../adaptiveRanking.js'
import { validateTraining, validateComparison, comparisonMetrics, comparisonHTML } from './metrics.js'

let manifest; let file
try {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--repeat')) throw new Error('Usage: npm run healing:compare -- [--repeat 1..20]')
  const repetitions = args.length ? Number(args[1]) : 2
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error('Invalid repetitions')
  const directory = path.resolve(process.env.TELEMETRY_DIR || path.join(PROJECT_ROOT, 'dataset'))
  const store = new HistoryStore(directory)
  const migration = store.migrate()
  if (migration.migrated) console.log(`Migrated ${migration.migrated} rows; backup: ${migration.backup}`)
  const before = new Set(store.validate().map(row => row.attempt_id))
  const source = createRunMetadata({ workers: 1 })
  const id = randomUUID()
  file = path.join(directory, 'adaptive-evaluations', id, 'comparison.json')
  const knowledgeFile = path.join(path.dirname(file), 'knowledge-base.json')
  const knowledge = new KnowledgeBase(knowledgeFile)
  const empty = knowledge.initialize()
  manifest = { evaluation_id: id, status: 'RUNNING', started_at: new Date().toISOString(), repetitions,
    training_repetitions: 2, policy: ADAPTIVE_POLICY, app_version: source.app_version, test_version: source.test_version,
    training_attempt_ids: [], heldout_attempt_ids: [] }
  const save = () => atomicWrite(file, JSON.stringify(manifest, null, 2) + '\n')
  save()
  async function execute(config, repeat) {
    const child = spawn(process.execPath, [path.join(AUTOMATION_ROOT, 'node_modules/@playwright/test/cli.js'),
      'test', '--config', config, `--repeat-each=${repeat}`], { cwd: AUTOMATION_ROOT, stdio: 'inherit',
      env: { ...process.env, TELEMETRY_DIR: directory, HEALING_KNOWLEDGE_BASE: knowledgeFile, HEALING_FEEDBACK: 'off' } })
    return new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
  }
  console.log('Teaching phase: actual successful and failed recoveries. No held-out feedback is permitted.')
  const trainingExit = await execute('healing/learning-evaluation/training.config.js', 2)
  const training = store.validate().filter(row => !before.has(row.attempt_id))
  manifest.training_attempt_ids = training.map(row => row.attempt_id)
  save()
  validateTraining(training, 2, empty.version)
  if (trainingExit.code !== 1 || trainingExit.signal) throw new Error('Unexpected teaching-phase termination')
  const teachingFeedback = applyFeedback(training, { file: knowledgeFile, verifiedAttemptIds: new Set(manifest.training_attempt_ids) })
  if (teachingFeedback.added !== 4) throw new Error('Teaching feedback did not record four unique recovery outcomes')
  const trained = knowledge.snapshot()
  const frozenBytes = fs.readFileSync(knowledgeFile)
  const frozenSHA = createHash('sha256').update(frozenBytes).digest('hex')
  Object.assign(manifest, { knowledge_version: trained.version, frozen_knowledge_sha256: frozenSHA, teaching_feedback: teachingFeedback })
  save()
  const trainingIDs = new Set(manifest.training_attempt_ids)
  console.log('Held-out phase: both arms heal; only adaptive healing reads the frozen historical outcomes.')
  const heldoutExit = await execute('healing/learning-evaluation/comparison.config.js', repetitions)
  const heldout = store.validate().filter(row => !before.has(row.attempt_id) && !trainingIDs.has(row.attempt_id))
  manifest.heldout_attempt_ids = heldout.map(row => row.attempt_id)
  save()
  validateComparison(heldout, repetitions, trained.version)
  if (heldoutExit.code !== 1 || heldoutExit.signal) throw new Error('Unexpected comparison termination')
  if (!fs.readFileSync(knowledgeFile).equals(frozenBytes)) throw new Error('Knowledge changed during held-out evaluation')
  const after = createRunMetadata({ workers: 1 })
  if (source.app_version !== after.app_version || source.test_version !== after.test_version) throw new Error('Sources changed during evaluation')
  Object.assign(manifest, { status: 'VERIFIED', completed_at: new Date().toISOString(), metrics: comparisonMetrics(heldout),
    training_run_ids: [...new Set(training.map(row => row.run_id))], heldout_run_ids: [...new Set(heldout.map(row => row.run_id))] })
  save()
  // Publish only audited teacher outcomes to the reusable project knowledge base.
  // Held-out rows remain excluded even after the comparison completes.
  manifest.published_feedback = applyFeedback(training, { file: path.join(directory, 'knowledge-base.json'), verifiedAttemptIds: trainingIDs })
  save()
  atomicWrite(path.join(path.dirname(file), 'comparison.html'), comparisonHTML(manifest))
  atomicWrite(path.join(directory, 'adaptive-evaluations/latest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Adaptive comparison VERIFIED\n${file}\n${JSON.stringify(manifest.metrics.arms, null, 2)}`)
} catch (error) {
  if (manifest && file) {
    if (manifest.status !== 'VERIFIED') manifest.status = 'INVALID'
    manifest.error = error.message
    atomicWrite(file, JSON.stringify(manifest, null, 2) + '\n')
  }
  console.error(`Adaptive comparison failed: ${error.message}`)
  process.exitCode = 1
}
