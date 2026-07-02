import { useState, useEffect } from 'react'
import { Eye, EyeOff, CheckCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

export function SetPassword() {
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [showPwd, setShowPwd]       = useState(false)
  const [showConf, setShowConf]     = useState(false)
  const [error, setError]           = useState(null)
  const [loading, setLoading]       = useState(false)
  const [done, setDone]             = useState(false)
  const [type, setType]             = useState(null)   // 'invite' | 'recovery'
  const [tokenError, setTokenError] = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        const params = new URLSearchParams(window.location.hash.replace('#', ''))
        setType(params.get('type') ?? 'recovery')
      }
    })

    // Timeout: se dopo 6s il token non è arrivato, il link è scaduto/invalido
    const timeout = setTimeout(() => {
      setType(t => {
        if (!t) setTokenError(true)
        return t
      })
    }, 6000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  const strength = (() => {
    if (password.length === 0) return null
    if (password.length < 8)   return { label: 'Troppo corta', color: 'bg-red-500',    w: 'w-1/4' }
    if (password.length < 12)  return { label: 'Discreta',     color: 'bg-amber-400',  w: 'w-2/4' }
    return                            { label: 'Forte',         color: 'bg-emerald-500', w: 'w-full' }
  })()

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('La password deve essere di almeno 8 caratteri'); return }
    if (password !== confirm) { setError('Le password non corrispondono'); return }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) { setError(error.message); return }
    setDone(true)
    // Nessun redirect: l'utente accede dall'app. Chiudiamo solo la sessione web.
    await supabase.auth.signOut()
  }

  // ── Link scaduto o invalido ───────────────────────────────────
  if (tokenError) {
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="font-heading font-bold italic text-5xl text-gold-500 uppercase tracking-wider mb-10">
            FitCoach
          </h1>
          <div className="card space-y-4">
            <p className="text-2xl">⚠️</p>
            <p className="text-white font-heading font-bold uppercase text-lg">Link non valido</p>
            <p className="text-slate-400 text-sm">
              Il link è scaduto o è già stato usato. Chiedi al tuo PT di inviare un nuovo invito.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Verifica token in corso ───────────────────────────────────
  if (!type) {
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="font-heading font-bold italic text-5xl text-gold-500 uppercase tracking-wider mb-10">
            FitCoach
          </h1>
          <div className="card">
            <div className="flex items-center justify-center gap-3 py-2">
              <div className="w-4 h-4 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-400 text-sm">Verifica del link in corso...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Successo ──────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="font-heading font-bold italic text-5xl text-gold-500 uppercase tracking-wider mb-10">
            FitCoach
          </h1>
          <div className="card space-y-4">
            <CheckCircle className="text-emerald-400 mx-auto" size={40} />
            <p className="text-white font-heading font-bold uppercase text-lg">Password impostata</p>
            <p className="text-slate-400 text-sm">
              Ora puoi accedere all'app FitCoach con la tua email e la password appena scelta.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Form principale ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="font-heading font-bold italic text-5xl text-gold-500 uppercase tracking-wider">
            FitCoach
          </h1>
          <p className="text-slate-400 text-sm mt-2 uppercase tracking-widest font-heading">
            {type === 'invite' ? 'Attiva il tuo account' : 'Recupero password'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-5">
          <p className="text-slate-400 text-sm">
            {type === 'invite'
              ? 'Benvenuto! Scegli una password per accedere all\'app.'
              : 'Inserisci la nuova password per il tuo account.'}
          </p>

          {/* Password */}
          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input pr-10"
                placeholder="min. 8 caratteri"
                required
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {/* Strength bar */}
            {strength && (
              <div className="mt-2">
                <div className="h-1 w-full bg-navy-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-300 ${strength.color} ${strength.w}`} />
                </div>
                <p className={`text-xs mt-1 ${
                  strength.label === 'Forte' ? 'text-emerald-400' :
                  strength.label === 'Discreta' ? 'text-amber-400' : 'text-red-400'
                }`}>{strength.label}</p>
              </div>
            )}
          </div>

          {/* Conferma */}
          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Conferma password
            </label>
            <div className="relative">
              <input
                type={showConf ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="input pr-10"
                placeholder="Ripeti la password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConf(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showConf ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {confirm && password !== confirm && (
              <p className="text-red-400 text-xs mt-1">Le password non corrispondono</p>
            )}
            {confirm && password === confirm && confirm.length > 0 && (
              <p className="text-emerald-400 text-xs mt-1">✓ Le password corrispondono</p>
            )}
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 px-4 py-2.5">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || password !== confirm || password.length < 8}
            className="btn-primary w-full justify-center text-base disabled:opacity-40"
          >
            {loading ? 'SALVATAGGIO...' : type === 'invite' ? 'ATTIVA ACCOUNT' : 'AGGIORNA PASSWORD'}
          </button>
        </form>
      </div>
    </div>
  )
}
