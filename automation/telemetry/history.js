import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { healingRows, serializeHealingCSV } from '../healing/healingHistory.js'
import { CSV_COLUMNS, LEGACY_COLUMNS, V2_COLUMNS, V3_COLUMNS, validateHistory, validateRecord, upgradeRecord } from './schema.js'

export function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  const fd = fs.openSync(temporary, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, content)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  try { fs.renameSync(temporary, file) }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
}

function csvCell(value) {
  const text = value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function serializeCSV(records) {
  const version = records[0]?.schema_version ?? 4
  if (records.some(record => record.schema_version !== version)) throw new Error('Mixed schema versions require migration')
  const columns = version === 1 ? LEGACY_COLUMNS : version === 2 ? V2_COLUMNS : version === 3 ? V3_COLUMNS : CSV_COLUMNS
  return [columns.join(','), ...records.map(record => columns.map(column => csvCell(record[column])).join(','))].join('\r\n') + '\r\n'
}

export class HistoryStore {
  constructor(directory) {
    this.directory = path.resolve(directory)
    this.json = path.join(this.directory, 'execution-history.json')
    this.csv = path.join(this.directory, 'test-history.csv')
    this.pending = path.join(this.directory, '.history-pending.json')
    this.lock = path.join(this.directory, '.history-lock')
  }

  withLock(action) {
    fs.mkdirSync(this.directory, { recursive: true })
    const deadline = Date.now() + 5_000
    while (true) {
      try { fs.mkdirSync(this.lock); break }
      catch (error) {
        if (error.code !== 'EEXIST') throw error
        let ownerDescription = 'owner metadata unavailable'
        try {
          const owner = JSON.parse(fs.readFileSync(path.join(this.lock, 'owner.json'), 'utf8'))
          ownerDescription = `PID ${owner.pid} on ${owner.hostname}`
        } catch { /* A writer can be between mkdir and writing owner metadata. */ }
        if (Date.now() >= deadline) {
          throw new Error(`History lock held (${ownerDescription}). If a runner crashed, confirm it has exited before removing ${this.lock}; journal recovery runs on the next access.`)
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
      }
    }
    try {
      fs.writeFileSync(path.join(this.lock, 'owner.json'), JSON.stringify({ pid: process.pid, hostname: os.hostname() }))
      return action()
    } finally { fs.rmSync(this.lock, { recursive: true, force: true }) }
  }

  writeSnapshot(records) {
    atomicWrite(this.json, JSON.stringify(records, null, 2) + '\n')
    atomicWrite(this.csv, serializeCSV(records))
    if (!records.length || records.every(row => row.schema_version >= 3)) {
      const rows = healingRows(records)
      atomicWrite(path.join(this.directory, 'healing-history.json'), JSON.stringify(rows, null, 2) + '\n')
      atomicWrite(path.join(this.directory, 'healing-history.csv'), serializeHealingCSV(rows, { legacy: records[0]?.schema_version === 3 }))
    }
  }

  recover() {
    if (!fs.existsSync(this.pending)) return
    const records = validateHistory(JSON.parse(fs.readFileSync(this.pending, 'utf8')))
    this.writeSnapshot(records)
    fs.unlinkSync(this.pending)
  }

  readUnlocked() {
    this.recover()
    if (!fs.existsSync(this.json)) {
      if (fs.existsSync(this.csv)) throw new Error('CSV exists without authoritative JSON history')
      return []
    }
    const records = validateHistory(JSON.parse(fs.readFileSync(this.json, 'utf8')))
    if (!fs.existsSync(this.csv) || fs.readFileSync(this.csv, 'utf8') !== serializeCSV(records)) {
      throw new Error('JSON and CSV are inconsistent; refusing to overwrite existing history')
    }
    if (records.every(row => row.schema_version >= 3)) {
      const rows = healingRows(records)
      const expected = [['healing-history.json', JSON.stringify(rows, null, 2) + '\n'], ['healing-history.csv', serializeHealingCSV(rows, { legacy: records[0]?.schema_version === 3 })]]
      for (const [file, content] of expected) {
        if (!fs.existsSync(path.join(this.directory, file)) || fs.readFileSync(path.join(this.directory, file), 'utf8') !== content) throw new Error('Healing history projection is inconsistent; restore the projection from authoritative execution history')
      }
    }
    return records
  }

  append(record) {
    validateRecord(record)
    if (record.schema_version !== 4) throw new Error('New records must use schema v4')
    return this.withLock(() => {
      const records = this.readUnlocked()
      if (records.some(item => item.schema_version !== 4)) throw new Error('Run npm run telemetry:migrate before appending to legacy schema history')
      const existing = records.find(item => item.attempt_id === record.attempt_id)
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('Conflicting duplicate attempt_id')
        return false
      }
      records.push(record)
      // Write-ahead journal repairs interrupted execution/healing JSON/CSV publication on the next access.
      atomicWrite(this.pending, JSON.stringify(records))
      this.writeSnapshot(records)
      fs.unlinkSync(this.pending)
      return true
    })
  }


  migrate() {
    return this.withLock(() => {
      const records = this.readUnlocked()
      if (!records.some(record => record.schema_version !== 4)) return { migrated: 0, backup: null }
      const backup = path.join(this.directory, 'migrations', randomUUID())
      fs.mkdirSync(backup, { recursive: true })
      const from = records[0].schema_version
      fs.copyFileSync(this.json, path.join(backup, `execution-history.v${from}.json`))
      fs.copyFileSync(this.csv, path.join(backup, `test-history.v${from}.csv`))
      const next = records.map(upgradeRecord)
      atomicWrite(this.pending, JSON.stringify(next))
      this.writeSnapshot(next)
      fs.unlinkSync(this.pending)
      atomicWrite(path.join(backup, 'migration.json'), JSON.stringify({
        from, to: 4, count: records.length, migrated_at: new Date().toISOString(),
        original_sha256: createHash('sha256').update(fs.readFileSync(path.join(backup, `execution-history.v${from}.json`))).digest('hex'),
      }, null, 2) + '\n')
      return { migrated: records.length, backup }
    })
  }

  validate() {
    return this.withLock(() => {
      const records = this.readUnlocked()
      for (const record of records) {
        for (const key of ['trace_path', 'screenshot_path']) {
          if (record[key] && !fs.existsSync(path.join(this.directory, record[key]))) throw new Error(`Missing artifact: ${record[key]}`)
        }
      }
      return records
    })
  }
}
