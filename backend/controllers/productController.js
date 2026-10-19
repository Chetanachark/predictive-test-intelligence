export function productController(store) {
  return async (_req, res) => {
    const { products, currency } = await store.read()
    res.json({ products, currency })
  }
}
