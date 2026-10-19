import { test } from '../fixtures.js'
import { navigationScenario, businessControl } from './scenarios.js'
export const VARIANTS = ['healthy', 'good-only', 'both', 'identical', 'unsafe-href', 'business-control']
for (const [index, variant] of VARIANTS.entries()) {
  test(`LEARN-00${index + 1} ${variant}`, async ({ app, page, healing }, testInfo) => {
    if (variant === 'business-control') await businessControl({ app, page, healing }, testInfo)
    else await navigationScenario({ app, page, healing }, testInfo, variant, 'heldout')
  })
}
