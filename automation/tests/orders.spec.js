import { test, expect } from '../fixtures/test.js'
import { primaryProduct, secondProduct, coupons, orderNumberPattern } from '../utils/testData.js'
import { formatPrice } from '../utils/values.js'
import { enterDemo, startCheckout, finishCheckout } from '../utils/flows.js'

test.describe('Order history', () => {
  test.beforeEach(async ({ app }) => {
    await enterDemo(app)
  })

  test('ORDERS-001 a placed order appears with its date, items, and final total', async ({ app }) => {
    await startCheckout(app)
    await app.checkout.applyCoupon(coupons.save10)
    const number = await finishCheckout(app)
    expect(number).toMatch(orderNumberPattern)
    await app.checkout.openHistory()
    await expect(app.orders.heading).toBeVisible()
    await expect(app.orders.orders).toHaveCount(1)
    await expect(app.orders.order(number)).toBeVisible()
    await expect(app.orders.items(number)).toHaveText([`${primaryProduct.name} × 1 — ${formatPrice(50000)}`])
    await expect(app.orders.total(number)).toHaveText(`Total: ${formatPrice(45000)}`)
    await expect(app.orders.date(number)).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const date = await app.orders.date(number).getAttribute('datetime')
    expect(Number.isNaN(Date.parse(date))).toBe(false)
  })

  test('ORDERS-002 multiple orders remain visible, newest first', async ({ app }) => {
    await startCheckout(app)
    const first = await finishCheckout(app)
    await app.checkout.continueShopping()
    await startCheckout(app, secondProduct.name)
    const second = await finishCheckout(app)
    expect(second).not.toBe(first)
    await app.orders.open()
    await expect(app.orders.orders).toHaveCount(2)
    await expect(app.orders.orders.getByRole('heading', { name: /^Order number:/ })).toHaveText([
      `Order number: ${second}`, `Order number: ${first}`,
    ])
    await expect(app.orders.items(first)).toHaveText([`${primaryProduct.name} × 1 — ${formatPrice(50000)}`])
    await expect(app.orders.total(first)).toHaveText(`Total: ${formatPrice(50000)}`)
    await expect(app.orders.items(second)).toHaveText([`${secondProduct.name} × 1 — ${formatPrice(15000)}`])
    await expect(app.orders.total(second)).toHaveText(`Total: ${formatPrice(15000)}`)
  })

  test('ORDERS-003 a fresh test has no order history', async ({ app }) => {
    await app.orders.open()
    await expect(app.orders.heading).toBeVisible()
    await expect(app.orders.orders).toHaveCount(0)
    await expect(app.orders.emptyMessage).toBeVisible()
  })
})
