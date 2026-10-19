import { createHash } from 'node:crypto'
import { mutateSource } from './registry.js'

export class FaultController {
  constructor(page, testInfo, definition) {
    this.page = page
    this.testInfo = testInfo
    this.definition = definition
    this.verified = false
    this.applied = false
    this.evidence = null
    for (const [type, description] of Object.entries({
      experiment_id: definition.id, fault_variant: definition.variant, scenario_variant: definition.scenario,
      fault_type: definition.faultType, mutation_version: definition.version,
      locator_mutation: definition.kind === 'dom' && definition.scenario === 'checkout-navigation' ? definition.operation : '',
      expected_failure_type: definition.expected ?? '', emulated: String(definition.kind !== 'none'),
      injection_verified: 'false',
    })) this.annotate(type, description)
  }

  annotate(type, description) {
    this.testInfo.annotations.push({ type, description })
  }

  markApplied(evidence) {
    if (this.applied) throw new Error('Only one fault may be injected into an attempt')
    this.applied = true
    this.evidence = { ...evidence, experiment_id: this.definition.id, mutation_version: this.definition.version }
    this.annotate('injected_at', new Date().toISOString())
  }

  async install() {
    if (this.definition.kind !== 'source') return
    await this.page.route(url => url.pathname === '/src/context/shopState.js', async route => {
      try {
        const response = await route.fetch()
        if (response.status() !== 200) throw new Error(`Mutation source returned HTTP ${response.status()}`)
        const original = await response.text()
        const mutated = mutateSource(this.definition, original)
        this.markApplied({
          method: 'browser-module-response', module: '/src/context/shopState.js',
          original_sha256: createHash('sha256').update(original).digest('hex'),
          mutated_sha256: createHash('sha256').update(mutated).digest('hex'),
          anchor: this.definition.pattern.source, replacement: this.definition.replacement,
        })
        await route.fulfill({ response, body: mutated, headers: { ...response.headers(), 'cache-control': 'no-store' } })
      } catch (error) {
        this.injectionError = error.message
        this.annotate('telemetry_note', `Injection failed: ${error.message}`)
        await route.abort('failed')
      }
    })
  }

  async applyDOM(locator) {
    if (this.definition.kind !== 'dom') throw new Error('DOM mutation requested for a non-DOM variant')
    const evidence = await locator.evaluate((element, operation) => {
      const original = { text: element.textContent, hidden: element.hidden, disabled: Boolean(element.disabled), display: element.style.getPropertyValue('display'), displayPriority: element.style.getPropertyPriority('display') }
      if (operation === 'rename') element.textContent = 'Proceed to purchase'
      else if (operation === 'duplicate') element.after(element.cloneNode(true))
      else if (operation === 'hide') { element.hidden = true; element.style.setProperty('display', 'none', 'important') }
      else if (operation === 'disable') element.disabled = true
      else if (operation === 'delay') {
        element.hidden = true
        element.style.setProperty('display', 'none', 'important')
        // The control is in the DOM but not rendered for longer than the action budget.
        setTimeout(() => {
          element.hidden = original.hidden
          if (original.display) element.style.setProperty('display', original.display, original.displayPriority)
          else element.style.removeProperty('display')
        }, 30_000)
      } else throw new Error(`Unsupported DOM operation: ${operation}`)
      return { method: 'isolated-browser-dom', operation, original }
    }, this.definition.operation)
    this.markApplied(evidence)
  }

  async confirm(observation) {
    if (!this.applied || this.injectionError) throw new Error(this.injectionError || 'Mutation was not applied')
    this.verified = true
    this.annotate('injection_verified', 'true')
    const evidence = { ...this.evidence, observation }
    this.annotate('telemetry_note', JSON.stringify(evidence))
    await this.testInfo.attach('mutation-evidence', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json',
    })
  }
}

// Only a failed, explicitly chosen state invariant receives this researcher label.
// Mutation metadata alone never determines an observed failure_type.
export async function assertStateInvariant(fault, assertion) {
  if (!fault.verified) throw new Error('Cannot classify an unverified mutation as a state inconsistency')
  try { await assertion() }
  catch (error) {
    fault.annotate('failure_type', 'STATE_CONSISTENCY_FAILURE')
    fault.annotate('telemetry_note', 'Researcher-labeled failure of the explicitly checked state invariant.')
    throw error
  }
}
