import assert from 'node:assert/strict'

export function validateCampaign(rows, definitions, repetitions = 1) {
  assert.equal(rows.length, definitions.length * repetitions, 'Missing or unexpected campaign attempt rows')
  assert.equal(new Set(rows.map(row => row.run_id)).size, 1, 'A campaign must correspond to one Playwright run')
  assert.equal(new Set(rows.map(row => row.attempt_id)).size, rows.length, 'Duplicate attempt identity')
  const counts = { PASS: 0, FAIL: 0 }
  for (const definition of definitions) {
    const attempts = rows.filter(row => row.experiment_id === definition.id)
    assert.equal(attempts.length, repetitions, `${definition.id}: unexpected attempt count`)
    assert.deepEqual(attempts.map(row => row.repeat_index).sort((a, b) => a - b), Array.from({ length: repetitions }, (_, index) => index))
    for (const row of attempts) {
      assert.equal(row.record_type, 'TEST_ATTEMPT')
      assert.equal(row.test_id, definition.testId)
      assert.equal(row.expected_status, 'PASS', 'Do not suppress injected failures with test.fail()')
      assert.equal(row.retry_count, 0, 'Campaign retries must stay disabled')
      assert.equal(row.fault_variant, definition.variant)
      assert.equal(row.fault_type, definition.faultType)
      assert.equal(row.mutation_version, definition.version)
      assert.equal(row.scenario_variant, definition.scenario)
      assert.equal(row.expected_failure_type, definition.expected)
      if (!definition.expected) {
        assert.equal(row.status, 'PASS', `${definition.id}: healthy control failed`)
        assert.equal(row.failure_type, null)
        assert.equal(row.emulated, false)
        assert.equal(row.injected_at, null)
        assert.equal(row.injection_verified, false)
      } else {
        assert.equal(row.status, 'FAIL', `${definition.id}: mutation survived or execution did not reach its oracle`)
        assert.equal(row.failure_type, definition.expected, `${definition.id}: wrong observed failure category`)
        assert.equal(row.failure_phase, 'test', 'Setup failures are not successful mutation observations')
        assert.equal(row.emulated, true)
        assert.equal(row.injection_verified, true, `${definition.id}: injection was not independently confirmed`)
        assert.ok(row.injected_at)
        assert.ok(row.trace_path && row.screenshot_path, 'Failure evidence missing')
        if (definition.kind === 'source') assert.match(row.notes, /mutated_sha256/)
        counts[row.failure_type] = (counts[row.failure_type] ?? 0) + 1
      }
      counts[row.status]++
    }
  }
  return counts
}
