import express from 'express'
import { authRoutes } from './routes/authRoutes.js'
import { productRoutes } from './routes/productRoutes.js'
import { orderRoutes } from './routes/orderRoutes.js'
import { errorHandler } from './middleware/errorHandler.js'

export function createApp(store) {
  const app = express()
  const sessions = new Map()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '32kb' }))
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
  app.use('/api/auth', authRoutes(store, sessions))
  app.use('/api/products', productRoutes(store))
  app.use('/api/orders', orderRoutes(store, sessions))
  app.use((_req, res) => res.status(404).json({ message: 'Endpoint not found.' }))
  app.use(errorHandler)
  return app
}
