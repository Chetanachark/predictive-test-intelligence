import { randomUUID } from 'node:crypto'

export function orderController(store) {
  return {
    create: async (req, res) => {
      const { items, shipping } = req.body ?? {}
      if (!Array.isArray(items) || !items.length || items.length > 100 ||
          !shipping || ['name', 'address', 'city', 'postalCode'].some(key =>
            typeof shipping[key] !== 'string' || !shipping[key].trim() || shipping[key].length > 200)) {
        return res.status(400).json({ message: 'Provide cart items and complete shipping details.' })
      }
      const order = await store.update(db => {
        const seen = new Set()
        const lines = items.map(item => {
          const product = db.products.find(product => product.id === item.productId)
          if (!product || seen.has(item.productId) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
            const error = new Error('Cart contains invalid products or quantities.')
            error.status = 400
            throw error
          }
          seen.add(item.productId)
          return { productId: product.id, name: product.name, price: product.price, quantity: item.quantity }
        })
        const result = {
          id: randomUUID(), userId: req.user.id, createdAt: new Date().toISOString(),
          status: 'confirmed', currency: db.currency, items: lines,
          total: lines.reduce((sum, line) => sum + line.price * line.quantity, 0),
          shipping: Object.fromEntries(['name', 'address', 'city', 'postalCode'].map(key => [key, shipping[key].trim()]))
        }
        db.orders.push(result)
        return result
      })
      res.status(201).json({ order })
    },
    get: async (req, res) => {
      const db = await store.read()
      const order = db.orders.find(item => item.id === req.params.id && item.userId === req.user.id)
      if (!order) return res.status(404).json({ message: 'Order not found.' })
      res.json({ order })
    }
  }
}
