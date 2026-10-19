import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useStore } from '../context/store.js'

export default function Login() {
  const { session, login, checking } = useStore()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (checking) return <p role="status">Checking session…</p>
  if (session) return <Navigate to="/products" replace />
  async function submit(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setError(''); setBusy(true)
    try { await login(data.get('email'), data.get('password')); navigate('/products') }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  return <section className="panel narrow"><p className="eyebrow">Predictive Test Intelligence · Sprint 1</p>
    <h1>Welcome to TestLab Store</h1><p>A controlled shopping application for your automation research.</p>
    <form onSubmit={submit}>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" maxLength="256" required /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
    </form>
    <aside className="hint">Demo account: <strong>student@example.com</strong><br />Password: <strong>Student@123</strong></aside>
  </section>
}
