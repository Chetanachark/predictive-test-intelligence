import { Router } from 'express'
import { orderController } from '../controllers/orderController.js'
import { authMiddleware } from '../middleware/authMiddleware.js'

export function orderRoutes(store, sessions) {
  const router = Router()
  const controller = orderController(store)
  router.use(authMiddleware(sessions))
  router.post('/', controller.create)
  router.get('/:id', controller.get)
  return router
}
