import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import StoreProvider from './context/StoreProvider.jsx'
import { useStore } from './context/store.js'
import Navbar from './components/Navbar.jsx'
import Login from './pages/Login.jsx'
import Products from './pages/Products.jsx'
import Cart from './pages/Cart.jsx'
import Checkout from './pages/Checkout.jsx'
import OrderSuccess from './pages/OrderSuccess.jsx'
import Orders from './pages/Orders.jsx'

function Protected({ children }) {
  const { session, checking } = useStore()
  if (checking) return <p role="status">Checking session…</p>
  return session ? children : <Navigate to="/" replace />
}
export default function App() {
  return <BrowserRouter><StoreProvider><Navbar /><main className="container"><Routes>
    <Route path="/" element={<Login />} />
    <Route path="/products" element={<Protected><Products /></Protected>} />
    <Route path="/cart" element={<Protected><Cart /></Protected>} />
    <Route path="/checkout" element={<Protected><Checkout /></Protected>} />
    <Route path="/orders" element={<Protected><Orders /></Protected>} />
    <Route path="/success" element={<Protected><OrderSuccess /></Protected>} />
    <Route path="*" element={<section><h1>Page not found</h1><Link to="/products">Go to products</Link></section>} />
  </Routes></main><footer>TestLab Store · Research test application</footer></StoreProvider></BrowserRouter>
}
