import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { atomicWrite } from '../telemetry/history.js'

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
export const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex')
export const emptyKnowledge = () => ({ schemaVersion: 1, updatedAt: null, entries: [] })
export const learningScope = ({ appVersion, browser }, reference, action) => ({
  appVersion, browser, pageURL: reference.pageURL, action, policyVersion: 'semantic-v1',
  referenceFingerprint: fingerprint(Object.fromEntries(Object.entries(reference).filter(([key]) => key !== 'pageURL'))),
})
const entryKey = (scope, originalLocator, candidateLocator) => fingerprint({ scope, originalLocator, candidateLocator })
const isText = value => typeof value === 'string' && value.length > 0
const isDate = value => isText(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const keysEqual = (object, keys) => object && !Array.isArray(object) && Object.keys(object).sort().join('|') === [...keys].sort().join('|')

export function validateScope(scope) {
  if (!keysEqual(scope, ['appVersion', 'browser', 'pageURL', 'action', 'policyVersion', 'referenceFingerprint']) ||
      Object.values(scope).some(value => !isText(value)) || !['click', 'fill'].includes(scope.action) ||
      !/^[a-f0-9]{64}$/.test(scope.referenceFingerprint)) throw new Error('Invalid knowledge scope')
  return scope
}
function validateLocator(locator) {
  if (!locator || !['role', 'label', 'text', 'testId', 'ariaLabel'].includes(locator.strategy) || !isText(locator.value) ||
      locator.strategy === 'role' && !isText(locator.role)) throw new Error('Invalid knowledge locator')
}
export function validateKnowledge(data) {
  if (!keysEqual(data, ['schemaVersion', 'updatedAt', 'entries']) || data.schemaVersion !== 1 ||
      data.updatedAt !== null && !isDate(data.updatedAt) || !Array.isArray(data.entries)) throw new Error('Invalid knowledge base')
  const keys = new Set(); const operations = new Set()
  for (const entry of data.entries) {
    if (!keysEqual(entry, ['key', 'scope', 'originalLocator', 'candidateLocator', 'attempts', 'successfulRecoveries', 'failedRecoveries', 'observations'])) throw new Error('Invalid knowledge entry')
    validateScope(entry.scope); validateLocator(entry.originalLocator); validateLocator(entry.candidateLocator)
    if (entry.key !== entryKey(entry.scope, entry.originalLocator, entry.candidateLocator) || keys.has(entry.key)) throw new Error('Invalid or duplicate knowledge key')
    keys.add(entry.key)
    if (!Array.isArray(entry.observations) || !entry.observations.length) throw new Error('Knowledge requires observations')
    for (const observation of entry.observations) {
      if (!keysEqual(observation, ['operationId', 'attemptId', 'runId', 'successful', 'endTime', 'testVersion', 'source']) ||
          ['operationId', 'attemptId', 'runId'].some(key => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(observation[key])) ||
          typeof observation.successful !== 'boolean' || !isDate(observation.endTime) || !isText(observation.testVersion) ||
          !['ordinary', 'verified-experiment'].includes(observation.source) || operations.has(observation.operationId)) throw new Error('Invalid or duplicate knowledge observation')
      operations.add(observation.operationId)
    }
    const successes = entry.observations.filter(item => item.successful).length
    if (entry.attempts !== entry.observations.length || entry.successfulRecoveries !== successes ||
        entry.failedRecoveries !== entry.attempts - successes) throw new Error('Knowledge counters disagree with observations')
  }
  return data
}

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value) }
  return value
}

export class KnowledgeSnapshot {
  #entries
  constructor(data) {
    this.data = deepFreeze(structuredClone(validateKnowledge(data)))
    this.version = fingerprint(this.data)
    this.#entries = new Map(this.data.entries.map(entry => [entry.key, entry]))
  }
  lookup(scope, originalLocator, candidateLocator) {
    if (!candidateLocator) return null
    const entry = this.#entries.get(entryKey(scope, originalLocator, candidateLocator))
    return entry ? structuredClone(entry) : null
  }
}

export class KnowledgeBase {
  constructor(file) {
    this.file = path.resolve(file)
    this.lock = `${this.file}.lock`
  }
  withLock(action) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const deadline = Date.now() + 5_000
    while (true) {
      try { fs.mkdirSync(this.lock); break }
      catch (error) {
        if (error.code !== 'EEXIST') throw error
        if (Date.now() >= deadline) throw new Error(`Knowledge base lock held: ${this.lock}. Confirm the writer exited before removing a stale lock.`)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
      }
    }
    try {
      fs.writeFileSync(path.join(this.lock, 'owner.json'), JSON.stringify({ pid: process.pid, hostname: os.hostname() }))
      return action()
    }
    finally { fs.rmSync(this.lock, { recursive: true, force: true }) }
  }
  read() {
    return fs.existsSync(this.file) ? validateKnowledge(JSON.parse(fs.readFileSync(this.file, 'utf8'))) : emptyKnowledge()
  }
  initialize() {
    return this.withLock(() => {
      const data = this.read()
      if (!fs.existsSync(this.file)) atomicWrite(this.file, JSON.stringify(data, null, 2) + '\n')
      return new KnowledgeSnapshot(data)
    })
  }
  snapshot() { return new KnowledgeSnapshot(this.read()) }
  apply(observations) {
    return this.withLock(() => {
      const data = this.read()
      const existing = new Map(data.entries.flatMap(entry => entry.observations.map(observation => [observation.operationId, { key: entry.key, observation }])))
      let added = 0
      for (const item of observations) {
        validateScope(item.scope); validateLocator(item.originalLocator); validateLocator(item.candidateLocator)
        const key = entryKey(item.scope, item.originalLocator, item.candidateLocator)
        const previous = existing.get(item.observation.operationId)
        if (previous) {
          if (previous.key !== key || canonical(previous.observation) !== canonical(item.observation)) throw new Error('Conflicting duplicate feedback operation')
          continue
        }
        let entry = data.entries.find(candidate => candidate.key === key)
        if (!entry) {
          entry = { key, scope: item.scope, originalLocator: item.originalLocator, candidateLocator: item.candidateLocator,
            attempts: 0, successfulRecoveries: 0, failedRecoveries: 0, observations: [] }
          data.entries.push(entry)
        }
        entry.observations.push(item.observation)
        entry.attempts++
        if (item.observation.successful) entry.successfulRecoveries++
        else entry.failedRecoveries++
        existing.set(item.observation.operationId, { key, observation: item.observation })
        added++
      }
      if (added) {
        data.updatedAt = new Date().toISOString()
        data.entries.sort((a, b) => a.key.localeCompare(b.key))
        validateKnowledge(data)
        atomicWrite(this.file, JSON.stringify(data, null, 2) + '\n')
      }
      return { added, version: fingerprint(data), entries: data.entries.length }
    })
  }
}
