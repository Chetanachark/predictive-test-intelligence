export class CheckoutPage {
  constructor(page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: 'Checkout', exact: true })
    this.fullName = page.getByRole('textbox', { name: 'Full Name', exact: true })
    this.email = page.getByRole('textbox', { name: 'Email', exact: true })
    this.address = page.getByRole('textbox', { name: 'Address', exact: true })
    this.couponInput = page.getByRole('textbox', { name: 'Coupon code', exact: true })
    this.applyCouponButton = page.getByRole('button', { name: 'Apply coupon', exact: true })
    this.placeOrderButton = page.getByRole('button', { name: 'Place order', exact: true })
    this.alerts = page.getByRole('alert')
    this.couponStatus = page.getByRole('status')
    this.subtotal = page.locator('p').filter({ hasText: /^Subtotal:/ }).locator('strong')
    this.discount = page.locator('p').filter({ hasText: /^Discount:/ }).locator('strong')
    this.total = page.locator('p').filter({ hasText: /^Total:/ }).locator('strong')
    // Confirmation is part of the checkout workflow; no sixth page object is needed.
    this.successMessage = page.getByRole('status').filter({ hasText: 'Your demo order was placed successfully.' })
    this.orderNumber = page.getByText(/^Order number: ORD-/)
    this.confirmationTotal = page.getByRole('heading', { name: /^Total:/ })
    this.confirmationItems = page.getByRole('listitem')
    this.historyLink = page.getByRole('link', { name: 'View order history', exact: true })
    this.continueShoppingLink = page.getByRole('link', { name: 'Continue Shopping', exact: true })
  }

  async fillCustomer({ name, email, address }) {
    await this.fullName.fill(name)
    await this.email.fill(email)
    await this.address.fill(address)
  }

  async applyCoupon(code, { healing, reference, validate } = {}) {
    await this.couponInput.fill(code)
    if (healing) return healing.perform({
      descriptor: { strategy: 'role', role: 'button', value: 'Apply coupon' }, reference, validate,
    })
    await this.applyCouponButton.click()
  }

  async submit({ healing, reference, validate } = {}) {
    if (healing) return healing.perform({
      descriptor: { strategy: 'role', role: 'button', value: 'Place order', includeHidden: true }, reference, validate,
    })
    await this.placeOrderButton.click()
  }

  async readOrderNumber() {
    const text = await this.orderNumber.innerText()
    return text.replace('Order number: ', '').trim()
  }

  async openHistory() {
    await this.historyLink.click()
  }

  async continueShopping() {
    await this.continueShoppingLink.click()
  }
}
