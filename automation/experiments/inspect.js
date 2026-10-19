import fs from 'node:fs'
import path from 'node:path'
import { HistoryStore } from '../telemetry/history.js'
import { PROJECT_ROOT } from '../telemetry/metadata.js'

try {
  const directory = path.resolve(process.env.TELEMETRY_DIR || path.join(PROJECT_ROOT, 'dataset'))
  const args = process.argv.slice(2)
  let rows = new HistoryStore(directory).validate()
  while (args.length) {
    const option = args.shift()
    if (['--run-id', '--experiment', '--status', '--failure-type'].includes(option)) {
      const value = args.shift()
      if (!value) throw new Error(`Missing value for ${option}`)
      const field = { '--run-id': 'run_id', '--experiment': 'experiment_id', '--status': 'status', '--failure-type': 'failure_type' }[option]
      rows = rows.filter(row => row[field] === value)
    }
    else if (option === '--verified-campaigns') {
      const campaigns = path.join(directory, 'campaigns')
      const attempts = new Set()
      if (fs.existsSync(campaigns)) {
        for (const entry of fs.readdirSync(campaigns, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          const manifest = JSON.parse(fs.readFileSync(path.join(campaigns, entry.name, 'campaign.json'), 'utf8'))
          if (manifest.status === 'VERIFIED') for (const id of manifest.attempt_ids) attempts.add(id)
        }
      }
      rows = rows.filter(row => attempts.has(row.attempt_id))
    }
    else if (option === '--latest-campaign') {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'campaigns/latest.json'), 'utf8'))
      const attempts = new Set(manifest.attempt_ids)
      rows = rows.filter(row => attempts.has(row.attempt_id))
    } else throw new Error(`Unknown query: ${option}`)
  }
  const countBy = key => Object.fromEntries([...new Set(rows.map(row => row[key] ?? 'NONE'))]
    .map(value => [value, rows.filter(row => (row[key] ?? 'NONE') === value).length]))
  console.log(JSON.stringify({ records: rows.length, status: countBy('status'), failure_type: countBy('failure_type'),
    fault_type: countBy('fault_type'), emulated: countBy('emulated'), experiment_id: countBy('experiment_id') }, null, 2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
