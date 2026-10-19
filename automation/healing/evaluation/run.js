import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { HistoryStore, atomicWrite } from '../../telemetry/history.js'
import { AUTOMATION_ROOT, PROJECT_ROOT, createRunMetadata } from '../../telemetry/metadata.js'
import { EVALUATION_CASES } from './registry.js'
import { validateEvaluation, evaluationMetrics } from './metrics.js'

let manifest
let file
try {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--repeat')) throw new Error('Usage: npm run healing:evaluate -- [--repeat 1..20]')
  const repetitions = args.length ? Number(args[1]) : 2
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error('Invalid repetitions')
  const directory = path.resolve(process.env.TELEMETRY_DIR || path.join(PROJECT_ROOT, 'dataset'))
  const store = new HistoryStore(directory)
  const migration = store.migrate()
  if (migration.migrated) console.log(`Migrated ${migration.migrated} rows; originals backed up at ${migration.backup}`)
  const before = new Set(store.validate().map(row => row.attempt_id))
  const source = createRunMetadata({ workers: 1 })
  const id = randomUUID()
  file = path.join(directory, 'healing-evaluations', id, 'evaluation.json')
  manifest = { evaluation_id: id, status: 'RUNNING', started_at: new Date().toISOString(), repetitions,
    expected_rows: EVALUATION_CASES.length * 2 * repetitions, app_version: source.app_version, test_version: source.test_version }
  atomicWrite(file, JSON.stringify(manifest, null, 2) + '\n')
  console.log('Expected faults remain real Playwright failures. The evaluation command verifies paired outcomes separately.')
  const child = spawn(process.execPath, [path.join(AUTOMATION_ROOT, 'node_modules/@playwright/test/cli.js'),
    'test', '--config', 'healing/playwright.config.js', `--repeat-each=${repetitions}`],
    { cwd: AUTOMATION_ROOT, stdio: 'inherit', env: { ...process.env, TELEMETRY_DIR: directory } })
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const rows = store.validate().filter(row => !before.has(row.attempt_id))
  manifest.attempt_ids = rows.map(row => row.attempt_id)
  manifest.run_ids = [...new Set(rows.map(row => row.run_id))]
  manifest.playwright_exit_code = exit.code
  validateEvaluation(rows, repetitions)
  const after = createRunMetadata({ workers: 1 })
  if (source.app_version !== after.app_version || source.test_version !== after.test_version) throw new Error('Sources changed during evaluation')
  if (exit.signal || exit.code !== 1) throw new Error('Unexpected Playwright termination')
  const metrics = evaluationMetrics(rows)
  Object.assign(manifest, { status: 'VERIFIED', completed_at: new Date().toISOString(), metrics })
  atomicWrite(file, JSON.stringify(manifest, null, 2) + '\n')
  atomicWrite(path.join(directory, 'healing-evaluations/latest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Healing evaluation VERIFIED\n${file}\n${JSON.stringify(metrics, null, 2)}`)
} catch (error) {
  if (manifest && file) {
    Object.assign(manifest, { status: 'INVALID', completed_at: new Date().toISOString(), error: error.message })
    atomicWrite(file, JSON.stringify(manifest, null, 2) + '\n')
  }
  console.error(`Healing evaluation failed: ${error.message}`)
  process.exitCode = 1
}
