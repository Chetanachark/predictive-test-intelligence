import test from 'node:test'
import assert from 'node:assert/strict'
import { FAMILIES, SEEDS, progression, expectedFailure, expectedFinal, protocolHash } from './protocol.js'
import { validateProgression } from './run.js'
function records(seed) {
  return FAMILIES.flatMap((family, i) => progression(seed, family).flatMap(step => {
    const count = ['failure','retry-warning'].includes(step.phase) ? 2 : 1
    return Array.from({length:count}, (_, retry) => ({ test_id: `PROG-00${i+1}`, repeat_index: step.step,
      retry_count: retry, injection_verified: true, experiment_id: `S75-${family}-v1`, runtime_errors: [],
      start_time: new Date(100000 + step.step * 10000 + retry * 1000).toISOString(),
      end_time: new Date(100500 + step.step * 10000 + retry * 1000).toISOString(),
      status: step.phase === 'retry-warning' && retry === 0 ? 'FAIL' : expectedFinal(step.phase),
      failure_type: step.phase === 'failure' ? expectedFailure(family) : step.phase === 'retry-warning' && retry === 0 ? family === 'state' ? 'STATE_CONSISTENCY_FAILURE' : family === 'synchronization' ? 'ACTIONABILITY_FAILURE' : 'LOCATOR_NOT_FOUND' : null,
    }))
  }))
}
test('plans are deterministic, versioned and contain warnings, repairs and aborted degradation', () => {
  assert.match(protocolHash(), /^[a-f0-9]{64}$/)
  for (const seed of SEEDS) for (const family of FAMILIES) {
    const plan = progression(seed, family)
    assert.deepEqual(plan, progression(seed, family))
    assert.equal(plan.length,26)
    for (const phase of ['healthy','retry-warning','warning','critical','failure','repair','aborted']) assert.ok(plan.some(x => x.phase === phase))
    for (const [i, item] of plan.entries()) if (item.phase === 'failure' && plan[i-1].phase !== 'failure') assert.equal(plan[i-1].phase, 'critical')
  }
})
test('campaign validation requires actual retry failures and final observed outcomes', () => {
  const rows = records(103)
  assert.equal(validateProgression(rows,103).observations,104)
  assert.throws(() => validateProgression(rows.slice(1),103), /Missing/)
  const changed = structuredClone(rows)
  changed.find(x => x.failure_type === 'LOCATOR_AMBIGUOUS').failure_type = 'ASSERTION_MISMATCH'
  assert.throws(() => validateProgression(changed,103), /Unexpected/)
  const missing = structuredClone(rows);missing[0].injection_verified=false
  assert.throws(() => validateProgression(missing,103), /invalid/)
})
