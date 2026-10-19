import { expect } from '@playwright/test'
import { enterDemo } from '../../utils/flows.js'
import { customer } from '../../utils/testData.js'
import { formatPrice } from '../../utils/values.js'
import { FaultController } from '../../experiments/injector.js'
import { experimentById } from '../../experiments/registry.js'

export async function navigationScenario({ app, page, healing }, testInfo, variant, phase) {
  const healthy = variant === 'healthy'
  const fault = new FaultController(page, testInfo, {
    id: `S6-LEARNING-${variant}-v1`, variant: `${variant}.v1`, scenario: 'historical-checkout-navigation',
    version: '1.0.0', kind: healthy ? 'none' : 'dom', faultType: healthy ? '' : 'SEMANTIC_LOCATOR_MUTATION',
    expected: healthy ? null : 'LOCATOR_NOT_FOUND',
  })
  await enterDemo(app)
  await app.products.addToCart('Laptop')
  await app.products.openCart()
  const reference = await healing.remember(app.cart.checkoutLink)
  await app.cart.checkoutLink.evaluate((element, mutation) => {
    window.__learningIntendedClicked = false
    element.addEventListener('click', () => { window.__learningIntendedClicked = true })
    if (mutation === 'healthy') return
    if (mutation === 'identical') { element.after(element.cloneNode(true)); return }
    element.textContent = 'Proceed to purchase'
    if (mutation === 'unsafe-href') { element.setAttribute('href', '/products'); return }
    if (mutation === 'good-only') return
    const decoy = element.cloneNode(true)
    decoy.textContent = 'Continue to checkout'
    decoy.addEventListener('click', event => { event.preventDefault() })
    element.after(decoy)
    if (mutation === 'bad-only') element.remove()
  }, variant)
  if (!healthy) {
    if (variant === 'identical') await expect(app.cart.checkoutLink).toHaveCount(2)
    else await expect(app.cart.checkoutLink).toHaveCount(0)
    if (['good-only', 'both'].includes(variant)) await expect(page.getByRole('link', { name: 'Proceed to purchase', exact: true })).toHaveCount(1)
    if (['bad-only', 'both'].includes(variant)) await expect(page.getByRole('link', { name: 'Continue to checkout', exact: true })).toHaveCount(1)
    if (variant === 'unsafe-href') await expect(page.getByRole('link', { name: 'Proceed to purchase', exact: true })).toHaveAttribute('href', '/products')
    fault.markApplied({ method: 'isolated-browser-dom', variant })
    await fault.confirm('Original match count and mutated semantic candidates independently verified.')
  }
  try {
    await app.cart.openCheckout({ healing, reference, validate: async () => {
      // Same business oracle for training, baseline healing and adaptive healing.
      await expect(app.checkout.heading).toBeVisible()
      await app.checkout.fillCustomer(customer)
      await app.checkout.submit()
      await expect(app.checkout.successMessage).toBeVisible()
      await expect(app.checkout.confirmationTotal).toHaveText(`Total: ${formatPrice(50000)}`)
      await expect(app.products.cartLink).toHaveText('Cart (0)')
      const order = await app.checkout.readOrderNumber()
      await app.orders.open()
      await expect(app.orders.total(order)).toHaveText(`Total: ${formatPrice(50000)}`)
      await app.products.open()
      await expect(app.products.product('Laptop').getByText('In stock: 4', { exact: true })).toBeVisible()
    } })
  } finally {
    testInfo.annotations.push({ type: 'telemetry_note', description: JSON.stringify({ learning_evaluation: {
      phase, scenario: variant, family: healthy ? 'healthy' : 'locator',
      intendedTargetClicked: await page.evaluate(() => window.__learningIntendedClicked === true),
    } }) })
  }
}

export async function businessControl({ app, page, healing }, testInfo) {
  const fault = new FaultController(page, testInfo, { ...experimentById('S4-ASSERT-001-v1'), id: 'S6-LEARNING-coupon-v1' })
  await fault.install()
  await enterDemo(app)
  await app.products.addToCart('Laptop')
  await app.products.openCart()
  await app.cart.openCheckout()
  const reference = await healing.remember(app.checkout.applyCouponButton)
  await app.checkout.applyCouponButton.evaluate(element => {
    window.__learningIntendedClicked = false
    element.addEventListener('click', () => { window.__learningIntendedClicked = true })
  })
  try {
    await app.checkout.applyCoupon('SAVE10', { healing, reference, validate: async () => {
      await expect(app.checkout.discount).toHaveText(formatPrice(2500))
      await fault.confirm('Existing controlled coupon defect confirmed independently; original oracle remains 10%.')
      await expect(app.checkout.discount).toHaveText(formatPrice(5000))
    } })
  } finally {
    testInfo.annotations.push({ type: 'telemetry_note', description: JSON.stringify({ learning_evaluation: {
      phase: 'heldout', scenario: 'business-control', family: 'business',
      intendedTargetClicked: await page.evaluate(() => window.__learningIntendedClicked === true),
    } }) })
  }
}

export function evaluationTruth(row) {
  for (const line of row.notes.split('\n')) {
    try { const data = JSON.parse(line); if (data.learning_evaluation) return data.learning_evaluation }
    catch { /* Other notes are human-readable evidence. */ }
  }
  throw new Error(`Missing learning evaluation ground truth: ${row.attempt_id}`)
}
