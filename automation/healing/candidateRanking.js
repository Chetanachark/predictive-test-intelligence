import { confidenceScore, HEALING_POLICY } from './confidenceScore.js'

export function rankCandidates(reference, candidates) {
  return candidates.map(candidate => {
    const { confidence, signals } = confidenceScore(reference, candidate.features)
    // Do not follow a different route or act on a different form field merely
    // because the text resembles the remembered target.
    const conflict = ['href', 'type', 'name'].some(key => reference.attributes[key] && candidate.features.attributes[key] !== reference.attributes[key])
    const anchored = Object.entries(reference.attributes).some(([key, value]) => value && candidate.features.attributes[key] === value) ||
      Boolean(reference.testId && reference.testId === candidate.features.testId) ||
      Boolean(reference.label && reference.label === candidate.features.label)
    const eligible = Boolean(candidate.descriptor) && !conflict && anchored && signals.role === 1
    return { ...candidate, confidence, signals, eligible,
      reason: !candidate.descriptor ? 'NO_UNIQUE_LOCATOR' : conflict ? 'CONTRACT_ATTRIBUTE_CONFLICT' : !anchored ? 'NO_STABLE_ANCHOR' : 'ELIGIBLE' }
  }).sort((a, b) => b.confidence - a.confidence || JSON.stringify(a.descriptor).localeCompare(JSON.stringify(b.descriptor)))
}

export function selectCandidate(ranked) {
  const eligible = ranked.filter(candidate => candidate.eligible)
  const best = eligible[0]
  if (!best) return { candidate: null, reason: 'NO_SAFE_CANDIDATE' }
  if (best.confidence < HEALING_POLICY.threshold) return { candidate: null, reason: 'LOW_CONFIDENCE' }
  // Compare all plausible runners-up, including duplicates with no unique locator.
  const competitor = ranked.filter(candidate => candidate !== best && candidate.reason !== 'CONTRACT_ATTRIBUTE_CONFLICT')[0]
  if (competitor && best.confidence - competitor.confidence < HEALING_POLICY.minimumMargin) return { candidate: null, reason: 'INSUFFICIENT_MARGIN' }
  return { candidate: best, reason: 'CONFIDENT_UNIQUE_CANDIDATE' }
}
