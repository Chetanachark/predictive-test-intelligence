import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { HistoryStore, atomicWrite } from '../telemetry/history.js'
import { AUTOMATION_ROOT, PROJECT_ROOT, createRunMetadata } from '../telemetry/metadata.js'
import { EXPERIMENTS } from './registry.js'
import { validateCampaign } from './campaign.js'

const groups = {
  baseline: 'S4-BASE-', 'locator-mutation': 'S4-LOC-', 'assertion-mutation': 'S4-ASSERT-',
  'state-mutation': 'S4-STATE-', 'timeout-mutation': 'S4-ACTION-',
}
let group = null
let repetitions = 1
try {
  const args = process.argv.slice(2)
  while (args.length) {
    const option = args.shift()
    if (option === '--group') {
      group = args.shift()
      if (!Object.hasOwn(groups, group)) throw new Error(`Unknown group: ${group}`)
    } else if (option === '--repeat') {
      repetitions = Number(args.shift())
      if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error('--repeat must be an integer from 1 to 100')
    } else throw new Error(`Unknown option: ${option}`)
  }
  const definitions = EXPERIMENTS.filter(item => !group || item.kind === 'none' || item.id.startsWith(groups[group]))
  const directory = path.resolve(process.env.TELEMETRY_DIR || path.join(PROJECT_ROOT, 'dataset'))
  const store = new HistoryStore(directory)
  const migration = store.migrate()
  if (migration.migrated) console.log(`Migrated ${migration.migrated} existing records; backup: ${migration.backup}`)
  const before = store.validate()
  const beforeIDs = new Set(before.map(row => row.attempt_id))
  const sourceBefore = createRunMetadata({ workers: 1 })
  const id = randomUUID()
  const file = path.join(directory, 'campaigns', id, 'campaign.json')
  const manifest = {
    campaign_id: id, started_at: new Date().toISOString(), status: 'RUNNING',
    group: group || 'all', repetitions, expected_rows: definitions.length * repetitions,
    experiments: definitions.map(item => ({ id: item.id, variant: item.variant, version: item.version })),
  }
  atomicWrite(file, JSON.stringify(manifest, null, 2) + '\n')
  const command = [path.join(AUTOMATION_ROOT, 'node_modules/@playwright/test/cli.js'), 'test',
    '--config', 'experiments/playwright.config.js', `--repeat-each=${repetitions}`]
  if (group) command.push('baseline', ...(group === 'baseline' ? [] : [group]))
  console.log('Injected faults deliberately fail the healthy test oracles. Campaign validation checks these failures separately.')
  const child = spawn(process.execPath, command, { cwd: AUTOMATION_ROOT, stdio: 'inherit', env: { ...process.env, TELEMETRY_DIR: directory } })
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  try {
    const after = store.validate()
    const newRows = after.filter(row => !beforeIDs.has(row.attempt_id))
    const selectedIDs = new Set(definitions.map(item => item.id))
    const rows = newRows.filter(row => selectedIDs.has(row.experiment_id))
    Object.assign(manifest, {
      attempt_ids: rows.map(row => row.attempt_id),
      run_ids: [...new Set(rows.map(row => row.run_id))],
      unattributed_error_ids: newRows.filter(row => row.record_type === 'RUN_ERROR').map(row => row.attempt_id),
    })
    const counts = validateCampaign(rows, definitions, repetitions)
    const sourceAfter = createRunMetadata({ workers: 1 })
    if (sourceBefore.app_version !== sourceAfter.app_version || sourceBefore.test_version !== sourceAfter.test_version) {
      throw new Error('Application/framework sources changed during the campaign')
    }
    const expectedExit = definitions.some(item => item.expected) ? 1 : 0
    if (exit.signal || exit.code !== expectedExit || newRows.some(row => row.record_type === 'RUN_ERROR')) {
      throw new Error(`Unexpected runner termination: ${JSON.stringify(exit)}`)
    }
    Object.assign(manifest, { status: 'VERIFIED', completed_at: new Date().toISOString(), counts,
      run_id: rows[0].run_id, attempt_ids: rows.map(row => row.attempt_id), playwright_exit_code: exit.code,
      app_version: sourceBefore.app_version, test_version: sourceBefore.test_version })
    atomicWrite(file, JSON.stringify(manifest, null, 2) + '\n')
    atomicWrite(path.join(directory, 'campaigns', 'latest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`Campaign VERIFIED: ${JSON.stringify(counts)}\nManifest: ${file}`)
  } catch (error) {
    Object.assign(manifest, { status: 'INVALID', completed_at: new Date().toISOString(), validation_error: error.message, playwright_exit_code: exit.code })
    atomicWrite(file, JSON.stringify(manifest, null, 2) + '\n')
    throw error
  }
} catch (error) {
  console.error(`Campaign validation failed: ${error.message}`)
  process.exitCode = 1
}
