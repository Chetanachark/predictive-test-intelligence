export const FAILURE_TYPES = Object.freeze([
  'LOCATOR_NOT_FOUND',
  'LOCATOR_AMBIGUOUS',
  'ACTIONABILITY_FAILURE',
  'ASSERTION_MISMATCH',
  'STATE_CONSISTENCY_FAILURE',
  'APPLICATION_RUNTIME_ERROR',
  'SETUP_ENVIRONMENT_FAILURE',
  'UNKNOWN',
])

export const STATUS_MAP = Object.freeze({
  passed: 'PASS', failed: 'FAIL', timedOut: 'TIMED_OUT',
  skipped: 'SKIPPED', interrupted: 'INTERRUPTED',
})

export function classifyFailure({ status, errors = [], phase = 'test', category = '', runtimeErrors = [], annotation }) {
  if (status === 'PASS' || status === 'SKIPPED') return { type: null, source: 'NONE' }
  if (annotation) {
    if (!FAILURE_TYPES.includes(annotation)) throw new Error(`Invalid failure_type annotation: ${annotation}`)
    return { type: annotation, source: 'ANNOTATION' }
  }
  if (phase === 'setup' || phase === 'teardown') {
    return { type: 'SETUP_ENVIRONMENT_FAILURE', source: 'HEURISTIC' }
  }
  const message = errors.map(error => error.message || error.value || '').join('\n')
    .replace(/\u001b\[[0-9;]*m/g, '')
  if (/strict mode violation|resolved to [2-9]\d* elements/i.test(message)) {
    return { type: 'LOCATOR_AMBIGUOUS', source: 'HEURISTIC' }
  }
  // Assertion failures remain assertion failures even when their matcher times out.
  if (category === 'expect' || /expect\([^\n]*\)|AssertionError/i.test(message)) {
    return { type: 'ASSERTION_MISMATCH', source: 'HEURISTIC' }
  }
  if (/element is not (visible|enabled|stable|editable)|intercepts pointer events|outside of the viewport/i.test(message)) {
    return { type: 'ACTIONABILITY_FAILURE', source: 'HEURISTIC' }
  }
  if (/no element matches|resolved to 0 elements|element(?:s)? not found/i.test(message) ||
      (/locator\.(click|fill|check|selectOption|press):.*(?:timeout|exceeded)/i.test(message) &&
       /waiting for (getBy|locator\()/i.test(message) && !/locator resolved to|resolved to.*element/i.test(message))) {
    return { type: 'LOCATOR_NOT_FOUND', source: 'HEURISTIC' }
  }
  if (runtimeErrors.length || /(?:^|\n)(?:Error: )?(?:page\.evaluate: )?(?:TypeError|ReferenceError|SyntaxError):/m.test(message)) {
    return { type: 'APPLICATION_RUNTIME_ERROR', source: 'HEURISTIC' }
  }
  return { type: 'UNKNOWN', source: 'UNKNOWN' }
}

export function failurePhase(step) {
  const titles = []
  for (let current = step; current; current = current.parent) titles.push(current.title)
  if (titles.some(title => /beforeAll|beforeEach|Before Hooks|fixture:/i.test(title))) return 'setup'
  if (titles.some(title => /afterAll|afterEach|After Hooks/i.test(title))) return 'teardown'
  return 'test'
}
