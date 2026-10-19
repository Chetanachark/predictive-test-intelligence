import { createHash } from 'node:crypto'

export const VERSION = 'temporal-progression-v1'
export const SEEDS = Object.freeze([103, 211, 307, 419, 521, 631])
export const FAMILIES = Object.freeze(['locator', 'synchronization', 'state', 'recovery'])
export function progression(seed, family) {
  if (!Number.isInteger(seed) || !FAMILIES.includes(family)) throw new Error('Invalid progression configuration')
  const bytes = createHash('sha256').update(`${VERSION}:${seed}:${family}`).digest()
  const warm = 3 + bytes[0] % 3
  const phases = [
    ...Array(warm).fill('healthy'), 'retry-warning', 'warning', 'critical', 'failure', 'failure',
    'repair', 'healthy', 'healthy', 'warning', 'aborted', 'healthy', 'healthy',
    'retry-warning', 'warning', 'critical', 'failure', 'repair', 'healthy', 'healthy',
  ]
  // Fixed length lets repeatEachIndex identify the observation without being a predictor.
  while (phases.length < 26) phases.push('healthy')
  return phases.map((phase, step) => ({ step, phase,
    jitter: bytes[(step + 1) % bytes.length] % 60,
    benignSlow: phase === 'healthy' && step === warm - 1,
  }))
}
export function expectedFinal(phase) { return phase === 'failure' ? 'FAIL' : 'PASS' }
export function expectedFailure(family) {
  return family === 'state' ? 'STATE_CONSISTENCY_FAILURE' : family === 'synchronization' ? 'ACTIONABILITY_FAILURE' : 'LOCATOR_AMBIGUOUS'
}
export const protocolHash = () => createHash('sha256').update(JSON.stringify({ VERSION, SEEDS, plans: SEEDS.map(seed => FAMILIES.map(family => progression(seed, family))) })).digest('hex')
