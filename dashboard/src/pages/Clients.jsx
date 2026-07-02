import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, ChevronRight, Search, Copy, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'

function useClients() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id, full_name, email, phone, created_at,
          workout_programs ( id, is_active, expires_at ),
          diet_plans ( id, is_active, expires_at )
        `)
        .eq('role', 'client')
        .order('full_name')
      if (error) throw error
      return data
    },
  })
}

const PAGE_SIZE = 25

function ClientStatusCol({ label, expiresAt }) {
  const days = expiresAt
    ? Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24))
    : null
  const dateColor = days === null ? 'text-slate-600'
    : days < 0 ? 'text-red-400'
    : days <= 7 ? 'text-amber-400'
    : 'text-slate-400'
  const dateText = days === null ? '—'
    : days < 0 ? 'Scaduto'
    : days === 0 ? 'Scade oggi'
    : new Date(expiresAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="text-center w-28">
      <p className="text-xs text-slate-500 font-heading uppercase tracking-wider">{label}</p>
      <p className={`text-xs font-medium mt-0.5 ${dateColor}`}>{dateText}</p>
    </div>
  )
}

// Crea cliente tramite Edge Function — usa inviteUserByEmail con service role
// Il cliente riceve una email con il link per impostare la propria password
function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ email, fullName }) => {
      const { data, error } = await supabase.functions.invoke('invite-client', {
        body: { email, full_name: fullName, redirect_to: `${window.location.origin}/set-password` },
      })
      if (error) {
        // Su risposta non-2xx supabase-js dà un messaggio generico: leggiamo
        // il messaggio reale dal corpo della risposta della Edge Function.
        let message = error.message
        try {
          const body = await error.context?.json?.()
          if (body?.error) message = body.error
        } catch { /* corpo non leggibile, uso il messaggio generico */ }
        throw new Error(message)
      }
      if (data?.error) throw new Error(data.error)
      return data   // { link, user }
    },
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ['clients'] }), 500)
    },
  })
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function NewClientModal({ onClose }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const [link, setLink] = useState(null)
  const [copied, setCopied] = useState(false)
  const create = useCreateClient()

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    try {
      const res = await create.mutateAsync({ email, fullName })
      setLink(res?.link ?? null)
      setSent(true)
    } catch (err) {
      setError(err.message || "Errore durante la creazione dell'invito")
    }
  }

  function copyLink() {
    if (!link) return
    navigator.clipboard?.writeText(link)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(() => {})
  }

  if (sent) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
        <div className="card w-full max-w-md">
          <div className="text-center mb-4">
            <div className="text-4xl mb-3">🔗</div>
            <h2 className="font-heading font-bold italic text-2xl uppercase text-white mb-2">
              Link di invito pronto
            </h2>
            <p className="text-slate-400 text-sm">
              Invia questo link a <span className="text-white">{fullName || email}</span> su un canale sicuro (es. WhatsApp). Aprendolo potrà impostare la propria password e accedere all'app. Il link scade ed è monouso.
            </p>
          </div>
          {link ? (
            <div className="flex gap-2 mb-5">
              <input
                readOnly
                value={link}
                onFocus={e => e.target.select()}
                className="input text-xs flex-1"
              />
              <button onClick={copyLink} className="btn-primary px-3 shrink-0" title="Copia link">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          ) : (
            <p className="text-amber-400 text-sm mb-5">Link non disponibile. Riprova a creare l'invito.</p>
          )}
          <button onClick={onClose} className="btn-ghost w-full justify-center">
            CHIUDI
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
      <div className="card w-full max-w-md">
        <h2 className="font-heading font-bold italic text-2xl uppercase text-white mb-6">
          Invita cliente
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Nome completo
            </label>
            <input
              className="input"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Mario Rossi"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Email
            </label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="cliente@esempio.com"
              required
            />
          </div>
          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 px-4 py-2.5">{error}</p>
          )}
          <p className="text-slate-500 text-xs">
            Verrà generato un link di invito da inviare tu al cliente. Nessuna email automatica.
          </p>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 justify-center">
              Annulla
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="btn-primary flex-1 justify-center disabled:opacity-50"
            >
              {create.isPending ? 'GENERO...' : 'GENERA LINK'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function Clients() {
  const { data: clients, isLoading } = useClients()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [showModal, setShowModal] = useState(false)

  const filtered = clients?.filter(c =>
    c.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  )

  const totalPages = Math.ceil((filtered?.length ?? 0) / PAGE_SIZE)
  const paginated = filtered?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function handleSearch(val) {
    setSearch(val)
    setPage(0)
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-navy-700 mb-6">
        <div>
          <h1 className="font-heading font-bold italic text-4xl text-white uppercase">
            Clienti
          </h1>
          <p className="text-slate-400 mt-1">
            {clients?.length ?? 0} clienti registrati
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          <UserPlus size={16} />
          Nuovo cliente
        </button>
      </div>

      <div className="max-w-4xl mx-auto">
      {/* Ricerca */}
      <div className="relative mb-5 max-w-xs">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          className="input pl-9"
          placeholder="Cerca per nome o email..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
        />
      </div>
      {isLoading && <p className="text-slate-500 text-sm">Caricamento...</p>}

      {!isLoading && filtered?.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-slate-500">Nessun cliente trovato</p>
        </div>
      )}

      {paginated?.map(client => {
        const activeProgram = client.workout_programs?.find(p => p.is_active)
        const activeDiet = client.diet_plans?.find(d => d.is_active)
        return (
          <Link
            key={client.id}
            to={`/clients/${client.id}`}
            className="card mb-2 flex items-center justify-between hover:border-navy-600 transition-colors group"
          >
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 bg-navy-700 flex items-center justify-center shrink-0">
                <span className="font-heading font-bold text-gold-500 text-xl">
                  {client.full_name?.[0]?.toUpperCase() ?? '?'}
                </span>
              </div>
              <div>
                <p className="font-heading font-bold text-lg text-white group-hover:text-gold-400 transition-colors leading-tight">
                  {client.full_name ?? '—'}
                </p>
                <p className="text-slate-500 text-xs mt-0.5">{client.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex gap-4">
                {activeProgram && <ClientStatusCol label="Programma" expiresAt={activeProgram.expires_at} />}
                {activeDiet && <ClientStatusCol label="Dieta" expiresAt={activeDiet.expires_at} />}
              </div>
              <ChevronRight size={16} className="text-slate-600 group-hover:text-gold-500 transition-colors shrink-0" />
            </div>
          </Link>
        )
      })}

      {/* Paginazione */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-navy-700">
          <span className="text-slate-500 text-sm">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered?.length ?? 0)} di {filtered?.length}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="btn-ghost text-sm px-3 py-1.5 disabled:opacity-30"
            >
              ← Precedente
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="btn-ghost text-sm px-3 py-1.5 disabled:opacity-30"
            >
              Successiva →
            </button>
          </div>
        </div>
      )}

      </div> {/* max-w-4xl */}
      {showModal && <NewClientModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
