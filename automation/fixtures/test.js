import { test as base, expect } from '@playwright/test'
import { LoginPage } from '../pages/LoginPage.js'
import { ProductsPage } from '../pages/ProductsPage.js'
import { CartPage } from '../pages/CartPage.js'
import { CheckoutPage } from '../pages/CheckoutPage.js'
import { OrdersPage } from '../pages/OrdersPage.js'

export const test = base.extend({
  runtimeErrors: [async ({ page }, use, testInfo) => {
    const errors = []
    const capture = error => errors.push(`${error.name}: ${error.message}`)
    page.on('pageerror', capture)
    try { await use() }
    finally {
      page.off('pageerror', capture)
      if (errors.length) await testInfo.attach('telemetry-runtime-errors', {
        body: Buffer.from(JSON.stringify(errors)), contentType: 'application/json',
      })
    }
  }, { auto: true }],
  app: async ({ page }, use) => {
    // Keep the SUT independent of external font service availability.
    // No application requests or application state are mocked.
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort())
    await use({
      login: new LoginPage(page),
      products: new ProductsPage(page),
      cart: new CartPage(page),
      checkout: new CheckoutPage(page),
      orders: new OrdersPage(page),
    })
  },
})

export { expect }
