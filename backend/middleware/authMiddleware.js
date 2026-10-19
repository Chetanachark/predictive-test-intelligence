export function authMiddleware(sessions) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    const session = sessions.get(token)
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(token)
      return res.status(401).json({ message: 'Please log in again.' })
    }
    req.user = session.user
    req.token = token
    next()
  }
}
