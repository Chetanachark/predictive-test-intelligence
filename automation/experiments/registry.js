const control = (number, scenario) => ({
  id: `S4-BASE-${number}-v1`, testId: `EXPBASE-${number}`, variant: 'healthy-control.v1',
  scenario, kind: 'none', faultType: '', expected: null,
})

export const EXPERIMENTS = Object.freeze([
  control('001', 'checkout-navigation'), control('002', 'coupon-save10'),
  control('003', 'stock-after-order'), control('004', 'cart-after-order'),
  control('005', 'order-total'), control('006', 'checkout-action'),
  { id: 'S4-LOC-001-v1', testId: 'EXPLOC-001', variant: 'checkout-name-change.v1', scenario: 'checkout-navigation',
    kind: 'dom', operation: 'rename', faultType: 'ACCESSIBLE_NAME_CHANGE', expected: 'LOCATOR_NOT_FOUND' },
  { id: 'S4-LOC-002-v1', testId: 'EXPLOC-002', variant: 'duplicate-checkout-link.v1', scenario: 'checkout-navigation',
    kind: 'dom', operation: 'duplicate', faultType: 'DUPLICATE_MATCH', expected: 'LOCATOR_AMBIGUOUS' },
  { id: 'S4-ASSERT-001-v1', testId: 'EXPASSERT-001', variant: 'save10-five-percent.v1', scenario: 'coupon-save10',
    kind: 'source', faultType: 'COUPON_RATE_DEFECT', expected: 'ASSERTION_MISMATCH',
    pattern: /SAVE10:\s*0?\.1\b/, replacement: 'SAVE10: 0.05' },
  { id: 'S4-STATE-001-v1', testId: 'EXPSTATE-001', variant: 'stock-not-reduced.v1', scenario: 'stock-after-order',
    kind: 'source', faultType: 'STOCK_COMMIT_DEFECT', expected: 'STATE_CONSISTENCY_FAILURE',
    pattern: /stock:\s*product\.stock\s*-\s*\(items\.find\(\(?item\)?\s*=>\s*item\.id\s*===\s*product\.id\)\?\.quantity\s*\?\?\s*0\)/,
    replacement: 'stock: product.stock' },
  { id: 'S4-STATE-002-v1', testId: 'EXPSTATE-002', variant: 'cart-not-cleared.v1', scenario: 'cart-after-order',
    kind: 'source', faultType: 'CART_COMMIT_DEFECT', expected: 'STATE_CONSISTENCY_FAILURE',
    pattern: /cart:\s*\[\],\s*\n\s*orders:\s*\[order,\s*\.\.\.state\.orders\]/,
    replacement: 'cart: state.cart,\n    orders: [order, ...state.orders]' },
  { id: 'S4-STATE-003-v1', testId: 'EXPSTATE-003', variant: 'order-total-extra-charge.v1', scenario: 'order-total',
    kind: 'source', faultType: 'ORDER_TOTAL_COMMIT_DEFECT', expected: 'STATE_CONSISTENCY_FAILURE',
    pattern: /items,\s*\.\.\.totals\s*\}/, replacement: 'items, ...totals, total: totals.total + 1000 }' },
  { id: 'S4-ACTION-001-v1', testId: 'EXPACTION-001', variant: 'delayed-control-render.v1', scenario: 'checkout-action',
    kind: 'dom', operation: 'delay', faultType: 'DELAYED_RENDERING', expected: 'ACTIONABILITY_FAILURE' },
  { id: 'S4-ACTION-002-v1', testId: 'EXPACTION-002', variant: 'hidden-submit-control.v1', scenario: 'checkout-action',
    kind: 'dom', operation: 'hide', faultType: 'HIDDEN_CONTROL', expected: 'ACTIONABILITY_FAILURE' },
  { id: 'S4-ACTION-003-v1', testId: 'EXPACTION-003', variant: 'disabled-submit-control.v1', scenario: 'checkout-action',
    kind: 'dom', operation: 'disable', faultType: 'DISABLED_CONTROL', expected: 'ACTIONABILITY_FAILURE' },
].map(experiment => Object.freeze({ ...experiment, version: '1.0.1' })))

export function experimentById(id) {
  const experiment = EXPERIMENTS.find(item => item.id === id)
  if (!experiment) throw new Error(`Unknown versioned experiment: ${id}`)
  return experiment
}

export function mutateSource(experiment, source) {
  if (experiment.kind !== 'source') throw new Error('Source mutation requested for a non-source variant')
  const matches = [...source.matchAll(new RegExp(experiment.pattern.source, 'g'))]
  if (matches.length !== 1) throw new Error(`${experiment.id}: expected exactly one mutation anchor, found ${matches.length}`)
  return source.replace(experiment.pattern, () => experiment.replacement)
}
