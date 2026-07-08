import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Brand } from '../components/Brand'

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email, password)
      navigate('/')
    } catch (err) {
      console.error('[Login error]', err.message)
      setError(err.message?.includes('Personal Trainer') ? err.message : 'Credenziali non valide. Riprova.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <Brand size="lg" align="center" className="mx-auto block" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="card space-y-4">
          <p className="text-slate-400 text-sm uppercase tracking-widest font-heading text-center pb-1">
            Area riservata PT
          </p>
          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input"
              placeholder="tuaemail@esempio.com"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 px-4 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center text-base mt-2 disabled:opacity-50"
          >
            {loading ? 'ACCESSO IN CORSO...' : 'ACCEDI'}
          </button>
        </form>
      </div>
    </div>
  )
}
