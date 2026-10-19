import { HEALING_POLICY } from './confidenceScore.js'

export const ADAPTIVE_POLICY = Object.freeze({ version: 'historical-v1', semanticWeight: 0.75, historicalWeight: 0.25,
  minimumObservations: 2, priorSuccesses: 1, priorFailures: 1 })

export function adaptiveRanking(ranked, { snapshot, scope, originalLocator, learningEnabled = false } = {}) {
  const candidates = ranked.map(candidate => {
    const entry = learningEnabled && snapshot && candidate.descriptor ? snapshot.lookup(scope, originalLocator, candidate.descriptor) : null
    return { ...candidate, baseConfidence: candidate.confidence, knowledgeBaseHit: Boolean(entry),
      historicalSuccessRate: entry ? entry.successfulRecoveries / entry.attempts : null,
      historicalAttempts: entry?.attempts || 0,
      smoothedHistoricalSuccess: entry ? (entry.successfulRecoveries + ADAPTIVE_POLICY.priorSuccesses) /
        (entry.attempts + ADAPTIVE_POLICY.priorSuccesses + ADAPTIVE_POLICY.priorFailures) : 0.5,
      historyApplied: false }
  })
  // No evidence: reproduce the original heuristic ranking exactly. With evidence,
  // use the same neutral prior for unknown candidates to keep scores comparable.
  const usable = learningEnabled && candidates.some(candidate => candidate.eligible && candidate.historicalAttempts >= ADAPTIVE_POLICY.minimumObservations)
  return candidates.map(candidate => {
    if (!usable) return candidate
    const historical = candidate.historicalAttempts >= ADAPTIVE_POLICY.minimumObservations ? candidate.smoothedHistoricalSuccess : 0.5
    const confidence = ADAPTIVE_POLICY.semanticWeight * candidate.baseConfidence + ADAPTIVE_POLICY.historicalWeight * historical
    return { ...candidate, confidence: Number(confidence.toFixed(6)), historyApplied: true,
      eligible: candidate.eligible && candidate.baseConfidence >= HEALING_POLICY.threshold,
      reason: candidate.eligible && candidate.baseConfidence < HEALING_POLICY.threshold ? 'LOW_BASE_CONFIDENCE' : candidate.reason }
  }).sort((a, b) => b.confidence - a.confidence || JSON.stringify(a.descriptor).localeCompare(JSON.stringify(b.descriptor)))
}
