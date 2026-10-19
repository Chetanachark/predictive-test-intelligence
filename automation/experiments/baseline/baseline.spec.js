import { test, expect } from '../fixtures.js'
import { enterDemo, startCheckout, finishCheckout } from '../../utils/flows.js'
import { formatPrice } from '../../utils/values.js'
import { customer } from '../../utils/testData.js'

for (const [number, scenario] of [
  ['001', 'checkout-navigation'], ['002', 'coupon-save10'], ['003', 'stock-after-order'],
  ['004', 'cart-after-order'], ['005', 'order-total'], ['006', 'checkout-action'],
]) {
  test.describe(`Healthy ${scenario}`, () => {
    test.use({ mutation: `S4-BASE-${number}-v1` })
    test(`EXPBASE-${number} healthy ${scenario}`, async ({ app, page }) => {
      await enterDemo(app)
      if (scenario === 'checkout-navigation') {
        await app.products.addToCart('Laptop')
        await app.products.openCart()
        await app.cart.openCheckout()
        await expect(app.checkout.heading).toBeVisible()
        return
      }
      await startCheckout(app)
      if (scenario === 'coupon-save10') {
        await app.checkout.applyCoupon('SAVE10')
        await expect(app.checkout.discount).toHaveText(formatPrice(5000))
        await expect(app.checkout.total).toHaveText(formatPrice(45000))
        return
      }
      if (scenario === 'checkout-action') {
        await app.checkout.fillCustomer(customer)
        await page.getByRole('button', { name: 'Place order', exact: true, includeHidden: true }).click()
        await expect(app.checkout.successMessage).toBeVisible()
        return
      }
      await finishCheckout(app)
      if (scenario === 'stock-after-order') {
        await app.checkout.continueShopping()
        await expect(app.products.product('Laptop').getByText('In stock: 4', { exact: true })).toBeVisible()
      } else if (scenario === 'cart-after-order') {
        await expect(app.products.cartLink).toHaveText('Cart (0)')
      } else {
        await expect(app.checkout.confirmationTotal).toHaveText(`Total: ${formatPrice(50000)}`)
      }
    })
  })
}
