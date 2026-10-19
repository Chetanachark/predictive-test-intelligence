import { test } from '../fixtures.js'
import { navigationScenario } from './scenarios.js'
for (const [index, variant] of ['good-only', 'bad-only'].entries()) {
  test(`LEARNTRAIN-00${index + 1} ${variant}`, async ({ app, page, healing }, testInfo) => {
    await navigationScenario({ app, page, healing }, testInfo, variant, 'training')
  })
}
