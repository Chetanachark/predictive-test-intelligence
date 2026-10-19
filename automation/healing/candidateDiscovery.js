import { performance } from 'node:perf_hooks'
import { HEALING_POLICY, textSimilarity } from './confidenceScore.js'

const quoted = value => JSON.stringify(value)
export function locatorFromDescriptor(page, descriptor) {
  if (!descriptor || typeof descriptor.value !== 'string') throw new Error('A serializable locator descriptor is required')
  const { strategy, value, role, attributes = {} } = descriptor
  let locator
  if (strategy === 'role') locator = page.getByRole(role, { name: value, exact: true, includeHidden: descriptor.includeHidden === true })
  else if (strategy === 'label') locator = page.getByLabel(value, { exact: true })
  else if (strategy === 'text') locator = page.getByText(value, { exact: true })
  else if (strategy === 'testId') locator = page.getByTestId(value)
  else if (strategy === 'ariaLabel') locator = page.locator(`[aria-label=${quoted(value)}]`)
  else throw new Error(`Unsupported candidate strategy: ${strategy}`)
  const allowed = ['href', 'type', 'name', 'id']
  for (const [key, val] of Object.entries(attributes)) {
    if (!allowed.includes(key) || typeof val !== 'string') throw new Error('Unsupported locator attribute')
    locator = locator.and(page.locator(`[${key}=${quoted(val)}]`))
  }
  return locator
}

export async function readFeatures(locator) {
  const features = await locator.evaluate(element => {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const label = [...(element.labels || [])].map(item => item.textContent.trim()).join(' ').slice(0, 200)
    const context = []
    for (let parent = element.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
      const heading = [...parent.children].find(child => /^H[1-6]$/.test(child.tagName))
      context.push([parent.tagName.toLowerCase(), parent.getAttribute('role') || '', parent.getAttribute('aria-label') || '', heading?.textContent || ''].join(' '))
    }
    return { tag: element.tagName.toLowerCase(), role: '', name: '', text, label,
      testId: element.getAttribute('data-testid') || '', ariaLabel: element.getAttribute('aria-label') || '',
      attributes: Object.fromEntries(['href', 'type', 'name', 'id'].map(key => [key, element.getAttribute(key) || ''])),
      context: context.join(' ').replace(/\s+/g, ' ').trim() }
  }, undefined, { timeout: HEALING_POLICY.actionTimeoutMs })
  // Ask Playwright for its accessible role/name, instead of reimplementing ARIA.
  const snapshot = await locator.ariaSnapshot({ timeout: 700 })
  const match = snapshot.match(/^- ([\w-]+)(?: ("(?:\\.|[^"\\])*"))?/)
  features.role = match?.[1] || ''
  features.name = match?.[2] ? JSON.parse(match[2]) : features.ariaLabel || features.label || features.text
  return features
}

export async function discoverCandidates(page, reference) {
  // Discovery is read-only. No synthetic IDs, DOM writes, positional clicks, or force.
  const deadline = performance.now() + HEALING_POLICY.discoveryTimeoutMs
  const pool = page.getByRole(reference.role)
  const count = await pool.count()
  if (count > HEALING_POLICY.maxCandidates) throw new Error('Candidate budget exceeded; narrow the page context')
  const candidates = []
  const nodes = await pool.all()
  for (const node of nodes) {
    if (performance.now() > deadline) throw new Error('Candidate discovery time budget exceeded')
    if (!await node.isVisible()) continue
    const features = await readFeatures(node)
    if (features.tag !== reference.tag || features.role !== reference.role) continue
    const descriptors = [
      { strategy: 'role', role: features.role, value: features.name },
      ...(features.label ? [{ strategy: 'label', value: features.label }] : []),
      ...(features.text ? [{ strategy: 'text', value: features.text }] : []),
      ...(features.testId ? [{ strategy: 'testId', value: features.testId }] : []),
      ...(features.ariaLabel ? [{ strategy: 'ariaLabel', value: features.ariaLabel }] : []),
    ]
    // Attribute-scoped semantic descriptors resolve distinguishable ambiguity.
    const attributes = Object.fromEntries(Object.entries(features.attributes).filter(([, value]) => value))
    if (Object.keys(attributes).length) descriptors.push({ strategy: 'role', role: features.role, value: features.name, attributes })
    let descriptor = null
    for (const option of descriptors) {
      const candidate = locatorFromDescriptor(page, option)
      if (await candidate.count() !== 1) continue
      const handle = await node.elementHandle({ timeout: HEALING_POLICY.actionTimeoutMs })
      try {
        if (await candidate.evaluate((element, target) => element === target, handle, { timeout: HEALING_POLICY.actionTimeoutMs })) {
          descriptor = option
          break
        }
      } finally { await handle?.dispose() }
    }
    // Keep non-addressable duplicates in ranking: ambiguity must not disappear.
    const semanticSimilarity = textSimilarity(reference.name, features.name)
    candidates.push({ descriptor, features, discoveredBy: [...new Set([...descriptors.map(item => item.strategy), ...(semanticSimilarity > 0 ? ['semanticSimilarity'] : [])])] })
  }
  return candidates
}
