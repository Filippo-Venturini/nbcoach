import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Camera, ChevronRight, ChevronDown, ChevronUp, Users, Dumbbell, Salad, AlertTriangle, CalendarClock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

// ─── Helpers ──────────────────────────────────────────────────

function getWeekStart(dateStr) {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // lunedì
  const monday = new Date(d)
  monday.setDate(diff)
  return monday.toISOString().split('T')[0]
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

// Applica il filtro "attivo oggi" (starts_at <= oggi <= expires_at, con NULL
// trattati come "nessun vincolo") a una query Supabase. Stessa logica usata
// in ClientDetail.jsx per calcolare lo stato di programmi/diete.
function whereActiveToday(query) {
  const today = new Date().toISOString().split('T')[0]
  return query
    .or(`starts_at.is.null,starts_at.lte.${today}`)
    .or(`expires_at.is.null,expires_at.gte.${today}`)
}

// ─── Hooks ────────────────────────────────────────────────────

function useKPIs() {
  return useQuery({
    queryKey: ['home-kpis'],
    queryFn: async () => {
      const [{ count: total }, { data: programs }, { data: diets }] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'client'),
        whereActiveToday(supabase.from('workout_programs').select('client_id')),
        whereActiveToday(supabase.from('diet_plans').select('client_id')),
      ])
      return {
        total: total ?? 0,
        withProgram: new Set(programs?.map(p => p.client_id)).size,
        withDiet: new Set(diets?.map(d => d.client_id)).size,
      }
    },
  })
}

// Lunedì (00:00) della settimana che contiene `date`
function mondayOf(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  d.setHours(0, 0, 0, 0)
  return d
}

// Tra una lista di righe { client_id, expires_at, ... }, tiene per ciascun
// client_id solo quella con la scadenza più lontana (NULL = "infinita",
// vince sempre). È la stessa identica regola con cui calcoliamo il badge
// in cima al dettaglio cliente: qui la usiamo per decidere quale scadenza
// mostrare/considerare per ogni cliente, così i due punti restano coerenti.
function farthestPerClient(rows) {
  const byClient = new Map()
  for (const row of rows ?? []) {
    const prev = byClient.get(row.client_id)
    if (!prev) { byClient.set(row.client_id, row); continue }
    if (!row.expires_at) { byClient.set(row.client_id, row); continue }
    if (!prev.expires_at) continue
    if (row.expires_at > prev.expires_at) byClient.set(row.client_id, row)
  }
  return byClient
}

function useExpiringItems() {
  return useQuery({
    queryKey: ['expiring-items'],
    queryFn: async () => {
      // Confini settimana corrente e prossima
      const thisMonday = mondayOf(new Date())
      const thisSundayEnd = new Date(thisMonday)
      thisSundayEnd.setDate(thisSundayEnd.getDate() + 6)
      thisSundayEnd.setHours(23, 59, 59, 999)

      const nextMonday = new Date(thisMonday)
      nextMonday.setDate(nextMonday.getDate() + 7)
      const nextSundayEnd = new Date(nextMonday)
      nextSundayEnd.setDate(nextSundayEnd.getDate() + 6)
      nextSundayEnd.setHours(23, 59, 59, 999)

      // Prendiamo TUTTI i programmi/diete attivi oggi (non filtriamo già
      // per finestra di scadenza qui: dobbiamo prima trovare, per ciascun
      // cliente, quello con la scadenza più lontana — la stessa regola del
      // badge in cima al dettaglio cliente — e solo dopo controllare se
      // QUELLA scadenza cade questa settimana o la prossima).
      const [{ data: programs }, { data: diets }] = await Promise.all([
        whereActiveToday(
          supabase.from('workout_programs').select('client_id, name, expires_at, profiles(id, full_name)')
        ),
        whereActiveToday(
          supabase.from('diet_plans').select('client_id, name, expires_at, profiles(id, full_name)')
        ),
      ])

      const farthestPrograms = farthestPerClient(programs)
      const farthestDiets = farthestPerClient(diets)

      // Unifica per cliente. Un programma/dieta senza scadenza (NULL) è
      // quello "di riferimento" per quel cliente ma non compare mai qui,
      // perché non sta per scadere — coerente col badge che in quel caso
      // mostra "—".
      const map = new Map()
      function addItem(row, type) {
        if (!row?.expires_at) return
        const id = row.client_id
        if (!map.has(id)) map.set(id, { id, name: row.profiles?.full_name, items: [] })
        map.get(id).items.push({ type, label: row.name ?? type, expires_at: row.expires_at })
      }
      for (const row of farthestPrograms.values()) addItem(row, 'Programma')
      for (const row of farthestDiets.values()) addItem(row, 'Dieta')

      const clients = Array.from(map.values()).sort((a, b) => {
        const minA = Math.min(...a.items.map(i => new Date(i.expires_at)))
        const minB = Math.min(...b.items.map(i => new Date(i.expires_at)))
        return minA - minB
      })

      // Bucket per cliente in base alla scadenza più imminente tra quelle
      // "di riferimento" (Programma e/o Dieta):
      //  - urgent: scaduti o in scadenza entro domenica di questa settimana
      //  - upcoming: in scadenza nella settimana successiva (lun–dom)
      const urgent = []
      const upcoming = []
      for (const client of clients) {
        const minDate = new Date(Math.min(...client.items.map(i => new Date(i.expires_at))))
        if (minDate <= thisSundayEnd) urgent.push(client)
        else if (minDate >= nextMonday && minDate <= nextSundayEnd) upcoming.push(client)
      }

      return { urgent, upcoming }
    },
  })
}

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24))
}

function useRecentPhotos() {
  return useQuery({
    queryKey: ['recent-photos'],
    queryFn: async () => {
      const since = new Date()
      since.setDate(since.getDate() - 7)
      const { data, error } = await supabase
        .from('progress_photos')
        .select('id, photo_url, created_at, client_id, profiles:client_id ( id, full_name )')
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data
    },
  })
}

// ─── KPI Card ─────────────────────────────────────────────────

function KpiCard({ value, label, icon: Icon, isLoading }) {
  return (
    <div className="card flex items-center gap-5">
      <div className="w-12 h-12 bg-navy-900 flex items-center justify-center shrink-0">
        <Icon size={20} className="text-gold-500" />
      </div>
      <div>
        <p className="font-heading font-bold italic text-4xl text-white leading-none">
          {isLoading ? '—' : value}
        </p>
        <p className="text-slate-400 text-xs uppercase tracking-wider font-heading mt-1">{label}</p>
      </div>
    </div>
  )
}

// ─── Sezione scadenze ─────────────────────────────────────────

function ExpiryClientRow({ client }) {
  return (
    <Link
      to={`/clients/${client.id}`}
      state={{ from: 'home' }}
      className="card mb-2 flex items-center justify-between hover:border-navy-600 transition-colors group"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-navy-700 flex items-center justify-center shrink-0">
          <span className="font-heading font-bold text-gold-500 text-lg">
            {client.name?.[0]?.toUpperCase() ?? '?'}
          </span>
        </div>
        <div>
          <p className="font-heading font-bold text-white group-hover:text-gold-400 transition-colors">
            {client.name}
          </p>
          <div className="flex gap-3 mt-0.5">
            {client.items.map((item, i) => {
              const days = daysUntil(item.expires_at)
              const cls = days < 0 ? 'text-red-400' : days <= 3 ? 'text-amber-400' : 'text-slate-400'
              return (
                <span key={i} className={`text-xs ${cls}`}>
                  {item.type}: {days < 0 ? 'scaduto' : days === 0 ? 'oggi' : `${days}g`}
                </span>
              )
            })}
          </div>
        </div>
      </div>
      <ChevronRight size={16} className="text-slate-600 group-hover:text-gold-500 transition-colors" />
    </Link>
  )
}

// Sezione collassabile con header a card, stile catalogo esercizi
function CollapsibleSection({ icon: Icon, iconColor, title, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="card w-full flex items-center justify-between gap-4 py-3 hover:bg-navy-700 transition-colors"
      >
        <span className="flex items-center gap-3">
          <Icon size={18} className={iconColor} />
          <span className="text-lg font-heading font-bold italic uppercase tracking-wide text-white">
            {title}
            {typeof count === 'number' && (
              <span className="text-slate-400 not-italic text-base ml-2">({count})</span>
            )}
          </span>
        </span>
        {open
          ? <ChevronUp size={18} className="text-slate-400 shrink-0" />
          : <ChevronDown size={18} className="text-slate-400 shrink-0" />
        }
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}

function ExpiryList({ clients, emptyText }) {
  if (!clients?.length) {
    return (
      <div className="card text-center py-8">
        <p className="text-slate-500 text-sm">{emptyText}</p>
      </div>
    )
  }
  return clients.map(client => <ExpiryClientRow key={client.id} client={client} />)
}

// ─── Pagina ───────────────────────────────────────────────────

export function Home() {
  const { profile } = useAuth()
  const { data: kpis, isLoading: kpisLoading } = useKPIs()
  const { data: photos, isLoading: photosLoading } = useRecentPhotos()
  const { data: expiring, isLoading: expiringLoading } = useExpiringItems()

  const byClient = photos?.reduce((acc, photo) => {
    const id = photo.client_id
    if (!acc[id]) acc[id] = { profile: photo.profiles, photos: [] }
    acc[id].photos.push(photo)
    return acc
  }, {})

  return (
    <div className="p-8">
      {/* Header */}
      <div className="pb-6 border-b border-navy-700 mb-6">
        <h1 className="font-heading font-bold italic text-3xl text-white uppercase">
          Ciao,{' '}
          <span className="text-gold-500">
            {profile?.full_name?.split(' ')[0] ?? 'PT'}
          </span>
        </h1>
      </div>

      <div className="max-w-4xl mx-auto">
        {/* KPI */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <KpiCard value={kpis?.total} label="Clienti totali" icon={Users} isLoading={kpisLoading} />
          <KpiCard value={kpis?.withProgram} label="Con scheda attiva" icon={Dumbbell} isLoading={kpisLoading} />
          <KpiCard value={kpis?.withDiet} label="Con dieta attiva" icon={Salad} isLoading={kpisLoading} />
        </div>

        {/* Scadenze */}
        {expiringLoading && <p className="text-slate-500 text-sm mb-8">Caricamento scadenze...</p>}

        {!expiringLoading && (
          <>
            <CollapsibleSection
              icon={AlertTriangle}
              iconColor="text-red-400"
              title="Urgenti — questa settimana"
              count={expiring?.urgent?.length ?? 0}
            >
              <ExpiryList clients={expiring?.urgent} emptyText="Nessuna scadenza questa settimana" />
            </CollapsibleSection>

            <CollapsibleSection
              icon={CalendarClock}
              iconColor="text-amber-400"
              title="In arrivo — settimana prossima"
              count={expiring?.upcoming?.length ?? 0}
            >
              <ExpiryList clients={expiring?.upcoming} emptyText="Nessuna scadenza la settimana prossima" />
            </CollapsibleSection>
          </>
        )}

        {/* Foto recenti */}
        <CollapsibleSection
          icon={Camera}
          iconColor="text-gold-500"
          title="Foto progressi — ultimi 7 giorni"
          count={byClient ? Object.keys(byClient).length : 0}
        >
          {photosLoading && <p className="text-slate-500 text-sm">Caricamento...</p>}

          {!photosLoading && (!byClient || Object.keys(byClient).length === 0) && (
            <div className="card text-center py-10">
              <Camera size={32} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500">Nessuna foto caricata negli ultimi 7 giorni</p>
            </div>
          )}

          {byClient && Object.values(byClient).map(({ profile: client, photos }) => (
            <Link
              key={client.id}
              to={`/clients/${client.id}?tab=photos`}
              state={{ from: 'home' }}
              className="card mb-3 flex items-center justify-between hover:border-navy-600 transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-navy-700 flex items-center justify-center shrink-0">
                  <span className="font-heading font-bold text-gold-500 text-lg">
                    {client.full_name?.[0]?.toUpperCase() ?? '?'}
                  </span>
                </div>
                <div>
                  <p className="font-heading font-bold text-white group-hover:text-gold-400 transition-colors">
                    {client.full_name}
                  </p>
                  <p className="text-slate-500 text-xs mt-0.5">
                    {photos.length} foto · ultima il {formatDate(photos[0].created_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="badge-gold">{photos.length} nuove</span>
                <ChevronRight size={16} className="text-slate-600 group-hover:text-gold-500 transition-colors" />
              </div>
            </Link>
          ))}
        </CollapsibleSection>
      </div>
    </div>
  )
}
