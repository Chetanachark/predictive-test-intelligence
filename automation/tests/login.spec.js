import { test, expect } from '../fixtures/test.js'
import { demoUser } from '../utils/testData.js'

test.describe('Demo login', () => {
  test.beforeEach(async ({ app }) => {
    await app.login.open()
  })

  test('LOGIN-001 successful login opens the local product catalog', async ({ app, page }) => {
    await expect(app.login.heading).toBeVisible()
    await app.login.login(demoUser)
    await expect(page).toHaveURL(/\/products$/)
    await expect(app.products.heading).toBeVisible()
    await expect(app.products.cards).toHaveCount(25)
  })
})
