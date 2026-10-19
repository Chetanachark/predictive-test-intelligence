export class OrdersPage {
  constructor(page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: 'Order history', exact: true })
    this.orders = page.getByRole('article')
    this.emptyMessage = page.getByText('No orders yet.', { exact: true })
    this.ordersLink = page.getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Orders', exact: true })
  }

  order(number) {
    return this.page.getByRole('article', { name: `Order ${number}`, exact: true })
  }

  items(number) {
    return this.order(number).getByRole('listitem')
  }

  total(number) {
    return this.order(number).getByRole('heading', { name: /^Total:/ })
  }

  date(number) {
    return this.order(number).locator('time')
  }

  async open() {
    await this.ordersLink.click()
  }
}
