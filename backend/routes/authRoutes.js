import { Router } from 'express'
import { authController } from '../controllers/authController.js'
import { authMiddleware } from '../middleware/authMiddleware.js'

export function authRoutes(store, sessions) {
  const router = Router()
  router.post('/login', authController(store, sessions))
  router.get('/me', authMiddleware(sessions), (req, res) => res.json({ user: req.user }))
  router.post('/logout', authMiddleware(sessions), (req, res) => {
    sessions.delete(req.token)
    res.sendStatus(204)
  })
  return router
}
