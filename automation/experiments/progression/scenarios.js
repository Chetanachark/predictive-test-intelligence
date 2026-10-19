import { expect } from '@playwright/test'
import { enterDemo } from '../../utils/flows.js'
import { FaultController, assertStateInvariant } from '../injector.js'
import { VERSION, progression, expectedFailure } from './protocol.js'

export async function runProgression({ app, page, healing }, info, family) {
  const seed = Number(process.env.PROGRESSION_SEED)
  const observation = progression(seed, family)[info.repeatEachIndex]
  if (!observation) throw new Error('Observation outside the declared progression')
  const { phase, jitter, benignSlow } = observation
  const transient = phase === 'retry-warning' && info.retry === 0
  const terminal = phase === 'failure'
  const degraded = ['warning', 'critical', 'aborted'].includes(phase)
  const definition = { id: `S75-${family}-v1`, variant: `${VERSION}.${phase}`, scenario: `${family}-degradation`,
    version: '1.0.0', kind: 'dom', faultType: `${family.toUpperCase()}_PROGRESSION`, expected: terminal ? expectedFailure(family) : null }
  const fault = new FaultController(page, info, definition)
  info.annotations.push({ type: 'telemetry_note', description: JSON.stringify({ progression: {
    seed, family, step: observation.step, phase, protocol: VERSION,
  } }) })
  await enterDemo(app)
  await app.products.addToCart('Laptop')
  await app.products.openCart()
  const link = app.cart.checkoutLink
  const reference = await healing.remember(link)
  // Browser timers emulate an increasing client-side rendering/settling delay.
  // No measured duration, outcome, retry or healing evidence is fabricated.
  const settle = (phase === 'critical' ? 500 : degraded ? 220 : phase === 'retry-warning' ? 80 : benignSlow ? 650 : 0) + jitter
  await link.evaluate(async (element, delay) => {
    element.setAttribute('aria-busy', 'true')
    await new Promise(resolve => setTimeout(resolve, delay))
    element.removeAttribute('aria-busy')
  }, settle)
  if (family === 'state') {
    const total = app.cart.total
    const stale = await total.evaluate((element, options) => {
      const correct = element.textContent
      element.textContent = 'Total: ₹0'
      if (!options.permanent) setTimeout(() => { element.textContent = correct }, options.delay)
      return element.textContent
    }, { permanent: terminal || transient, delay: degraded ? 450 + jitter : 20 })
    expect(stale).toBe('Total: ₹0')
    fault.markApplied({ method: 'isolated-browser-dom', phase, observation: 'Transient or permanent stale cart total in rendered view; React state is unchanged.' })
    await fault.confirm('Stale rendered total independently observed before the unchanged total invariant.')
    await assertStateInvariant(fault, () => expect(total).toHaveText('Total: ₹50,000', { timeout: 750 }))
    return
  }
  if (family === 'synchronization') {
    const hidden = await link.evaluate((element, options) => {
      element.style.setProperty('display', 'none', 'important')
      if (!options.permanent) setTimeout(() => element.style.removeProperty('display'), options.delay)
      return getComputedStyle(element).display === 'none'
    }, { permanent: terminal || transient, delay: degraded ? 50 + jitter : 20 })
    expect(hidden).toBe(true)
  } else if (terminal) {
    await link.evaluate(element => element.after(element.cloneNode(true)))
    await expect(link).toHaveCount(2)
  } else if (transient) {
    await link.evaluate(element => element.remove())
    await expect(link).toHaveCount(0)
  } else if (degraded && (family === 'recovery' || phase !== 'aborted')) {
    await link.evaluate(element => { element.textContent = 'Proceed to purchase' })
    await expect(link).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Proceed to purchase', exact: true })).toHaveCount(1)
  }
  fault.markApplied({ method: 'isolated-browser-dom', phase, settle_ms: settle, transient })
  await fault.confirm('The isolated DOM perturbation and rendering barrier were observed before the original checkout action.')
  await healing.perform({ descriptor: { strategy: 'role', role: 'link', value: 'Proceed to checkout', includeHidden: family === 'synchronization' }, reference, validate: () => expect(app.checkout.heading).toBeVisible() })
}
