import fs from 'node:fs'
import { HEALING_DEFAULTS, summarizeHealing, validateHealingEvent } from './healingHistory.js'

// Bridge fixture evidence to the canonical reporter; publication is one journaled
// transaction in HistoryStore, rather than two independent reporters/writers.
export function readHealingResult(attachments, status, mode = 'NONE') {
  const attachment = attachments.findLast(item => item.name === 'healing-events')
  if (!attachment) return { ...HEALING_DEFAULTS, healing_mode: mode, healing_events: [] }
  const payload = JSON.parse(attachment.body ? attachment.body.toString('utf8') : fs.readFileSync(attachment.path, 'utf8'))
  if (!['BASELINE', 'ADAPTIVE'].includes(payload.mode) || !Array.isArray(payload.events)) throw new Error('Invalid healing attachment')
  const events = payload.events.map(event => {
    validateHealingEvent(event)
    if (event.healing_mode !== payload.mode) throw new Error('Mixed healing modes in one attempt')
    return event.healing_successful && status !== 'PASS'
      ? { ...event, healing_successful: false, healing_reason: 'FINAL_TEST_DID_NOT_PASS' } : event
  })
  if (payload.learningEnabled !== undefined && typeof payload.learningEnabled !== 'boolean') throw new Error('Invalid learningEnabled attachment')
  if (events.some(event => (event.learningEnabled || false) !== (payload.learningEnabled || false))) throw new Error('Mixed learning settings in one attempt')
  return summarizeHealing(events, payload.mode, payload.learningEnabled || false)
}
