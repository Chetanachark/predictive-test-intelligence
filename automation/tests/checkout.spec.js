import { test, expect } from '../fixtures/test.js'
import { coupons, customer, primaryProduct, orderNumberPattern } from '../utils/testData.js'
import { formatPrice } from '../utils/values.js'
import { enterDemo, startCheckout, finishCheckout } from '../utils/flows.js'

test.describe('Checkout', () => {
  test.beforeEach(async ({ app }) => {
    await enterDemo(app)
    await startCheckout(app)
  })

  test('CHECKOUT-001 empty form is blocked by required-field validation', async ({ app, page }) => {
    await app.checkout.submit()
    for (const field of [app.checkout.fullName, app.checkout.email, app.checkout.address]) {
      await expect(field).toHaveAttribute('required', '')
      expect(await field.evaluate(element => element.validity.valueMissing)).toBe(true)
    }
    await expect(page).toHaveURL(/\/checkout$/)
    await expect(app.checkout.successMessage).toHaveCount(0)
    await expect(app.products.cartLink).toHaveText('Cart (1)')
  })

  test('CHECKOUT-002 invalid coupon shows validation and cannot place an order', async ({ app, page }) => {
    await app.checkout.fillCustomer(customer)
    await app.checkout.applyCoupon(coupons.invalid)
    await expect(app.checkout.alerts).toHaveText('Invalid coupon code.')
    await expect(app.checkout.discount).toHaveText(formatPrice(0))
    await expect(app.checkout.total).toHaveText(formatPrice(50000))
    await app.checkout.submit()
    await expect(page).toHaveURL(/\/checkout$/)
    await expect(app.checkout.alerts).toHaveText('Apply or clear the coupon before placing your order.')
  })

  for (const { id, code, discount, total } of [
    { id: '003', code: coupons.save10, discount: 5000, total: 45000 },
    { id: '004', code: coupons.welcome20, discount: 10000, total: 40000 },
  ]) {
    test(`CHECKOUT-${id} ${code} applies the correct discount`, async ({ app }) => {
      await app.checkout.applyCoupon(code)
      await expect(app.checkout.couponStatus).toHaveText(`${code} applied: ${code === coupons.save10 ? 10 : 20}% discount.`)
      await expect(app.checkout.subtotal).toHaveText(formatPrice(50000))
      await expect(app.checkout.discount).toHaveText(formatPrice(discount))
      await expect(app.checkout.total).toHaveText(formatPrice(total))
      await finishCheckout(app)
      await expect(app.checkout.confirmationTotal).toHaveText(`Total: ${formatPrice(total)}`)
    })
  }

  test('CHECKOUT-005 successful order confirms details, clears cart, and reduces stock', async ({ app, page }) => {
    const number = await finishCheckout(app)
    expect(number).toMatch(orderNumberPattern)
    await expect(page).toHaveURL(/\/success$/)
    await expect(app.checkout.confirmationItems).toHaveText([`${primaryProduct.name} × 1 — ${formatPrice(50000)}`])
    await expect(app.checkout.confirmationTotal).toHaveText(`Total: ${formatPrice(50000)}`)
    await expect(app.products.cartLink).toHaveText('Cart (0)')
    await app.checkout.continueShopping()
    await expect(app.products.product(primaryProduct.name).getByText('In stock: 4', { exact: true })).toBeVisible()
    await app.products.openCart()
    await expect(app.cart.emptyMessage).toBeVisible()
  })

  test('CHECKOUT-006 empty coupon keeps full price', async ({ app }) => {
    await app.checkout.applyCoupon('')
    await expect(app.checkout.couponStatus).toHaveText('No coupon applied.')
    await expect(app.checkout.discount).toHaveText(formatPrice(0))
    await expect(app.checkout.total).toHaveText(formatPrice(50000))
  })

  test('CHECKOUT-007 malformed email blocks checkout', async ({ app, page }) => {
    await app.checkout.fillCustomer({ ...customer, email: 'invalid-email' })
    await app.checkout.submit()
    expect(await app.checkout.email.evaluate(element => element.validity.typeMismatch)).toBe(true)
    await expect(page).toHaveURL(/\/checkout$/)
    await expect(app.products.cartLink).toHaveText('Cart (1)')
  })

  test('CHECKOUT-008 editing an applied coupon removes its discount', async ({ app }) => {
    await app.checkout.applyCoupon(coupons.save10)
    await expect(app.checkout.total).toHaveText(formatPrice(45000))
    await app.checkout.couponInput.fill(coupons.invalid)
    await expect(app.checkout.discount).toHaveText(formatPrice(0))
    await expect(app.checkout.total).toHaveText(formatPrice(50000))
  })
})
