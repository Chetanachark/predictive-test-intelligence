import { fileURLToPath } from 'node:url'
import { createStore } from './storage/jsonStore.js'
import { hashPassword } from './controllers/authController.js'
import { createApp } from './app.js'

const store = createStore(process.env.DB_PATH || fileURLToPath(new URL('./db.json', import.meta.url)))
await store.update(db => {
  const email = process.env.DEMO_EMAIL || 'student@example.com'
  if (!db.users.some(user => user.email === email)) {
    db.users.push({ id: 'demo-student', name: 'Demo Student', email,
      passwordHash: hashPassword(process.env.DEMO_PASSWORD || 'Student@123') })
  }
})
const port = Number(process.env.PORT || 3001)
const server = createApp(store).listen(port, '127.0.0.1', () => {
  console.log(`API ready at http://127.0.0.1:${port}`)
})
server.on('error', error => { console.error(error.message); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close())
