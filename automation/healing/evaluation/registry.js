import { EXPERIMENTS } from '../../experiments/registry.js'

export const EVALUATION_CASES = Object.freeze([
  { id: 'healthy', mutation: 'S4-BASE-001-v1', family: 'healthy', expectedRecovery: false },
  { id: 'rename', mutation: 'S4-LOC-001-v1', family: 'locator', expectedRecovery: true },
  { id: 'identical-duplicate', mutation: 'S4-LOC-002-v1', family: 'locator', expectedRecovery: false },
  { id: 'distinct-duplicate', mutation: 'S4-LOC-002-v1', family: 'locator', expectedRecovery: true },
  ...EXPERIMENTS.filter(item => item.kind === 'source').map(item => ({ id: item.id, mutation: item.id, family: 'business', expectedRecovery: false })),
  ...EXPERIMENTS.filter(item => item.scenario === 'checkout-action' && item.kind !== 'none').map(item => ({ id: item.id, mutation: item.id, family: 'actionability', expectedRecovery: false })),
].map((item, index) => Object.freeze({ ...item, testId: `HEAL-${String(index + 1).padStart(3, '0')}` })))
