import { test, expect } from '../fixtures.js'
import { FaultController, assertStateInvariant } from '../../experiments/injector.js'
import { experimentById } from '../../experiments/registry.js'
import { EVALUATION_CASES } from './registry.js'
import { enterDemo } from '../../utils/flows.js'
import { customer } from '../../utils/testData.js'
import { formatPrice } from '../../utils/values.js'

for (const scenario of EVALUATION_CASES) {
  test(`${scenario.testId} ${scenario.id}`, async ({ app, page, healing }, testInfo) => {
    const original = experimentById(scenario.mutation)
    const definition = { ...original, id: `S6-${scenario.id}-v1`, variant: `${scenario.id}.v1`, version: '1.0.0' }
    const fault = new FaultController(page, testInfo, definition)
    testInfo.annotations.push({ type: 'evaluation_scenario', description: scenario.id })
    await fault.install()
    await enterDemo(app)
    await app.products.addToCart('Laptop')
    await app.products.openCart()
    const navigation = scenario.family === 'locator' || scenario.family === 'healthy'
    if (!navigation) await app.cart.openCheckout()
    if (!navigation && original.scenario !== 'coupon-save10') await app.checkout.fillCustomer(customer)
    if (original.scenario === 'coupon-save10') await app.checkout.couponInput.fill('SAVE10')
    const target = navigation ? app.cart.checkoutLink : original.scenario === 'coupon-save10' ? app.checkout.applyCouponButton : app.checkout.placeOrderButton
    const reference = await healing.remember(target)
    // Independent target identity for evaluation only. The engine never reads
    // this marker, the scenario ID, or expected failure/recovery labels.
    await target.evaluate(element => {
      window.__healingTargetClicked = false
      element.addEventListener('click', () => { window.__healingTargetClicked = true }, { once: true })
    })
    if (original.kind === 'dom') {
      await fault.applyDOM(target)
      if (scenario.id === 'distinct-duplicate') {
        await page.getByRole('link', { name: 'Proceed to checkout', exact: true }).evaluateAll(elements => elements[1].setAttribute('href', '/products'))
      }
      if (scenario.family === 'locator') {
        await expect(app.cart.checkoutLink).toHaveCount(scenario.id === 'rename' ? 0 : 2)
        if (scenario.id === 'distinct-duplicate') await expect(page.locator('a[href="/products"]').filter({ hasText: 'Proceed to checkout' })).toHaveCount(1)
      } else if (definition.operation === 'disable') await expect(target).toBeDisabled()
      else await expect(target).toBeHidden()
      await fault.confirm('Independent pre-action DOM observation confirms the configured mutation.')
    }
    try {
      const validate = async () => {
        if (navigation) {
          await expect(app.checkout.heading).toBeVisible()
          await app.checkout.fillCustomer(customer)
          await app.checkout.submit()
        } else if (original.scenario === 'coupon-save10') {
          await expect(app.checkout.discount).toHaveText(formatPrice(2500))
          await fault.confirm('Served module produces 5% rather than the original 10% coupon rate.')
          await expect(app.checkout.discount).toHaveText(formatPrice(5000))
          return
        }
        await expect(app.checkout.successMessage).toBeVisible()
        if (scenario.family === 'business') {
          if (original.scenario === 'stock-after-order') {
            await app.checkout.continueShopping()
            await expect(app.products.product('Laptop').getByText('In stock: 5', { exact: true })).toBeVisible()
            await fault.confirm('Order placed but stock remains 5.')
            await assertStateInvariant(fault, () => expect(app.products.product('Laptop').getByText('In stock: 4', { exact: true })).toBeVisible())
          } else if (original.scenario === 'cart-after-order') {
            await expect(app.products.cartLink).toHaveText('Cart (1)')
            await fault.confirm('Order placed but cart remains populated.')
            await assertStateInvariant(fault, () => expect(app.products.cartLink).toHaveText('Cart (0)'))
          } else {
            await expect(app.checkout.confirmationTotal).toHaveText(`Total: ${formatPrice(51000)}`)
            await fault.confirm('Persisted total is 51000 rather than the line total of 50000.')
            await assertStateInvariant(fault, () => expect(app.checkout.confirmationTotal).toHaveText(`Total: ${formatPrice(50000)}`))
          }
          return
        }
        // Unchanged healthy business oracle used by both modes, also after recovery.
        await expect(app.checkout.confirmationItems).toHaveText([`Laptop × 1 — ${formatPrice(50000)}`])
        await expect(app.checkout.confirmationTotal).toHaveText(`Total: ${formatPrice(50000)}`)
        await expect(app.products.cartLink).toHaveText('Cart (0)')
        const order = await app.checkout.readOrderNumber()
        await app.orders.open()
        await expect(app.orders.orders).toHaveCount(1)
        await expect(app.orders.total(order)).toHaveText(`Total: ${formatPrice(50000)}`)
        await app.products.open()
        await expect(app.products.product('Laptop').getByText('In stock: 4', { exact: true })).toBeVisible()
      }
      if (navigation) await app.cart.openCheckout({ healing, reference, validate })
      else if (original.scenario === 'coupon-save10') await app.checkout.applyCoupon('SAVE10', { healing, reference, validate })
      else await app.checkout.submit({ healing, reference, validate })
    } finally {
      const truth = { scenario: scenario.id, family: scenario.family,
        intendedTargetClicked: await page.evaluate(() => window.__healingTargetClicked === true) }
      testInfo.annotations.push({ type: 'telemetry_note', description: JSON.stringify({ healing_ground_truth: truth }) })
      await testInfo.attach('healing-ground-truth', { body: Buffer.from(JSON.stringify(truth)), contentType: 'application/json' })
    }
  })
}
