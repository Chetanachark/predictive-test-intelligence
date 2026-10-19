import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { HistoryStore, atomicWrite } from '../../telemetry/history.js'
import { AUTOMATION_ROOT, PROJECT_ROOT, createRunMetadata } from '../../telemetry/metadata.js'
import { FAMILIES, SEEDS, VERSION, progression, protocolHash, expectedFinal, expectedFailure } from './protocol.js'

export function validateProgression(rows, seed) {
  const expected = FAMILIES.flatMap((family, index) => progression(seed, family).map(item => ({ ...item, family, testId: `PROG-00${index + 1}` })))
  for (const step of expected) {
    const attempts = rows.filter(row => row.test_id === step.testId && row.repeat_index === step.step).sort((a,b) => a.retry_count - b.retry_count)
    const retries = ['failure', 'retry-warning'].includes(step.phase) ? 2 : 1
    if (attempts.length !== retries || attempts.some((row, index) => row.retry_count !== index || !row.injection_verified || row.experiment_id !== `S75-${step.family}-v1` || row.runtime_errors.length)) throw new Error(`Missing/invalid evidence for ${step.family}:${step.step}`)
    if (attempts.at(-1).status !== expectedFinal(step.phase)) throw new Error(`Unexpected final outcome ${step.family}:${step.step}: ${attempts.at(-1).status}`)
    if (retries === 2 && (attempts[0].status !== 'FAIL' || attempts[0].failure_type !== (step.phase === 'failure' ? expectedFailure(step.family) : step.family === 'state' ? 'STATE_CONSISTENCY_FAILURE' : step.family === 'synchronization' ? 'ACTIONABILITY_FAILURE' : 'LOCATOR_NOT_FOUND'))) throw new Error(`Unexpected failure symptom ${step.family}:${step.step}: ${attempts[0].failure_type}`)
    if (step.phase === 'failure' && attempts.at(-1).failure_type !== expectedFailure(step.family)) throw new Error('Final failure taxonomy differs')
    if (step.phase === 'retry-warning' && attempts.at(-1).status !== 'PASS') throw new Error('Transient retry did not recover')
  }
  if (rows.length !== expected.reduce((sum, item) => sum + (['failure','retry-warning'].includes(item.phase) ? 2 : 1), 0)) throw new Error('Unexpected progression records')
  for (const id of new Set(rows.map(row => row.test_id))) {
    const series = rows.filter(row => row.test_id === id && row.retry_count === 0).sort((a,b) => a.repeat_index - b.repeat_index)
    if (series.some((row, i) => i && rows.filter(item => item.test_id === id && item.repeat_index === i - 1).some(previous => previous.end_time >= row.start_time))) throw new Error('Progression observations are not chronological')
  }
  return { observations: expected.length, attempts: rows.length, final_failures: expected.filter(item => item.phase === 'failure').length }
}

export async function run(seed) {
  if (!SEEDS.includes(seed)) throw new Error(`Use a preregistered seed: ${SEEDS.join(', ')}`)
  const directory = path.resolve(process.env.TELEMETRY_DIR || path.join(PROJECT_ROOT, 'dataset'))
  const store = new HistoryStore(directory); const before = new Set(store.validate().map(row => row.attempt_id))
  const source = createRunMetadata({ workers: 1 }); const id = randomUUID()
  const file = path.join(directory, 'progression-campaigns', id, 'campaign.json')
  const manifest = { campaign_id: id, started_at: new Date().toISOString(), status: 'RUNNING', seed,
    protocol: VERSION, protocol_sha256: protocolHash(), plans: Object.fromEntries(FAMILIES.map(f => [f, progression(seed, f)])),
    app_version: source.app_version, test_version: source.test_version }
  const publish = () => atomicWrite(file, JSON.stringify(manifest, null, 2) + '\n')
  publish()
  try {
    const child = spawn(process.execPath, [path.join(AUTOMATION_ROOT, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'experiments/progression/playwright.config.js', '--repeat-each=26'], {
      cwd: AUTOMATION_ROOT, stdio: 'inherit', env: { ...process.env, TELEMETRY_DIR: directory, PROGRESSION_SEED: String(seed), HEALING_FEEDBACK: 'off' } })
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })) })
    const rows = store.validate().filter(row => !before.has(row.attempt_id))
    if (rows.some(row => row.record_type !== 'TEST_ATTEMPT') || exit.code !== 1 || exit.signal) throw new Error(`Unexpected runner exit ${JSON.stringify(exit)}`)
    manifest.counts = validateProgression(rows, seed)
    const after = createRunMetadata({ workers: 1 })
    if (after.app_version !== source.app_version || after.test_version !== source.test_version) throw new Error('Sources changed during progression campaign')
    Object.assign(manifest, { status: 'VERIFIED', completed_at: new Date().toISOString(), expected_rows: rows.length,
      attempt_ids: rows.map(row => row.attempt_id), run_ids: [...new Set(rows.map(row => row.run_id))] })
    publish(); console.log(`Progression VERIFIED: ${file}`)
    return manifest
  } catch (error) {
    Object.assign(manifest, { status: 'INVALID', completed_at: new Date().toISOString(), error: error.message }); publish(); throw error
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await run(Number(process.argv[2])) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
