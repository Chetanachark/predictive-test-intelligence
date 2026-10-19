import { Link } from 'react-router-dom'
import { money } from '../api/client.js'
import { useStore } from '../context/store.js'

export default function Orders() {
  const { orders } = useStore()

  return (
    <section>
      <h1>Order history</h1>
      {orders.length ? orders.map(order => (
        <article className="panel order-entry" key={order.number} aria-label={`Order ${order.number}`}>
          <h2 className="order-id">Order number: {order.number}</h2>
          <p>Date: <time dateTime={order.date}>{new Date(order.date).toLocaleString('en-IN')}</time></p>
          <ul>{order.items.map(item => (
            <li key={item.id}>{item.name} × {item.quantity} — {money(item.price * item.quantity)}</li>
          ))}</ul>
          <p>Subtotal: {money(order.subtotal)}</p>
          <p>Discount{order.coupon ? ` (${order.coupon})` : ''}: {money(order.discount)}</p>
          <h2>Total: {money(order.total)}</h2>
        </article>
      )) : <p>No orders yet.</p>}
      <Link className="button" to="/products">Continue Shopping</Link>
    </section>
  )
}
