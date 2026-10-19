import { test as base, expect } from '../fixtures/test.js'
import { HealingEngine } from './healingEngine.js'

export const test = base.extend({
  healingMode: ['ADAPTIVE', { option: true }],
  healing: async ({ page, healingMode }, use, testInfo) => {
    const events = []
    const engine = new HealingEngine(page, { mode: healingMode, record: async event => {
      const index = events.findIndex(item => item.operation_id === event.operation_id)
      if (index === -1) events.push(event)
      else events[index] = event
      // Attach eagerly so a later assertion/timeout cannot erase the recovery evidence.
      const body = Buffer.from(JSON.stringify({ mode: healingMode, events }))
      // Playwright emits an attachment when attach() is called. Mutating an
      // earlier attachment body does not publish a new reporter snapshot.
      await testInfo.attach('healing-events', { body, contentType: 'application/json' })
    } })
    await use(engine)
  },
})
export { expect }
