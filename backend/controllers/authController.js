import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function authController(store, sessions) {
  return async (req, res) => {
    const { email, password } = req.body ?? {}
    if (typeof email !== 'string' || typeof password !== 'string' || password.length > 256) {
      return res.status(400).json({ message: 'Email and password are required.' })
    }
    const db = await store.read()
    const user = db.users.find(item => item.email === email.trim().toLowerCase())
    const stored = user?.passwordHash ?? hashPassword('invalid-password', 'dummy-salt')
    const [salt, digest] = stored.split(':')
    const valid = timingSafeEqual(Buffer.from(digest, 'hex'), scryptSync(password, salt, 64))
    if (!user || !valid) return res.status(401).json({ message: 'Invalid email or password.' })
    const token = randomBytes(32).toString('hex')
    const profile = { id: user.id, name: user.name, email: user.email }
    for (const [key, value] of sessions) {
      if (value.expiresAt <= Date.now()) sessions.delete(key)
    }
    sessions.set(token, { user: profile, expiresAt: Date.now() + 8 * 60 * 60 * 1000 })
    res.json({ token, user: profile })
  }
}
