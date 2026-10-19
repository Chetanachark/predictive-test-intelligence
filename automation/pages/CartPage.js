export class CartPage {
  constructor(page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: 'Your cart', exact: true })
    this.items = page.getByRole('article')
    this.total = page.getByRole('heading', { name: /^Total:/ })
    this.emptyMessage = page.getByText('Your cart is empty.', { exact: true })
    this.checkoutLink = page.getByRole('link', { name: 'Proceed to checkout', exact: true })
  }

  item(name) {
    return this.page.getByRole('article', { name, exact: true })
  }

  quantity(name) {
    return this.item(name).getByRole('spinbutton', { name: `Quantity for ${name}`, exact: true })
  }

  increaseButton(name) {
    return this.item(name).getByRole('button', { name: `Increase quantity of ${name}`, exact: true })
  }

  decreaseButton(name) {
    return this.item(name).getByRole('button', { name: `Decrease quantity of ${name}`, exact: true })
  }

  async increase(name) {
    await this.increaseButton(name).click()
  }

  async decrease(name) {
    await this.decreaseButton(name).click()
  }

  async remove(name) {
    await this.item(name).getByRole('button', { name: `Remove ${name}`, exact: true }).click()
  }

  async openCheckout() {
    await this.checkoutLink.click()
  }
}
