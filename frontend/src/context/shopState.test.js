import test from 'node:test'
import assert from 'node:assert/strict'
import { createShopState, updateCart, couponDetails, orderTotals, completeOrder } from './shopState.js'

const customer = { name: 'Test Student', email: 'student@example.com', address: 'Test Campus' }
const date = '2026-10-19T10:00:00.000Z'
const add = (state, id) => updateCart(state, { type: 'add', id })
const monitorCart = () => add(createShopState(), 4)
const purchase = (state, coupon = '', number = 'ORD-TEST-1') => completeOrder(state, customer, coupon, number, date)

test('each demo starts with independent stock and empty history', () => {
  const first = createShopState()
  first.products[0].stock = 0
  assert.equal(createShopState().products[0].stock, 5)
  assert.deepEqual(createShopState().orders, [])
})

test('adding twice merges the cart line without reducing stock', () => {
  const state = add(monitorCart(), 4)
  assert.equal(state.cart.length, 1)
  assert.equal(state.cart[0].quantity, 2)
  assert.equal(state.products.find(item => item.id === 4).stock, 2)
})

test('out-of-stock products cannot be added', () => {
  const state = createShopState()
  assert.equal(add(state, 3), state)
})

test('repeated additions cannot exceed inventory', () => {
  const state = add(monitorCart(), 4)
  assert.equal(add(state, 4), state)
})

test('quantity updates accept the stock boundary', () => {
  const state = updateCart(monitorCart(), { type: 'quantity', id: 4, quantity: 2 })
  assert.equal(state.cart[0].quantity, 2)
})

for (const quantity of [0, -1, 1.5, 3, NaN]) {
  test(`quantity ${quantity} is rejected without changing the cart`, () => {
    const state = monitorCart()
    assert.equal(updateCart(state, { type: 'quantity', id: 4, quantity }), state)
  })
}

test('remove and clear leave inventory unchanged', () => {
  const state = monitorCart()
  for (const action of [{ type: 'remove', id: 4 }, { type: 'clear' }]) {
    const next = updateCart(state, action)
    assert.deepEqual(next.cart, [])
    assert.deepEqual(next.products, state.products)
  }
})

test('SAVE10 computes a 10 percent discount', () => {
  assert.deepEqual(orderTotals(monitorCart().cart, 'SAVE10'), {
    subtotal: 15000, discount: 1500, total: 13500, coupon: 'SAVE10',
  })
})

test('WELCOME20 computes a 20 percent discount', () => {
  assert.equal(orderTotals(monitorCart().cart, 'WELCOME20').total, 12000)
})

test('empty coupon applies no discount', () => {
  assert.equal(orderTotals(monitorCart().cart, '   ').discount, 0)
})

test('coupon normalization accepts surrounding spaces and lowercase', () => {
  assert.deepEqual(couponDetails(' save10 '), { code: 'SAVE10', rate: 0.1 })
})

test('invalid and inherited-object coupon names are rejected', () => {
  for (const code of ['INVALID', 'constructor', '__proto__']) {
    assert.throws(() => couponDetails(code), /Invalid coupon/)
  }
})

test('checkout commits inventory, immutable snapshot, date and discounted total together', () => {
  const state = monitorCart()
  const next = purchase(state, 'SAVE10')
  assert.equal(next.products.find(item => item.id === 4).stock, 1)
  assert.equal(next.products.find(item => item.id === 1).stock, 5)
  assert.deepEqual(next.cart, [])
  assert.equal(next.orders[0].number, 'ORD-TEST-1')
  assert.equal(next.orders[0].date, date)
  assert.equal(next.orders[0].total, 13500)
  assert.equal(next.orders[0].items[0].quantity, 1)
  assert.equal(state.products.find(item => item.id === 4).stock, 2)
  assert.equal(state.orders.length, 0)
  assert.notEqual(next.orders[0].items[0], state.cart[0])
})

test('second order exhausts inventory and history is newest first', () => {
  const first = purchase(monitorCart(), 'SAVE10')
  const second = purchase(add(first, 4), 'WELCOME20', 'ORD-TEST-2')
  assert.equal(second.products.find(item => item.id === 4).stock, 0)
  assert.deepEqual(second.orders.map(order => order.number), ['ORD-TEST-2', 'ORD-TEST-1'])
  assert.equal(second.orders[1].total, 13500)
  assert.equal(second.orders[0].total, 12000)
  assert.equal(add(second, 4), second)
})

test('empty-cart checkout cannot create a duplicate order', () => {
  const state = purchase(monitorCart())
  assert.throws(() => purchase(state), /cart is empty/)
  assert.equal(state.orders.length, 1)
})

test('invalid customer or coupon cannot decrement stock or append an order', () => {
  const state = monitorCart()
  for (const input of [
    { ...customer, name: '  ' }, { ...customer, email: 'invalid' }, { ...customer, address: '' },
  ]) {
    assert.throws(() => completeOrder(state, input, '', 'ORD-TEST', date))
  }
  assert.throws(() => purchase(state, 'INVALID'), /Invalid coupon/)
  assert.equal(state.products.find(item => item.id === 4).stock, 2)
  assert.equal(state.orders.length, 0)
})

test('checkout revalidates inventory before changing any state', () => {
  const state = monitorCart()
  state.products.find(item => item.id === 4).stock = 0
  assert.throws(() => purchase(state), /no longer in stock/)
  assert.equal(state.cart.length, 1)
  assert.equal(state.orders.length, 0)
})
