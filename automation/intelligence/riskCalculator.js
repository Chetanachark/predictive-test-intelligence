export const RISK_MODEL = Object.freeze({
  version: 'heuristic-v1',
  weights: Object.freeze({ failureRate: 0.60, retryRate: 0.25, locatorVolatility: 0.15 }),
  thresholds: Object.freeze({ medium: 30, high: 60 }),
  minimumEvidenceExecutions: 10,
})

export function calculateRisk(metrics) {
  const values = Object.keys(RISK_MODEL.weights).map(key => metrics[key])
  if (values.some(value => value === null)) return { riskScore: null, riskLevel: null, evidence: 'NO_SCORABLE_EXECUTIONS' }
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Risk inputs must be rates between zero and one')
  const score = 100 * Object.entries(RISK_MODEL.weights).reduce((sum, [key, weight]) => sum + metrics[key] * weight, 0)
  return {
    riskScore: Number(score.toFixed(2)),
    riskLevel: score >= RISK_MODEL.thresholds.high ? 'HIGH' : score >= RISK_MODEL.thresholds.medium ? 'MEDIUM' : 'LOW',
    evidence: metrics.scoredExecutionCount < RISK_MODEL.minimumEvidenceExecutions ? 'LIMITED_HISTORY' : 'AVAILABLE_HISTORY',
  }
}
