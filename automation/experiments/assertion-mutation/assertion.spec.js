import { test, expect } from '../fixtures.js'
import { enterDemo, startCheckout } from '../../utils/flows.js'
import { formatPrice } from '../../utils/values.js'

test.use({ mutation: 'S4-ASSERT-001-v1' })
test('EXPASSERT-001 SAVE10 business oracle detects the emulated five-percent defect', async ({ app, fault }) => {
  await enterDemo(app)
  await startCheckout(app)
  await app.checkout.applyCoupon('SAVE10')
  // Confirm the served module mutation actually affected business behavior.
  await expect(app.checkout.discount).toHaveText(formatPrice(2500))
  await fault.confirm('SAVE10 produced 2500 discount on a 50000 subtotal (5%).')
  // Original healthy expectation remains 10%, not a deliberately incorrect test expectation.
  await expect(app.checkout.discount).toHaveText(formatPrice(5000))
})
