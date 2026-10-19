import fs from 'node:fs'
import { readHealingResult } from '../healing/healingReporter.js'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { HistoryStore, atomicWrite } from './history.js'
import { validateRecord } from './schema.js'
import { STATUS_MAP, classifyFailure, failurePhase } from './taxonomy.js'
import { createRunMetadata, testIdentity, describePath, experimentMetadata } from './metadata.js'

export default class TelemetryReporter {
  constructor(options = {}) {
    this.directory = path.resolve(process.env.TELEMETRY_DIR || options.directory || fileURLToPath(new URL('../../dataset', import.meta.url)))
    this.store = new HistoryStore(this.directory)
    this.attempts = new WeakMap()
    this.completed = 0
    this.runErrors = 0
    this.listOnly = process.argv.includes('--list')
  }

  printsToStdio() { return false }

  guard(action) {
    if (this.listOnly || this.fatalError) return
    try { action() }
    catch (error) {
      this.fatalError = error
      process.stderr.write(`[telemetry] ${error.message}\n`)
    }
  }

  ensureRun(config = { workers: 0 }) {
    if (this.metadata) return
    this.metadata = createRunMetadata(config)
    this.manifest = path.join(this.directory, 'runs', this.metadata.run_id, 'run.json')
    this.store.validate()
    this.writeManifest('RUNNING')
  }

  writeManifest(status, extra = {}) {
    atomicWrite(this.manifest, JSON.stringify({ ...this.metadata,
      status, expected_tests: this.expectedTests ?? 0,
      completed_attempts: this.completed, run_errors: this.runErrors,
      telemetry_error: this.fatalError?.message ?? null, ...extra,
    }, null, 2) + '\n')
  }

  onBegin(config, suite) {
    this.guard(() => {
      this.expectedTests = suite.allTests().length
      this.ensureRun(config)
      const identities = new Map()
      for (const test of suite.allTests()) {
        const id = testIdentity(test)
        const identity = `${test.location.file}::${describePath(test).join('::')}::${test.title}`
        if (identities.has(id) && identities.get(id) !== identity) throw new Error(`Duplicate test_id: ${id}`)
        identities.set(id, identity)
      }
      this.writeManifest('RUNNING')
    })
  }

  attempt(result) {
    let attempt = this.attempts.get(result)
    if (!attempt) {
      attempt = { id: randomUUID(), failedStep: null }
      this.attempts.set(result, attempt)
    }
    return attempt
  }

  onTestBegin(_test, result) {
    this.guard(() => { this.attempt(result) })
  }

  onStepEnd(_test, result, step) {
    this.guard(() => {
      const attempt = this.attempt(result)
      if (step.error && !attempt.failedStep) {
        attempt.failedStep = { title: step.title, category: step.category, phase: failurePhase(step) }
      }
    })
  }

  readRuntimeErrors(attachments) {
    const attachment = attachments.find(item => item.name === 'telemetry-runtime-errors')
    if (!attachment) return []
    return JSON.parse(attachment.body ? attachment.body.toString('utf8') : fs.readFileSync(attachment.path, 'utf8'))
  }

  archiveArtifacts(attachments, attemptId) {
    const result = { trace_path: null, screenshot_path: null }
    for (const [key, matches, extension] of [
      ['trace_path', item => item.name === 'trace', '.zip'],
      ['screenshot_path', item => item.name === 'screenshot' && item.contentType.startsWith('image/'), '.png'],
    ]) {
      const attachment = attachments.find(matches)
      if (!attachment) continue
      const relative = `artifacts/${this.metadata.run_id}/${attemptId}/${key === 'trace_path' ? 'trace' : 'screenshot'}${extension}`
      const destination = path.join(this.directory, relative)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      if (attachment.path) fs.copyFileSync(attachment.path, destination)
      else if (attachment.body) fs.writeFileSync(destination, attachment.body)
      else throw new Error(`Artifact ${attachment.name} has no content`)
      result[key] = relative
    }
    return result
  }

  onTestEnd(test, result) {
    this.guard(() => {
      this.ensureRun()
      const attempt = this.attempt(result)
      const annotations = result.annotations ?? test.annotations ?? []
      const status = STATUS_MAP[result.status]
      const errors = result.errors?.length ? result.errors : result.error ? [result.error] : []
      const runtimeErrors = this.readRuntimeErrors(result.attachments)
      const phase = attempt.failedStep?.phase ?? 'test'
      const classification = classifyFailure({ status, errors, phase,
        category: attempt.failedStep?.category, runtimeErrors,
        annotation: annotations.findLast(item => item.type === 'failure_type')?.description,
      })
      const project = test.parent.project()
      const start = result.startTime.toISOString()
      const row = {
        schema_version: 3, record_type: 'TEST_ATTEMPT',
        ...this.metadata,
        attempt_id: attempt.id,
        test_id: testIdentity(test), test_name: test.title,
        suite_name: describePath(test).join(' > ') || path.basename(test.location.file),
        browser: project?.use.browserName || project?.use.defaultBrowserType || 'chromium',
        status, failure_type: classification.type,
        duration_ms: result.duration, retry_count: result.retry,
        start_time: start, end_time: new Date(result.startTime.getTime() + result.duration).toISOString(),
        trace_path: null, screenshot_path: null,
        notes: [
          ...annotations.filter(item => item.type === 'telemetry_note').map(item => item.description ?? ''),
          ...(classification.source === 'HEURISTIC' ? ['Observed failure symptom; heuristic classification is not ground-truth root cause.'] : []),
          ...(runtimeErrors.length ? ['Page runtime errors observed; see runtime_errors.'] : []),
          ...(attempt.failedStep ? [`Failed step: ${attempt.failedStep.title}`] : []),
        ].join('\n'),
        ...experimentMetadata(annotations),
        ...readHealingResult(result.attachments, status),
        expected_status: STATUS_MAP[test.expectedStatus],
        classification_source: classification.source, failure_phase: phase,
        error_message: errors.map(error => error.message || error.value || '').join('\n'),
        error_stack: errors.map(error => error.stack || '').join('\n'),
        runtime_errors: runtimeErrors,
        project_name: project?.name || 'default', worker_index: result.workerIndex,
        repeat_index: test.repeatEachIndex ?? 0,
      }
      validateRecord(row)
      Object.assign(row, this.archiveArtifacts(result.attachments, attempt.id))
      this.store.append(row)
      this.completed++
      this.writeManifest('RUNNING')
    })
  }

  onError(error) {
    this.guard(() => {
      this.ensureRun()
      const time = new Date().toISOString()
      const row = {
        schema_version: 3, record_type: 'RUN_ERROR', ...this.metadata,
        attempt_id: randomUUID(), test_id: '__RUN__', test_name: 'Run-level error', suite_name: 'Run lifecycle',
        browser: 'runner', status: 'FAIL', failure_type: 'SETUP_ENVIRONMENT_FAILURE',
        duration_ms: 0, retry_count: 0, start_time: time, end_time: time,
        trace_path: null, screenshot_path: null,
        notes: 'Runner error, not attributed to an individual test. Exclude RUN_ERROR rows from test-attempt modeling.',
        ...experimentMetadata(), ...readHealingResult([], 'FAIL'), expected_status: 'PASS', classification_source: 'HEURISTIC', failure_phase: 'run',
        error_message: error.message || error.value || 'Unspecified runner error', error_stack: error.stack || '',
        runtime_errors: [], project_name: 'runner', worker_index: -1, repeat_index: 0,
      }
      this.store.append(row)
      this.runErrors++
      this.writeManifest('RUNNING')
    })
  }

  async onEnd(result) {
    if (this.listOnly) return
    this.guard(() => {
      this.ensureRun()
      this.store.validate()
      this.writeManifest(result.status.toUpperCase(), { end_time: new Date().toISOString() })
    })
    if (this.fatalError) {
      // Playwright swallows reporter exceptions; explicitly fail the runner instead.
      try { if (this.manifest) this.writeManifest('TELEMETRY_ERROR') } catch { /* Original error was already printed. */ }
      return { status: 'failed' }
    }
  }
}
