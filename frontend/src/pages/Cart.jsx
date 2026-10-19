import { Link } from 'react-router-dom'
import { useStore } from '../context/store.js'
import { money } from '../api/client.js'
import CartItem from '../components/CartItem.jsx'
export default function Cart() {
  const { cart, total, setQuantity, removeItem } = useStore()
  return <section><h1>Your cart</h1>{cart.length ? <>
    <div className="panel">{cart.map(item => <CartItem key={item.id} item={item} onQuantity={setQuantity} onRemove={removeItem} />)}</div>
    <div className="summary"><h2>Total: {money(total)}</h2><Link className="button" to="/checkout">Proceed to checkout</Link></div>
  </> : <div className="panel"><p>Your cart is empty.</p><Link to="/products">Browse products</Link></div>}</section>
}
