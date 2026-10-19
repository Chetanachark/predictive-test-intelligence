import assert from 'node:assert/strict'
import { EVALUATION_CASES } from './registry.js'

export function groundTruth(row) {
  for (const line of row.notes.split('\n')) {
    try { const value = JSON.parse(line); if (value.healing_ground_truth) return value.healing_ground_truth }
    catch { /* Other notes are ordinary human-readable evidence. */ }
  }
  throw new Error(`Missing independent ground truth: ${row.attempt_id}`)
}

export function validateEvaluation(rows, repetitions) {
  assert.equal(rows.length, EVALUATION_CASES.length * 2 * repetitions, 'Incomplete evaluation')
  for (const scenario of EVALUATION_CASES) for (const mode of ['BASELINE', 'ADAPTIVE']) {
    const selected = rows.filter(row => row.test_id === scenario.testId && row.healing_mode === mode)
    assert.equal(selected.length, repetitions, `${scenario.id}/${mode}: missing pair/repetition`)
    assert.deepEqual(selected.map(row => row.repeat_index).sort((a, b) => a - b), Array.from({ length: repetitions }, (_, index) => index))
    for (const row of selected) {
      const truth = groundTruth(row)
      assert.equal(truth.scenario, scenario.id)
      assert.equal(truth.family, scenario.family)
      assert.equal(typeof truth.intendedTargetClicked, 'boolean')
      assert.equal(row.record_type, 'TEST_ATTEMPT')
      assert.equal(row.retry_count, 0)
      assert.equal(row.expected_status, 'PASS', 'Do not suppress failures with test.fail')
      assert.equal(row.healing_events.length, 1)
      assert.equal(row.healing_successful, mode === 'ADAPTIVE' && scenario.expectedRecovery)
      assert.equal(row.status, scenario.family === 'healthy' || mode === 'ADAPTIVE' && scenario.expectedRecovery ? 'PASS' : 'FAIL', `${scenario.id}/${mode}: unexpected oracle outcome`)
      if (scenario.family !== 'healthy') assert.equal(row.injection_verified, true)
      if (scenario.family === 'business' || scenario.family === 'actionability' || mode === 'BASELINE') assert.equal(row.healing_attempted, false)
      if (row.status === 'PASS') assert.equal(truth.intendedTargetClicked, true, 'Independent identity oracle detected a wrong target')
      assert.ok(row.trace_path && row.screenshot_path, 'Evaluation evidence missing')
    }
  }
  assert.equal(new Set(rows.map(row => row.run_id)).size, 1)
}

export function evaluationMetrics(rows) {
  const adaptive = rows.filter(row => row.healing_mode === 'ADAPTIVE')
  const attempted = adaptive.filter(row => row.healing_attempted)
  const recovered = attempted.filter(row => row.healing_successful)
  const actions = attempted.filter(row => row.healing_events.some(event => event.candidate_locator && event.action_completed))
  const wrong = actions.filter(row => !groundTruth(row).intendedTargetClicked)
  const business = adaptive.filter(row => groundTruth(row).family === 'business')
  const masked = business.filter(row => row.status === 'PASS')
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const ratio = (a, b) => b ? a / b : null
  const pairs = adaptive.map(row => {
    const baseline = rows.find(other => other.test_id === row.test_id && other.repeat_index === row.repeat_index && other.healing_mode === 'BASELINE')
    return baseline ? { testId: row.test_id, repeatIndex: row.repeat_index, adaptiveStatus: row.status, baselineStatus: baseline.status,
      durationDeltaMs: row.healing_events[0].total_duration_ms - baseline.healing_events[0].total_duration_ms } : null
  }).filter(Boolean)
  return {
    healing_success_rate: ratio(recovered.length, attempted.length),
    healing_success_numerator: recovered.length, healing_attempts: attempted.length,
    wrong_recovery_rate: ratio(wrong.length, actions.length), wrong_recoveries: wrong.length, recovery_actions: actions.length,
    masked_defect_rate: ratio(masked.length, business.length), masked_defects: masked.length, evaluated_business_defects: business.length,
    healing_overhead: { meanRecoveryPathMs: mean(attempted.map(row => row.healing_duration_ms)),
      totalRecoveryPathMs: attempted.reduce((sum, row) => sum + row.healing_duration_ms, 0),
      meanPairedOperationDeltaMs: mean(pairs.map(pair => pair.durationDeltaMs)) },
    modes: Object.fromEntries(['BASELINE', 'ADAPTIVE'].map(mode => {
      const selected = rows.filter(row => row.healing_mode === mode)
      return [mode, { executions: selected.length, passed: selected.filter(row => row.status === 'PASS').length, failed: selected.filter(row => row.status === 'FAIL').length }]
    })), pairs,
    limitations: [
      'Controlled same-session experiment; rates are conditional on these scenarios, not production accuracy estimates.',
      'Wrong recovery is measured by an independent clicked-element identity oracle, not confidence score or final status alone.',
      'Masked defect rate covers only the four injected business defects and the retained original assertions.',
      'Recovery path time includes discovery, ranking, action, and original assertion validation; paired deltas also include successful workflow continuation.',
      'Fixed BASELINE-then-ADAPTIVE order; timings are descriptive and not a causal performance comparison.',
    ],
  }
}
