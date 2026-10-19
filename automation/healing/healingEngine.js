import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { classifyFailure } from '../telemetry/taxonomy.js'
import { HEALING_POLICY } from './confidenceScore.js'
import { discoverCandidates, locatorFromDescriptor, readFeatures } from './candidateDiscovery.js'
import { rankCandidates, selectCandidate } from './candidateRanking.js'

export class HealingEngine {
  constructor(page, { mode = 'ADAPTIVE', record = async () => {} } = {}) {
    if (!['BASELINE', 'ADAPTIVE'].includes(mode)) throw new Error('Unknown healing mode')
    this.page = page
    this.mode = mode
    this.record = record
  }

  async remember(locator) {
    await locator.waitFor({ state: 'visible', timeout: 2_000 })
    if (await locator.count() !== 1 || !await locator.isVisible()) throw new Error('Reference must be one visible element before mutation')
    return { ...await readFeatures(locator), pageURL: this.page.url() }
  }

  async perform({ descriptor, reference, action = 'click', value, validate }) {
    if (!['click', 'fill'].includes(action) || typeof validate !== 'function') throw new Error('A supported action and original assertion callback are mandatory')
    const original = locatorFromDescriptor(this.page, descriptor)
    const started = performance.now()
    const event = { operation_id: randomUUID(), healing_mode: this.mode, healing_attempted: false, healing_successful: false,
      original_locator: JSON.stringify(descriptor), candidate_locator: '', candidate_count: 0, confidence_score: 0,
      healing_duration_ms: 0, healing_reason: 'ORIGINAL_ACTION', original_failure_type: null, original_error: '',
      original_assertions_passed: false, action_completed: false, action_duration_ms: 0, total_duration_ms: 0,
      reference: reference || {}, candidates: [], policy_version: HEALING_POLICY.version }
    let originalError
    let healingStart
    const act = locator => action === 'click' ? locator.click({ timeout: HEALING_POLICY.actionTimeoutMs }) : locator.fill(value, { timeout: HEALING_POLICY.actionTimeoutMs })
    try {
      try {
        await act(original)
        event.action_completed = true
      } catch (error) {
        originalError = error
        event.original_error = error.message
        event.original_failure_type = classifyFailure({ status: 'FAIL', errors: [error] }).type
      }
      event.action_duration_ms = performance.now() - started
      if (originalError) {
        event.healing_reason = this.mode === 'BASELINE' ? 'BASELINE_NO_HEALING' : 'FAILURE_NOT_HEALABLE'
        if (this.mode === 'BASELINE' || !['LOCATOR_NOT_FOUND', 'LOCATOR_AMBIGUOUS'].includes(event.original_failure_type)) throw originalError
        const matches = await original.count()
        if (event.original_failure_type === 'LOCATOR_NOT_FOUND' && matches !== 0 || event.original_failure_type === 'LOCATOR_AMBIGUOUS' && matches < 2) {
          event.healing_reason = 'LOCATOR_FAILURE_NOT_REPRODUCIBLE'
          throw originalError
        }
        event.healing_attempted = true
        healingStart = performance.now()
        if (!reference?.role || reference.pageURL !== this.page.url()) {
          event.healing_reason = 'NO_TRUSTED_REFERENCE_FOR_PAGE'
          throw originalError
        }
        event.healing_reason = 'CANDIDATE_DISCOVERY_FAILED'
        await this.record(event)
        event.candidates = rankCandidates(reference, await discoverCandidates(this.page, reference))
        event.candidate_count = event.candidates.length
        if (performance.now() - healingStart > HEALING_POLICY.discoveryTimeoutMs) {
          event.healing_reason = 'DISCOVERY_BUDGET_EXCEEDED'
          throw originalError
        }
        const selection = selectCandidate(event.candidates)
        event.healing_reason = selection.reason
        if (!selection.candidate) throw originalError
        const selected = selection.candidate
        event.candidate_locator = JSON.stringify(selected.descriptor)
        event.confidence_score = selected.confidence
        const candidate = locatorFromDescriptor(this.page, selected.descriptor)
        // Revalidate identity immediately before the sole recovery action.
        if (await candidate.count() !== 1 || JSON.stringify(await readFeatures(candidate)) !== JSON.stringify(selected.features)) {
          event.healing_reason = 'CANDIDATE_CHANGED_BEFORE_ACTION'
          throw originalError
        }
        event.healing_reason = 'RECOVERY_ACTION_IN_PROGRESS'
        await this.record(event)
        await act(candidate)
        event.action_completed = true
      }
      // Assertion failures occur outside the locator-recovery catch. Never retry
      // the business oracle with relaxed expectations or another candidate.
      await this.record(event)
      try { await validate() }
      catch (error) { event.healing_reason = 'ORIGINAL_ASSERTION_FAILED'; throw error }
      event.original_assertions_passed = true
      event.healing_successful = event.healing_attempted
      event.healing_reason = event.healing_attempted ? 'RECOVERED_AND_ORIGINAL_ASSERTIONS_PASSED' : 'ORIGINAL_ACTION_AND_ASSERTIONS_PASSED'
    } catch (error) {
      if (event.healing_reason === 'RECOVERY_ACTION_IN_PROGRESS') event.healing_reason = 'RECOVERY_ACTION_FAILED'
      throw error
    } finally {
      event.total_duration_ms = performance.now() - started
      event.healing_duration_ms = healingStart === undefined ? 0 : performance.now() - healingStart
      await this.record(event)
    }
    return event
  }
}
