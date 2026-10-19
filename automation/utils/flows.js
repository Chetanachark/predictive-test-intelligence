import { expect } from '@playwright/test'
import { demoUser, primaryProduct, customer } from './testData.js'

export async function enterDemo(app) {
  await app.login.open()
  await app.login.login(demoUser)
  await expect(app.products.heading).toBeVisible()
}

export async function startCheckout(app, product = primaryProduct.name) {
  await app.products.addToCart(product)
  await app.products.openCart()
  await expect(app.cart.heading).toBeVisible()
  await app.cart.openCheckout()
  await expect(app.checkout.heading).toBeVisible()
}

export async function finishCheckout(app, details = customer) {
  await app.checkout.fillCustomer(details)
  await app.checkout.submit()
  await expect(app.checkout.successMessage).toBeVisible()
  return app.checkout.readOrderNumber()
}
