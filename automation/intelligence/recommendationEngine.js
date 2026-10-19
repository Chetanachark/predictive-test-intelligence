import { RISK_MODEL } from './riskCalculator.js'

const ACTIONS = Object.freeze({
  LOCATOR_NOT_FOUND: 'Review locator strategy and confirm the target exists in the expected page state.',
  LOCATOR_AMBIGUOUS: 'Scope the locator to a unique accessible element and verify the match count.',
  ACTIONABILITY_FAILURE: 'Inspect visibility, enabled state, overlays, and rendering readiness before the action.',
  ASSERTION_MISMATCH: 'Compare the assertion with the business requirement and inspect the actual result.',
  STATE_CONSISTENCY_FAILURE: 'Inspect cart, inventory, and order state transitions against the failed invariant.',
  APPLICATION_RUNTIME_ERROR: 'Investigate captured browser runtime errors and the associated trace.',
  SETUP_ENVIRONMENT_FAILURE: 'Investigate server availability, browser setup, and test environment configuration.',
  UNKNOWN: 'Inspect the trace and error details; manually classify the failure before drawing conclusions.',
})

export function generateRecommendations(metrics, analysis, { cohort = 'ordinary' } = {}) {
  const recommendations = []
  if (cohort === 'verified-experiment') recommendations.push('Interpret these results as controlled experiment observations, separate from ordinary test reliability.')
  for (const type of analysis.primaryFailureTypes) recommendations.push(ACTIONS[type])
  if (metrics.retryAttempts > 0) recommendations.push('Investigate retries and their additional execution time; inspect failures even when the final attempt passes.')
  if (metrics.recoveredExecutions > 0) recommendations.push('Reproduce recovered failures to investigate intermittent behavior and test isolation.')
  if (metrics.scoredExecutionCount < RISK_MODEL.minimumEvidenceExecutions) recommendations.push('Collect more comparable executions before using this score for prioritization decisions.')
  if (Object.values(metrics.excludedExecutions).some(Boolean)) recommendations.push('Review excluded executions and complete interrupted or missing retry chains.')
  return [...new Set(recommendations)]
}
