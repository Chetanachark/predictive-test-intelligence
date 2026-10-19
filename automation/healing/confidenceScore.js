export const HEALING_POLICY = Object.freeze({
  version: 'semantic-v1', threshold: 0.82, minimumMargin: 0.12,
  maxCandidates: 80, discoveryTimeoutMs: 4_000, actionTimeoutMs: 700,
  weights: Object.freeze({ role: 0.20, name: 0.25, text: 0.15, attributes: 0.25, context: 0.15 }),
})

const words = text => String(text || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
const synonyms = Object.freeze({ purchase: 'checkout', buy: 'checkout', basket: 'cart', proceed: 'continue', submit: 'place' })
export function textSimilarity(left, right) {
  const a = new Set(words(left).map(word => synonyms[word] || word))
  const b = new Set(words(right).map(word => synonyms[word] || word))
  if (!a.size || !b.size) return 0
  return [...a].filter(word => b.has(word)).length / new Set([...a, ...b]).size
}

export function confidenceScore(reference, candidate) {
  const keys = Object.keys(reference.attributes).filter(key => reference.attributes[key])
  const signals = {
    role: reference.role === candidate.role ? 1 : 0,
    name: textSimilarity(reference.name, candidate.name),
    text: textSimilarity(reference.text || reference.label, candidate.text || candidate.label),
    attributes: keys.length ? keys.filter(key => reference.attributes[key] === candidate.attributes[key]).length / keys.length : null,
    context: reference.context ? textSimilarity(reference.context, candidate.context) : null,
  }
  const available = Object.entries(signals).filter(([, value]) => value !== null)
  const weight = available.reduce((sum, [key]) => sum + HEALING_POLICY.weights[key], 0)
  const score = available.reduce((sum, [key, value]) => sum + HEALING_POLICY.weights[key] * value, 0) / weight
  return { confidence: Number(score.toFixed(6)), signals }
}
