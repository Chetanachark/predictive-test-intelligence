import { test, expect } from '../fixtures/test.js'
import { catalog, categoryNames, primaryProduct } from '../utils/testData.js'
import { namesByPrice } from '../utils/values.js'
import { enterDemo } from '../utils/flows.js'

test.describe('Product catalog', () => {
  test.beforeEach(async ({ app }) => {
    await enterDemo(app)
  })

  test('PRODUCTS-001 all 25 products are visible', async ({ app }) => {
    await expect(app.products.cards).toHaveCount(25)
    await expect(app.products.productNames).toHaveText(catalog.map(product => product.name).sort((a, b) => a.localeCompare(b)))
  })

  test('PRODUCTS-002 search matches product names', async ({ app }) => {
    await app.products.search('Ultrabook')
    await expect(app.products.cards).toHaveCount(1)
    await expect(app.products.productNames).toHaveText(['Ultrabook'])
  })

  test('PRODUCTS-003 partial search is case insensitive', async ({ app }) => {
    await app.products.search('  PHONE  ')
    await expect(app.products.productNames).toHaveText([
      'Budget Smartphone', 'Compact Smartphone', 'Flagship Smartphone',
      'Foldable Smartphone', 'Headphones', 'Smartphone',
    ])
  })

  test('PRODUCTS-004 unmatched search shows the empty state', async ({ app }) => {
    await app.products.search('NoSuchProduct987')
    await expect(app.products.cards).toHaveCount(0)
    await expect(app.products.noResults).toBeVisible()
  })

  test('PRODUCTS-005 clearing search restores products', async ({ app }) => {
    await app.products.search('Ultrabook')
    await expect(app.products.cards).toHaveCount(1)
    await app.products.search('')
    await expect(app.products.cards).toHaveCount(25)
  })

  for (const [index, category] of categoryNames.entries()) {
    test(`PRODUCTS-${String(index + 6).padStart(3, '0')} category filter shows only ${category}`, async ({ app }) => {
      await app.products.filterCategory(category)
      const expected = catalog.filter(product => product.category === category)
        .map(product => product.name).sort((a, b) => a.localeCompare(b))
      await expect(app.products.cards).toHaveCount(5)
      await expect(app.products.productNames).toHaveText(expected)
    })
  }

  test('PRODUCTS-011 sort price low to high', async ({ app }) => {
    await app.products.sortBy('Price Low-High')
    await expect(app.products.productNames).toHaveText(namesByPrice('ascending', catalog))
  })

  test('PRODUCTS-012 sort price high to low', async ({ app }) => {
    await app.products.sortBy('Price High-Low')
    await expect(app.products.productNames).toHaveText(namesByPrice('descending', catalog))
  })

  test('PRODUCTS-013 sort changes dynamically', async ({ app }) => {
    await app.products.sortBy('Name Z-A')
    await expect(app.products.productNames).toHaveText(catalog.map(product => product.name).sort((a, b) => b.localeCompare(a)))
    await app.products.sortBy('Name A-Z')
    await expect(app.products.productNames).toHaveText(catalog.map(product => product.name).sort((a, b) => a.localeCompare(b)))
  })

  test('PRODUCTS-014 category, search, and sort work together', async ({ app }) => {
    await app.products.filterCategory('Gaming')
    await app.products.search('Gaming')
    await app.products.sortBy('Price High-Low')
    await expect(app.products.productNames).toHaveText(['Gaming Laptop', 'Gaming Keyboard', 'Gaming Headset', 'Gaming Mouse'])
    await app.products.search('')
    await app.products.filterCategory('All categories')
    await expect(app.products.productNames).toHaveText(namesByPrice('descending', catalog))
  })

  test('PRODUCTS-015 adding a product updates the cart', async ({ app }) => {
    await app.products.addToCart(primaryProduct.name)
    await expect(app.products.cartLink).toHaveText('Cart (1)')
    await app.products.openCart()
    await expect(app.cart.item(primaryProduct.name)).toBeVisible()
    await expect(app.cart.quantity(primaryProduct.name)).toHaveValue('1')
  })

  test('PRODUCTS-016 out-of-stock products cannot be added', async ({ app }) => {
    await expect(app.products.product('Headphones')).toContainText('Out of Stock')
    await expect(app.products.addButton('Headphones')).toBeDisabled()
    await expect(app.products.cartLink).toHaveText('Cart (0)')
  })
})
