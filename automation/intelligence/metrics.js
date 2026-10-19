// Metrics operate on one test/project/cohort group of validated telemetry rows.
export const isFailure = row => ['FAIL', 'TIMED_OUT'].includes(row.status)
export const isLocatorFailure = row => ['LOCATOR_NOT_FOUND', 'LOCATOR_AMBIGUOUS'].includes(row.failure_type)

export function calculateMetrics(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = JSON.stringify([row.run_id, row.test_id, row.project_name, row.browser, row.repeat_index])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const executions = []
  const exclusions = { incompleteExecution: 0, expectedNonPass: 0 }
  for (const attempts of groups.values()) {
    attempts.sort((a, b) => a.retry_count - b.retry_count)
    // A truncated retry chain or interrupted attempt cannot establish reliability.
    if (attempts.some((row, index) => row.retry_count !== index ||
        !['PASS', 'FAIL', 'TIMED_OUT'].includes(row.status) || (index > 0 && !isFailure(attempts[index - 1])))) {
      exclusions.incompleteExecution++
      continue
    }
    if (attempts.some(row => row.expected_status !== 'PASS')) {
      exclusions.expectedNonPass++
      continue
    }
    executions.push(attempts)
  }
  const count = executions.length
  const scoredRows = executions.flat()
  const failed = executions.filter(attempts => isFailure(attempts[0])).length
  const retried = executions.filter(attempts => attempts.length > 1).length
  const locatorAffected = executions.filter(attempts => attempts.some(isLocatorFailure)).length
  const duration = scoredRows.reduce((sum, row) => sum + row.duration_ms, 0)
  const retryCost = scoredRows.filter(row => row.retry_count > 0).reduce((sum, row) => sum + row.duration_ms, 0)
  const ratio = numerator => count ? numerator / count : null
  return {
    attemptCount: rows.length,
    executionCount: groups.size,
    scoredExecutionCount: count,
    scoredAttemptCount: scoredRows.length,
    excludedExecutions: exclusions,
    firstAttemptFailures: failed,
    finalFailures: executions.filter(attempts => isFailure(attempts.at(-1))).length,
    recoveredExecutions: executions.filter(attempts => isFailure(attempts[0]) && attempts.at(-1).status === 'PASS').length,
    failureRate: ratio(failed),
    finalFailureRate: ratio(executions.filter(attempts => isFailure(attempts.at(-1))).length),
    stabilityScore: count ? 100 * (1 - failed / count) : null,
    retryAttempts: scoredRows.filter(row => row.retry_count > 0).length,
    retryRate: ratio(retried),
    retryCost, // Additional execution time in milliseconds, not the sum of retry indexes.
    totalDurationMs: duration,
    retryDurationRatio: duration ? retryCost / duration : null,
    locatorVolatility: ratio(locatorAffected),
    locatorVolatilityMethod: 'LOCATOR_FAILURE_INCIDENCE_PROXY',
    locatorAffectedExecutions: locatorAffected,
    scoredAttemptIds: scoredRows.map(row => row.attempt_id).sort(),
  }
}
