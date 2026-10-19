import { useState } from 'react'
import { StoreContext } from './store.js'
import { createShopState, updateCart, completeOrder } from './shopState.js'

export default function StoreProvider({ children }) {
  const [session, setSession] = useState(null)
  const [shop, setShop] = useState(createShopState)

  // Existing demo entry behavior; no credential verification or persistence.
  function login(email) {
    setSession({ user: { name: 'Demo Student', email: email.trim() } })
    setShop(createShopState())
  }

  function logout() {
    setSession(null)
    setShop(createShopState())
  }

  function addItem(product) {
    setShop(current => updateCart(current, { type: 'add', id: product.id }))
  }

  function setQuantity(id, quantity) {
    setShop(current => updateCart(current, { type: 'quantity', id, quantity }))
  }

  function removeItem(id) {
    setShop(current => updateCart(current, { type: 'remove', id }))
  }

  function clearCart() {
    setShop(current => updateCart(current, { type: 'clear' }))
  }

  function placeOrder(customer, coupon) {
    const number = `ORD-${crypto.randomUUID().toUpperCase()}`
    const nextShop = completeOrder(shop, customer, coupon, number, new Date().toISOString())
    setShop(nextShop)
    return nextShop.orders[0]
  }

  const total = shop.cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  return (
    <StoreContext.Provider value={{
      session, checking: false, cart: shop.cart, products: shop.products,
      orders: shop.orders, order: shop.orders[0] ?? null, total,
      login, logout, addItem, setQuantity, removeItem, clearCart, placeOrder,
    }}>
      {children}
    </StoreContext.Provider>
  )
}
