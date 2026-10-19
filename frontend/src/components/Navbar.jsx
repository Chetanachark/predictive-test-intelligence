import { NavLink, useNavigate } from 'react-router-dom'
import { useStore } from '../context/store.js'

export default function Navbar() {
  const { session, cart, logout } = useStore()
  const navigate = useNavigate()
  async function signOut() {
    try { await logout() } catch { /* Local session is cleared even when the API is unavailable. */ }
    navigate('/', { replace: true })
  }
  return <header className="navbar">
    <NavLink className="brand" to="/products">TestLab Store</NavLink>
    <nav aria-label="Main navigation">
      <NavLink to="/products">Products</NavLink>
      <NavLink to="/cart">Cart ({cart.reduce((sum, item) => sum + item.quantity, 0)})</NavLink>
      <NavLink to="/orders">Orders</NavLink>
      {session ? <><span>{session.user.name}</span><button onClick={signOut}>Log out</button></> : <NavLink to="/">Log in</NavLink>}
    </nav>
  </header>
}
