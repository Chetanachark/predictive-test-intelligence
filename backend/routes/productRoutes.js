import { Router } from 'express'
import { productController } from '../controllers/productController.js'

export function productRoutes(store) {
  const router = Router()
  router.get('/', productController(store))
  return router
}
