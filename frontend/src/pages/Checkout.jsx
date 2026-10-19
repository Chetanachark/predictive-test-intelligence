import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { money } from '../api/client.js'
import { couponDetails, orderTotals } from '../context/shopState.js'
import { useStore } from '../context/store.js'

export default function Checkout() {
  const { cart, placeOrder } = useStore()
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState('')
  const [couponMessage, setCouponMessage] = useState('')
  const [couponError, setCouponError] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submitted = useRef(false)
  const navigate = useNavigate()
  const totals = orderTotals(cart, coupon)

  function applyCoupon() {
    setCouponError('')
    setCouponMessage('')
    try {
      const result = couponDetails(couponInput)
      setCoupon(result.code)
      setCouponMessage(result.code ? `${result.code} applied: ${result.rate * 100}% discount.` : 'No coupon applied.')
    } catch (error) {
      setCoupon('')
      setCouponError(error.message)
    }
  }

  function submit(event) {
    event.preventDefault()
    if (submitted.current || !cart.length) return
    const data = new FormData(event.currentTarget)
    const customer = Object.fromEntries(['name', 'email', 'address'].map(key => [key, data.get(key).trim()]))
    // Coupon input must be explicitly applied before placing an order.
    if (couponInput.trim().toUpperCase() !== coupon) {
      setCouponError('Apply or clear the coupon before placing your order.')
      return
    }
    setError('')
    submitted.current = true
    setSubmitting(true)
    try {
      placeOrder(customer, coupon)
      navigate('/success', { replace: true })
    } catch (error) {
      submitted.current = false
      setSubmitting(false)
      setError(error.message)
    }
  }

  return (
    <section className="panel narrow">
      <h1>Checkout</h1>
      {cart.length ? (
        <>
          <p>Subtotal: <strong>{money(totals.subtotal)}</strong></p>
          <p>Discount: <strong>{money(totals.discount)}</strong></p>
          <p>Total: <strong>{money(totals.total)}</strong></p>
          <p>Demo orders only. No payment is collected.</p>
          <form onSubmit={submit}>
            <label>Full Name<input name="name" autoComplete="name" maxLength="200" required /></label>
            <label>Email<input name="email" type="email" autoComplete="email" maxLength="254" required /></label>
            <label>Address<input name="address" autoComplete="street-address" maxLength="500" required /></label>
            <label>
              Coupon code
              <input name="coupon" value={couponInput} maxLength="30" aria-describedby="coupon-help"
                onChange={event => {
                  setCouponInput(event.target.value)
                  setCoupon('')
                  setCouponMessage('')
                  setCouponError('')
                }} />
            </label>
            <p id="coupon-help">Optional: SAVE10 for 10% off or WELCOME20 for 20% off.</p>
            <button type="button" className="secondary" onClick={applyCoupon}>Apply coupon</button>
            {couponMessage && <p role="status">{couponMessage}</p>}
            {couponError && <p role="alert" className="error">{couponError}</p>}
            {error && <p role="alert" className="error">{error}</p>}
            <button type="submit" disabled={submitting}>{submitting ? 'Placing order…' : 'Place order'}</button>
          </form>
        </>
      ) : <><p>Your cart is empty.</p><Link to="/products">Browse products</Link></>}
    </section>
  )
}
