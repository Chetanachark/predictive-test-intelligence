import { test, expect } from '../fixtures/test.js'
import { primaryProduct, secondProduct } from '../utils/testData.js'
import { formatPrice } from '../utils/values.js'
import { enterDemo } from '../utils/flows.js'

test.describe('Cart', () => {
  test.beforeEach(async ({ app }) => {
    await enterDemo(app)
    await app.products.addToCart(primaryProduct.name)
    await app.products.openCart()
    await expect(app.cart.heading).toBeVisible()
  })

  test('CART-001 increase quantity updates total', async ({ app }) => {
    await app.cart.increase(primaryProduct.name)
    await expect(app.cart.quantity(primaryProduct.name)).toHaveValue('2')
    await expect(app.cart.total).toHaveText(`Total: ${formatPrice(100000)}`)
  })

  test('CART-002 decrease quantity updates total', async ({ app }) => {
    await app.cart.increase(primaryProduct.name)
    await expect(app.cart.quantity(primaryProduct.name)).toHaveValue('2')
    await app.cart.decrease(primaryProduct.name)
    await expect(app.cart.quantity(primaryProduct.name)).toHaveValue('1')
    await expect(app.cart.total).toHaveText(`Total: ${formatPrice(50000)}`)
  })

  test('CART-003 remove the last item shows an empty cart', async ({ app }) => {
    await app.cart.remove(primaryProduct.name)
    await expect(app.cart.items).toHaveCount(0)
    await expect(app.cart.emptyMessage).toBeVisible()
    await expect(app.cart.checkoutLink).toHaveCount(0)
  })

  test('CART-004 multiple items contribute to the total', async ({ app }) => {
    await app.products.open()
    await app.products.addToCart(secondProduct.name)
    await app.products.openCart()
    await expect(app.cart.items).toHaveCount(2)
    await expect(app.cart.total).toHaveText(`Total: ${formatPrice(65000)}`)
  })

  test('CART-005 quantity cannot decrease below one', async ({ app }) => {
    await expect(app.cart.quantity(primaryProduct.name)).toHaveValue('1')
    await expect(app.cart.decreaseButton(primaryProduct.name)).toBeDisabled()
  })

  test('CART-006 quantity cannot increase above stock', async ({ app }) => {
    await app.products.open()
    await app.products.addToCart(secondProduct.name)
    await app.products.openCart()
    await app.cart.increase(secondProduct.name)
    await expect(app.cart.quantity(secondProduct.name)).toHaveValue('2')
    await expect(app.cart.increaseButton(secondProduct.name)).toBeDisabled()
  })
})
