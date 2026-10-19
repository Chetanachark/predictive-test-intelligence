import { test } from '../../healing/fixtures.js'
import { FAMILIES } from './protocol.js'
import { runProgression } from './scenarios.js'
for (const [index, family] of FAMILIES.entries()) {
  test(`PROG-00${index + 1} ${family} degradation preserves original oracle`, async ({ app, page, healing }, info) => {
    await runProgression({ app, page, healing }, info, family)
  })
}
