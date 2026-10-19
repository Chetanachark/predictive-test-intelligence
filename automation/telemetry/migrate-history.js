import { fileURLToPath } from 'node:url'
import { HistoryStore } from './history.js'
const directory = process.env.TELEMETRY_DIR || fileURLToPath(new URL('../../dataset', import.meta.url))
try {
  const result = new HistoryStore(directory).migrate()
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`Migration failed: ${error.message}`)
  process.exitCode = 1
}
