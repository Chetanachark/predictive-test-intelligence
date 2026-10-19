import { test, expect } from '../fixtures.js'
import { enterDemo } from '../../utils/flows.js'

for (const number of ['001', '002']) {
  test.describe(`Locator mutation ${number}`, () => {
    test.use({ mutation: `S4-LOC-${number}-v1` })
    test(`EXPLOC-${number} original checkout locator detects a DOM mutation`, async ({ app, page, fault }) => {
      await enterDemo(app)
      await app.products.addToCart('Laptop')
      await app.products.openCart()
      await expect(app.cart.checkoutLink).toHaveCount(1)
      await fault.applyDOM(app.cart.checkoutLink)
      if (number === '001') {
        await expect(page.getByRole('link', { name: 'Proceed to purchase', exact: true })).toHaveCount(1)
        await expect(app.cart.checkoutLink).toHaveCount(0)
        await fault.confirm('Original accessible name absent; renamed checkout link present.')
      } else {
        await expect(app.cart.checkoutLink).toHaveCount(2)
        await fault.confirm('Two links match the unchanged checkout locator.')
      }
      // Preserve the original action: no fallback and no expected-failure suppression.
      await app.cart.checkoutLink.click({ timeout: 500 })
    })
  })
}
