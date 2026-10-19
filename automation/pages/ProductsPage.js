export class ProductsPage {
  constructor(page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: 'Products', exact: true })
    this.searchInput = page.getByRole('searchbox', { name: 'Search products', exact: true })
    this.categorySelect = page.getByRole('combobox', { name: 'Category', exact: true })
    this.sortSelect = page.getByRole('combobox', { name: 'Sort products', exact: true })
    this.cards = page.getByRole('article')
    this.productNames = this.cards.getByRole('heading', { level: 2 })
    this.noResults = page.getByText('No products found.', { exact: true })
    const navigation = page.getByRole('navigation', { name: 'Main navigation' })
    this.productsLink = navigation.getByRole('link', { name: 'Products', exact: true })
    this.cartLink = navigation.getByRole('link', { name: /^Cart \(\d+\)$/ })
  }

  product(name) {
    return this.page.getByRole('article', { name, exact: true })
  }

  addButton(name) {
    return this.product(name).getByRole('button', { name: `Add ${name} to cart`, exact: true })
  }

  async search(value) {
    await this.searchInput.fill(value)
  }

  async filterCategory(label) {
    await this.categorySelect.selectOption({ label })
  }

  async sortBy(label) {
    await this.sortSelect.selectOption({ label })
  }

  async addToCart(name) {
    await this.addButton(name).click()
  }

  // SPA links preserve the app's in-memory cart, stock, and history.
  async open() {
    await this.productsLink.click()
  }

  async openCart() {
    await this.cartLink.click()
  }
}
