import { test, expect } from '../fixtures.js'
import { assertStateInvariant } from '../injector.js'
import { enterDemo, startCheckout, finishCheckout } from '../../utils/flows.js'
import { formatPrice } from '../../utils/values.js'

for (const number of ['001', '002', '003']) {
  test.describe(`State mutation ${number}`, () => {
    test.use({ mutation: `S4-STATE-${number}-v1` })
    test(`EXPSTATE-${number} checkout state invariant detects a controlled commit defect`, async ({ app, fault }) => {
      await enterDemo(app)
      await startCheckout(app)
      await finishCheckout(app)
      if (number === '001') {
        await app.checkout.continueShopping()
        await expect(app.products.product('Laptop').getByText('In stock: 5', { exact: true })).toBeVisible()
        await fault.confirm('Order confirmed but Laptop stock remains at 5.')
        await assertStateInvariant(fault, () => expect(app.products.product('Laptop').getByText('In stock: 4', { exact: true })).toBeVisible())
      } else if (number === '002') {
        await expect(app.products.cartLink).toHaveText('Cart (1)')
        await fault.confirm('Order confirmed but original cart item remains.')
        await assertStateInvariant(fault, () => expect(app.products.cartLink).toHaveText('Cart (0)'))
      } else {
        await expect(app.checkout.confirmationItems).toHaveText([`Laptop × 1 — ${formatPrice(50000)}`])
        await expect(app.checkout.confirmationTotal).toHaveText(`Total: ${formatPrice(51000)}`)
        await fault.confirm('Order line totals 50000 but persisted order total is 51000.')
        await assertStateInvariant(fault, () => expect(app.checkout.confirmationTotal).toHaveText(`Total: ${formatPrice(50000)}`))
      }
    })
  })
}
