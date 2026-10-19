import { test as base, expect } from '../fixtures/test.js'
import { FaultController } from './injector.js'
import { experimentById } from './registry.js'

export const test = base.extend({
  mutation: ['S4-BASE-001-v1', { option: true }],
  fault: [async ({ page, mutation }, use, testInfo) => {
    const controller = new FaultController(page, testInfo, experimentById(mutation))
    await controller.install()
    await use(controller)
    // A fresh Playwright context discards all DOM changes, timers, routes and module caches.
    // Do not restore before failure artifacts are captured; retain the fault as evidence.
  }, { auto: true }],
})
export { expect }
