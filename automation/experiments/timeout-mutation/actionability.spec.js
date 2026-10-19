import { test, expect } from '../fixtures.js'
import { enterDemo, startCheckout } from '../../utils/flows.js'
import { customer } from '../../utils/testData.js'

for (const number of ['001', '002', '003']) {
  test.describe(`Actionability mutation ${number}`, () => {
    test.use({ mutation: `S4-ACTION-${number}-v1` })
    test(`EXPACTION-${number} checkout cannot act on an unavailable control`, async ({ app, page, fault }) => {
      await enterDemo(app)
      await startCheckout(app)
      await app.checkout.fillCustomer(customer)
      // includeHidden isolates actionability from role-locator visibility filtering.
      const button = page.getByRole('button', { name: 'Place order', exact: true, includeHidden: true })
      await expect(button).toBeEnabled()
      await expect(button).toBeVisible()
      await fault.applyDOM(button)
      await expect(button).toHaveCount(1)
      if (number === '003') await expect(button).toBeDisabled()
      else await expect(button).toBeHidden()
      await fault.confirm(number === '003' ? 'Unique submit button is disabled.' : 'Unique submit button exists but is not rendered.')
      await button.click({ timeout: 500 })
    })
  })
}
