import initialProducts from '../data/products.js'

export function createShopState() {
  return { products: initialProducts.map(product => ({ ...product })), cart: [], orders: [] }
}

export function couponDetails(value) {
  const code = value.trim().toUpperCase()
  if (!code) return { code: '', rate: 0 }
  const rates = { SAVE10: 0.1, WELCOME20: 0.2 }
  if (!Object.hasOwn(rates, code)) throw new Error('Invalid coupon code.')
  return { code, rate: rates[code] }
}

export function orderTotals(cart, coupon = '') {
  const { code, rate } = couponDetails(coupon)
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const discount = Math.round(subtotal * rate * 100) / 100
  return { subtotal, discount, total: Math.round((subtotal - discount) * 100) / 100, coupon: code }
}

export function updateCart(state, action) {
  if (action.type === 'clear') return { ...state, cart: [] }
  if (action.type === 'remove') {
    return { ...state, cart: state.cart.filter(item => item.id !== action.id) }
  }
  const product = state.products.find(item => item.id === action.id)
  if (!product) return state
  const existing = state.cart.find(item => item.id === action.id)
  const quantity = action.type === 'add' ? (existing?.quantity ?? 0) + 1 : action.quantity
  if (!['add', 'quantity'].includes(action.type) || !Number.isInteger(quantity) ||
      quantity < 1 || quantity > Math.min(product.stock, 99)) return state
  const cart = existing
    ? state.cart.map(item => item.id === product.id ? { ...item, quantity } : item)
    : [...state.cart, { ...product, quantity }]
  return { ...state, cart }
}

// Commit stock, cart, and order history together in one React state update.
export function completeOrder(state, customer, coupon, number, date) {
  const details = Object.fromEntries(['name', 'email', 'address'].map(key => [key, String(customer[key] ?? '').trim()]))
  if (Object.values(details).some(value => !value)) throw new Error('Full name, email, and address are required.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) throw new Error('Enter a valid email address.')
  if (!state.cart.length) throw new Error('Your cart is empty.')
  const totals = orderTotals(state.cart, coupon)
  const items = state.cart.map(item => {
    const product = state.products.find(product => product.id === item.id)
    if (!product || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > Math.min(product.stock, 99)) {
      throw new Error('The requested quantity is no longer in stock.')
    }
    return { id: product.id, name: product.name, price: product.price, quantity: item.quantity }
  })
  const order = { number, date, customer: details, items, ...totals }
  return {
    products: state.products.map(product => ({ ...product,
      stock: product.stock - (items.find(item => item.id === product.id)?.quantity ?? 0) })),
    cart: [],
    orders: [order, ...state.orders],
  }
}
