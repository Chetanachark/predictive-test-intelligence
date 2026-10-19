import assert from 'node:assert/strict'
import { evaluationTruth } from './scenarios.js'

export const COMPARISON_CASES = Object.freeze(['healthy', 'good-only', 'both', 'identical', 'unsafe-href', 'business-control'])
export function validateTraining(rows, repetitions, emptyVersion) {
  assert.equal(rows.length, repetitions * 2)
  for (const scenario of ['good-only', 'bad-only']) {
    const selected = rows.filter(row => evaluationTruth(row).scenario === scenario)
    assert.equal(selected.length, repetitions)
    assert.deepEqual(selected.map(row => row.repeat_index).sort((a, b) => a - b), Array.from({ length: repetitions }, (_, index) => index))
    for (const row of selected) {
      assert.equal(row.project_name, 'training')
      assert.equal(evaluationTruth(row).phase, 'training')
      assert.equal(row.status, scenario === 'good-only' ? 'PASS' : 'FAIL')
      assert.equal(row.healing_successful, scenario === 'good-only')
      assert.equal(row.failure_type, scenario === 'good-only' ? null : 'ASSERTION_MISMATCH')
      assert.equal(row.original_failure_type, 'LOCATOR_NOT_FOUND')
      assert.equal(evaluationTruth(row).intendedTargetClicked, scenario === 'good-only')
      assert.equal(row.knowledgeBaseHit, false)
      assert.equal(row.learningEnabled, true)
      assert.equal(row.healing_events[0].knowledgeBaseVersion, emptyVersion)
      assert.equal(row.healing_events[0].action_completed, true)
      assert.equal(row.healing_events.length, 1)
      assert.equal(row.injection_verified, true)
      assert.equal(row.expected_status, 'PASS')
      assert.equal(row.retry_count, 0)
      assert.equal(row.failure_phase, 'test')
      assert.equal(row.runtime_errors.length, 0)
      assert.ok(row.trace_path && row.screenshot_path)
    }
  }
}
export function validateComparison(rows, repetitions, frozenVersion) {
  assert.equal(rows.length, COMPARISON_CASES.length * 2 * repetitions)
  for (const scenario of COMPARISON_CASES) for (const project of ['baseline-healing', 'adaptive-healing']) {
    const selected = rows.filter(row => evaluationTruth(row).scenario === scenario && row.project_name === project)
    assert.equal(selected.length, repetitions)
    assert.deepEqual(selected.map(row => row.repeat_index).sort((a, b) => a - b), Array.from({ length: repetitions }, (_, index) => index))
    for (const row of selected) {
      const adaptive = project === 'adaptive-healing'
      assert.equal(row.learningEnabled, adaptive)
      assert.equal(row.healing_mode, 'ADAPTIVE', 'Both arms must perform healing')
      assert.equal(evaluationTruth(row).phase, 'heldout')
      assert.equal(row.expected_status, 'PASS')
      assert.equal(row.retry_count, 0)
      assert.equal(row.healing_events.length, 1)
      assert.equal(row.failure_phase, 'test')
      assert.equal(row.runtime_errors.length, 0)
      const pass = ['healthy', 'good-only'].includes(scenario) || adaptive && scenario === 'both'
      assert.equal(row.status, pass ? 'PASS' : 'FAIL', `${project}/${scenario}: unexpected original oracle outcome`)
      assert.equal(row.healing_successful, pass && scenario !== 'healthy')
      if (pass) assert.equal(evaluationTruth(row).intendedTargetClicked, true)
      if (scenario !== 'healthy') assert.equal(row.injection_verified, true)
      if (['healthy', 'business-control'].includes(scenario)) assert.equal(row.healing_attempted, false)
      if (!adaptive) { assert.equal(row.knowledgeBaseHit, false); assert.equal(row.historicalSuccessRate, null) }
      if (adaptive && row.healing_attempted) assert.equal(row.healing_events[0].knowledgeBaseVersion, frozenVersion)
      if (adaptive && ['good-only', 'both'].includes(scenario)) { assert.equal(row.knowledgeBaseHit, true); assert.equal(row.historicalSuccessRate, 1) }
      assert.ok(row.trace_path && row.screenshot_path)
    }
  }
  assert.equal(new Set(rows.map(row => row.run_id)).size, 1)
}

export function comparisonMetrics(rows) {
  const ratio = (a, b) => b ? a / b : null
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const arms = Object.fromEntries(['baseline-healing', 'adaptive-healing'].map(project => {
    const selected = rows.filter(row => row.project_name === project)
    const attempts = selected.filter(row => row.healing_attempted)
    const successes = attempts.filter(row => row.healing_successful)
    const actions = attempts.filter(row => row.healing_events[0].candidate_locator && row.healing_events[0].action_completed)
    const wrong = actions.filter(row => !evaluationTruth(row).intendedTargetClicked)
    const business = selected.filter(row => evaluationTruth(row).family === 'business')
    return [project, { executions: selected.length, passed: selected.filter(row => row.status === 'PASS').length,
      healingAttempts: attempts.length, successfulRecoveries: successes.length, healingSuccessRate: ratio(successes.length, attempts.length),
      recoveryActions: actions.length, wrongRecoveries: wrong.length, wrongRecoveryRate: ratio(wrong.length, actions.length),
      businessDefectExecutions: business.length, maskedDefects: business.filter(row => row.status === 'PASS').length,
      maskedDefectRate: ratio(business.filter(row => row.status === 'PASS').length, business.length),
      knowledgeBaseHits: selected.filter(row => row.knowledgeBaseHit).length,
      knowledgeBaseHitRateAmongAttempts: ratio(attempts.filter(row => row.knowledgeBaseHit).length, attempts.length),
      meanHealingDurationMs: mean(attempts.map(row => row.healing_duration_ms)),
    }]
  }))
  const scenarios = COMPARISON_CASES.map(scenario => ({ scenario, ...Object.fromEntries(['baseline-healing', 'adaptive-healing'].map(project => {
    const selected = rows.filter(row => row.project_name === project && evaluationTruth(row).scenario === scenario)
    return [project, { executions: selected.length, passed: selected.filter(row => row.status === 'PASS').length }]
  })) }))
  return { arms, scenarios,
    healingSuccessRateDelta: arms['adaptive-healing'].healingSuccessRate - arms['baseline-healing'].healingSuccessRate,
    limitations: [
      'A controlled mechanism demonstration with two teacher variants; not a representative production benchmark.',
      'Training outcomes are excluded from held-out metrics. Knowledge is frozen during both comparison arms.',
      'Both arms use the same semantic features, action budget, confidence threshold, hard gates, and original assertions.',
      'Historical success is an observed end-to-end recovery rate with a Beta(1,1) smoothing prior for ranking; it is not a calibrated locator-correctness probability.',
      'Business-defect masking is checked on one existing coupon mutation only. Previous Sprint 6 safety evaluations cover additional defects.',
      'Fixed project ordering and small sample sizes make timing descriptive rather than causal evidence.',
    ],
  }
}

export function comparisonHTML(report) {
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const percent = value => value === null ? 'N/A' : `${(100 * value).toFixed(2)}%`
  const baseline = report.metrics.arms['baseline-healing']; const adaptive = report.metrics.arms['adaptive-healing']
  const rows = [
    ['Healing attempts', baseline.healingAttempts, adaptive.healingAttempts],
    ['Successful recoveries', baseline.successfulRecoveries, adaptive.successfulRecoveries],
    ['Healing success rate', percent(baseline.healingSuccessRate), percent(adaptive.healingSuccessRate)],
    ['Wrong recovery rate', percent(baseline.wrongRecoveryRate), percent(adaptive.wrongRecoveryRate)],
    ['Masked defect rate', percent(baseline.maskedDefectRate), percent(adaptive.maskedDefectRate)],
    ['Knowledge-base hits', baseline.knowledgeBaseHits, adaptive.knowledgeBaseHits],
    ['Mean recovery-path duration', `${baseline.meanHealingDurationMs.toFixed(2)} ms`, `${adaptive.meanHealingDurationMs.toFixed(2)} ms`],
  ]
  const table = (headings, data) => '<table><thead><tr>' + headings.map(item => `<th>${escape(item)}</th>`).join('') + '</tr></thead><tbody>' +
    data.map(row => '<tr>' + row.map(item => `<td>${escape(item)}</td>`).join('') + '</tr>').join('') + '</tbody></table>'
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sprint 6.5 comparison</title>' +
    '<style>body{max-width:1000px;margin:40px auto;padding:0 24px;font:16px/1.6 system-ui;color:#192b40}table{border-collapse:collapse;width:100%;margin:24px 0}td,th{border:1px solid #cdd6e0;padding:10px;text-align:left}th{background:#eaf0f6}</style>' +
    `<h1>Baseline Healing vs Adaptive Healing</h1><p>Status: <strong>${escape(report.status)}</strong>. Evaluation: ${escape(report.evaluation_id)}.</p>` +
    `<p>${report.training_attempt_ids.length} training executions; ${report.heldout_attempt_ids.length} held-out executions. Knowledge was frozen during comparison.</p>` +
    table(['Metric', 'Baseline healing', 'Adaptive healing'], rows) + '<h2>Scenario outcomes</h2>' +
    table(['Scenario', 'Baseline passes', 'Adaptive passes'], report.metrics.scenarios.map(item => [item.scenario,
      `${item['baseline-healing'].passed}/${item['baseline-healing'].executions}`, `${item['adaptive-healing'].passed}/${item['adaptive-healing'].executions}`])) +
    '<h2>Evidence and limits</h2><ul>' + report.metrics.limitations.map(text => `<li>${escape(text)}</li>`).join('') + '</ul></html>\n'
}
