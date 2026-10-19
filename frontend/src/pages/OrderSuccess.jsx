import { Link } from 'react-router-dom'
import { money } from '../api/client.js'
import { useStore } from '../context/store.js'

export default function OrderSuccess() {
  const { order } = useStore()

  return (
    <section className="panel narrow">
      {order ? (
        <>
          <p className="eyebrow">Order confirmed</p>
          <h1>Thank you, {order.customer.name}!</h1>
          <p role="status">Your demo order was placed successfully.</p>
          <p className="order-id">Order number: {order.number}</p>
          <p>Date: <time dateTime={order.date}>{new Date(order.date).toLocaleString('en-IN')}</time></p>
          <ul>{order.items.map(item => (
            <li key={item.id}>{item.name} × {item.quantity} — {money(item.price * item.quantity)}</li>
          ))}</ul>
          <p>Subtotal: {money(order.subtotal)}</p>
          <p>Discount{order.coupon ? ` (${order.coupon})` : ''}: {money(order.discount)}</p>
          <h2>Total: {money(order.total)}</h2>
        </>
      ) : <><h1>Order status</h1><p>No order is available. Place an order to see its confirmation.</p></>}
      <Link className="button" to="/products">Continue Shopping</Link>{' '}
      <Link to="/orders">View order history</Link>
    </section>
  )
}
