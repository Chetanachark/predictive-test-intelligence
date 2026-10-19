import { test, expect } from '../fixtures.js'

async function pageWithButton(page) {
  await page.setContent('<main><h1>Checkout</h1><button id="purchase" type="button" data-testid="checkout" aria-label="Proceed to checkout">Proceed to checkout</button><output></output></main>')
  await page.locator('button').evaluate(element => element.addEventListener('click', () => { document.querySelector('output').textContent = 'complete' }))
}

for (const strategy of ['role', 'text', 'testId', 'ariaLabel']) {
  test(`heals a ${strategy} locator using actual browser semantics`, async ({ page, healing }) => {
    await pageWithButton(page)
    const target = page.locator('button')
    const reference = await healing.remember(target)
    const descriptor = strategy === 'role' ? { strategy, role: 'button', value: 'Proceed to checkout' }
      : { strategy, value: strategy === 'testId' ? 'checkout' : 'Proceed to checkout' }
    await target.evaluate((element, kind) => {
      if (kind === 'testId') element.setAttribute('data-testid', 'purchase')
      else if (kind === 'ariaLabel') element.setAttribute('aria-label', 'Proceed to purchase')
      else if (kind === 'text') element.textContent = 'Proceed to purchase'
      else { element.setAttribute('aria-label', 'Proceed to purchase'); element.textContent = 'Proceed to purchase' }
    }, strategy)
    const result = await healing.perform({ descriptor, reference, validate: () => expect(page.locator('output')).toHaveText('complete') })
    expect(result.healing_successful).toBe(true)
    expect(result.candidates.some(candidate => candidate.discoveredBy.includes(strategy))).toBe(true)
  })
}

test('heals a changed label and fills the intended input', async ({ page, healing }) => {
  await page.setContent('<main><h1>Cart</h1><label for="basket">Cart</label><input id="basket" name="basket"></main>')
  const reference = await healing.remember(page.getByLabel('Cart', { exact: true }))
  await page.locator('label').evaluate(element => { element.textContent = 'Basket' })
  const result = await healing.perform({ descriptor: { strategy: 'label', value: 'Cart' }, reference, action: 'fill', value: 'sample',
    validate: () => expect(page.locator('input')).toHaveValue('sample') })
  expect(result.healing_successful).toBe(true)
  expect(result.candidates[0].discoveredBy).toContain('label')
})

test('refuses identical duplicated elements without clicking either', async ({ page, healing }) => {
  await pageWithButton(page)
  const reference = await healing.remember(page.locator('button'))
  await page.locator('button').evaluate(element => element.after(element.cloneNode(true)))
  await expect(healing.perform({ descriptor: { strategy: 'role', role: 'button', value: 'Proceed to checkout' }, reference,
    validate: () => expect(page.locator('output')).toHaveText('complete') })).rejects.toThrow(/strict mode/)
  await expect(page.locator('output')).toBeEmpty()
})

test('candidate action cannot convert an original assertion mismatch into success', async ({ page, healing }) => {
  await pageWithButton(page)
  const reference = await healing.remember(page.locator('button'))
  await page.locator('button').evaluate(element => { element.setAttribute('data-testid', 'purchase') })
  let count = 0
  await expect(healing.perform({ descriptor: { strategy: 'testId', value: 'checkout' }, reference, validate: async () => {
    count++
    await expect(page.locator('output')).toHaveText('business defect remains', { timeout: 200 })
  } })).rejects.toThrow()
  expect(count).toBe(1)
  await expect(page.locator('output')).toHaveText('complete')
})

test('low semantic confidence leaves the target untouched', async ({ page, healing }) => {
  await pageWithButton(page)
  const reference = await healing.remember(page.locator('button'))
  await page.locator('button').evaluate(element => { element.textContent = 'Cancel'; element.setAttribute('aria-label', 'Cancel') })
  await expect(healing.perform({ descriptor: { strategy: 'role', role: 'button', value: 'Proceed to checkout' }, reference,
    validate: async () => expect.fail('Must not execute the oracle') })).rejects.toThrow()
  await expect(page.locator('output')).toBeEmpty()
})

test('a changed destination is rejected even if the accessible name matches', async ({ page, healing }) => {
  await page.setContent('<main><a id="checkout" href="#checkout">Proceed to checkout</a></main>')
  const reference = await healing.remember(page.locator('a'))
  await page.locator('a').evaluate(element => { element.setAttribute('href', '#wrong'); element.setAttribute('data-testid', 'new') })
  await expect(healing.perform({ descriptor: { strategy: 'testId', value: 'old' }, reference, validate: async () => {} })).rejects.toThrow()
  expect(page.url()).not.toContain('#wrong')
})
