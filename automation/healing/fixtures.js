import { test as base, expect } from '../fixtures/test.js'
import path from 'node:path'
import { PROJECT_ROOT, createRunMetadata } from '../telemetry/metadata.js'
import { KnowledgeBase } from './knowledgeBase.js'
import { HealingEngine } from './healingEngine.js'

export const test = base.extend({
  healingMode: ['ADAPTIVE', { option: true }],
  learningEnabled: [false, { option: true }],
  healing: async ({ page, healingMode, learningEnabled, browserName }, use, testInfo) => {
    const events = []
    const knowledgeFile = process.env.HEALING_KNOWLEDGE_BASE || path.join(process.env.TELEMETRY_DIR || path.join(PROJECT_ROOT, 'dataset'), 'knowledge-base.json')
    const engine = new HealingEngine(page, { mode: healingMode, learningEnabled,
      knowledgeBase: learningEnabled ? new KnowledgeBase(knowledgeFile) : null,
      learningContext: learningEnabled ? { appVersion: createRunMetadata({ workers: testInfo.config.workers }).app_version, browser: browserName } : null, record: async event => {
      const index = events.findIndex(item => item.operation_id === event.operation_id)
      if (index === -1) events.push(event)
      else events[index] = event
      // Attach eagerly so a later assertion/timeout cannot erase the recovery evidence.
      const body = Buffer.from(JSON.stringify({ mode: healingMode, learningEnabled, events }))
      // Playwright emits an attachment when attach() is called. Mutating an
      // earlier attachment body does not publish a new reporter snapshot.
      await testInfo.attach('healing-events', { body, contentType: 'application/json' })
    } })
    await use(engine)
  },
})
export { expect }
