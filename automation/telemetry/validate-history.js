import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { HistoryStore } from './history.js'

const directory = process.env.TELEMETRY_DIR || fileURLToPath(new URL('../../dataset', import.meta.url))
try {
  const records = new HistoryStore(directory).validate()
  console.log(`Validated ${records.length} records: JSON/CSV synchronized; artifact links resolve in ${path.resolve(directory)}`)
} catch (error) {
  console.error(`Telemetry validation failed: ${error.message}`)
  process.exitCode = 1
}
