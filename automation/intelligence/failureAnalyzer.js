import { FAILURE_TYPES } from '../telemetry/taxonomy.js'
import { isFailure } from './metrics.js'

export function analyzeFailures(rows) {
  const counts = Object.fromEntries(FAILURE_TYPES.map(type => [type, 0]))
  const phases = {}
  const sources = {}
  let failedAttempts = 0
  for (const row of rows) {
    if (!isFailure(row)) continue
    if (!Object.hasOwn(counts, row.failure_type)) throw new Error(`Unknown observed failure type: ${row.failure_type}`)
    counts[row.failure_type]++
    failedAttempts++
    phases[row.failure_phase] = (phases[row.failure_phase] || 0) + 1
    sources[row.classification_source] = (sources[row.classification_source] || 0) + 1
  }
  return {
    failedAttempts, counts, phases, classificationSources: sources,
    primaryFailureTypes: FAILURE_TYPES.filter(type => counts[type] > 0).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)),
  }
}
