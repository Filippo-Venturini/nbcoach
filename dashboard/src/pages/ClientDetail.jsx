import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useLocation, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Upload, Plus, ExternalLink, ChevronDown, ChevronUp, Pencil, Check, X, ArrowUp, ArrowDown, Send, Clock, Dumbbell, Salad, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

// ─── Data hooks ───────────────────────────────────────────────

function useClient(id) {
  return useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
  })
}

function useQuestionnaireFormUrl() {
  return useQuery({
    queryKey: ['app-settings', 'questionnaire_form_url'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'questionnaire_form_url')
        .single()
      if (error) throw error
      return data?.value ?? null
    },
  })
}

function useSetQuestionnaire() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, pending }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ questionnaire_pending: pending })
        .eq('id', clientId)
      if (error) throw error
    },
    onSuccess: (_, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['client', clientId] })
    },
  })
}

function useWorkoutPrograms(clientId) {
  return useQuery({
    queryKey: ['workout-programs', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workout_programs')
        .select(`
          *,
          workout_plans (
            *,
            workout_exercises (
              *,
              exercises_catalog ( name, youtube_id, muscle_group )
            )
          )
        `)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) throw error
      // Ordina gli esercizi di ogni scheda per order_index
      return data?.map(prog => ({
        ...prog,
        workout_plans: prog.workout_plans?.map(plan => ({
          ...plan,
          workout_exercises: [...(plan.workout_exercises ?? [])].sort((a, b) => a.order_index - b.order_index),
        })),
      }))
    },
  })
}

function useUpdateExercises() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, exercises }) => {
      await Promise.all(exercises.map((ex, i) =>
        supabase.from('workout_exercises').update({
          sets: ex.sets ? parseInt(ex.sets) : null,
          reps: ex.reps || null,
          carico: ex.carico || null,
          rest_seconds: ex.rest_seconds ? parseInt(ex.rest_seconds) : null,
          cadenza: ex.cadenza || null,
          notes: ex.notes || null,
          order_index: i,
        }).eq('id', ex.id)
      ))
    },
    onSuccess: (_, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['workout-programs', clientId] })
    },
  })
}

function useUpdateProgramNotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, programId, notes }) => {
      const { error } = await supabase
        .from('workout_programs')
        .update({ notes: notes || null })
        .eq('id', programId)
      if (error) throw error
    },
    onSuccess: (_, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['workout-programs', clientId] })
    },
  })
}

function useActiveProgram(clientId) {
  return useQuery({
    queryKey: ['active-program', clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from('workout_programs')
        .select('id, name, expires_at')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data
    },
  })
}

function useActiveDietInfo(clientId) {
  return useQuery({
    queryKey: ['active-diet-info', clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from('diet_plans')
        .select('id, name, expires_at')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data
    },
  })
}

function useUpdateProgramExpiry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, programId, expiresAt }) => {
      const { error } = await supabase
        .from('workout_programs')
        .update({ expires_at: expiresAt || null })
        .eq('id', programId)
      if (error) throw error
    },
    onSuccess: (_, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['workout-programs', clientId] })
      qc.invalidateQueries({ queryKey: ['active-program', clientId] })
      qc.invalidateQueries({ queryKey: ['expiring-items'] })
    },
  })
}

function useUpdateDietExpiry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, dietId, expiresAt }) => {
      const { error } = await supabase
        .from('diet_plans')
        .update({ expires_at: expiresAt || null })
        .eq('id', dietId)
      if (error) throw error
    },
    onSuccess: (_, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['diet-plans', clientId] })
      qc.invalidateQueries({ queryKey: ['active-diet-info', clientId] })
      qc.invalidateQueries({ queryKey: ['expiring-items'] })
    },
  })
}

function useDietPlans(clientId) {
  return useQuery({
    queryKey: ['diet-plans', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('diet_plans').select('*').eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) throw error
      // Bucket privato: genera signed URL per ogni PDF
      const paths = (data ?? []).map(d => d.pdf_url).filter(Boolean)
      let urlMap = {}
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('diet-pdfs').createSignedUrls(paths, 3600)
        urlMap = Object.fromEntries((signed ?? []).map(s => [s.path, s.signedUrl]))
      }
      return (data ?? []).map(d => ({ ...d, signedUrl: urlMap[d.pdf_url] ?? null }))
    },
  })
}

function getMonday(dateStr) {
  const d = new Date(dateStr)
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  monday.setHours(0, 0, 0, 0)
  return monday
}

function getWeekKey(dateStr) {
  return getMonday(dateStr).toISOString().split('T')[0]
}

function usePhotoWeeks(clientId, sinceDate) {
  const sinceKey = sinceDate ? sinceDate.toISOString() : 'all'
  return useQuery({
    queryKey: ['photo-weeks', clientId, sinceKey],
    queryFn: async () => {
      let query = supabase
        .from('progress_photos')
        .select('id, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (sinceDate) query = query.gte('created_at', sinceDate.toISOString())
      const { data, error } = await query
      if (error) throw error
      const weekMap = new Map()
      for (const photo of data ?? []) {
        const key = getWeekKey(photo.created_at)
        if (!weekMap.has(key)) weekMap.set(key, { key, weekStart: getMonday(photo.created_at), count: 0 })
        weekMap.get(key).count++
      }
      return Array.from(weekMap.values())
    },
  })
}

function useWeekPhotos(clientId, weekKey, weekStart, enabled) {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  return useQuery({
    queryKey: ['week-photos', clientId, weekKey],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('progress_photos')
        .select('id, photo_url, created_at, notes')
        .eq('client_id', clientId)
        .gte('created_at', weekStart.toISOString())
        .lt('created_at', weekEnd.toISOString())
        .order('created_at', { ascending: true })
      if (error) throw error
      if (!data?.length) return []
      const { data: signed } = await supabase.storage
        .from('progress-photos')
        .createSignedUrls(data.map(p => p.photo_url), 3600)
      const urlMap = Object.fromEntries((signed ?? []).map(s => [s.path, s.signedUrl]))
      return data.map(p => ({ ...p, signedUrl: urlMap[p.photo_url] ?? null }))
    },
  })
}

// ─── Helpers ──────────────────────────────────────────────────

function fmt(dateStr, opts) {
  return new Date(dateStr).toLocaleDateString('it-IT', opts ?? { day: '2-digit', month: 'short', year: 'numeric' })
}

function expiryInfo(expiresAt) {
  if (!expiresAt) return null
  const diff = Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24))
  if (diff < 0)   return { label: 'Scaduto',            cls: 'text-red-400' }
  if (diff === 0) return { label: 'Scade oggi',          cls: 'text-amber-400' }
  if (diff <= 7)  return { label: `Scade tra ${diff}g`,  cls: 'text-amber-400' }
  return { label: `Scade il ${fmt(expiresAt)}`,          cls: 'text-slate-500' }
}

// Campo in sola lettura reso IDENTICO all'input della modifica (stesse
// classi .input => stessi colori, bordi, dimensioni testo). Mostra il
// placeholder quando vuoto, esattamente come farebbe l'input.
function ReadBox({ value, placeholder = '—' }) {
  const empty = value === null || value === undefined || value === ''
  return (
    <div className="input text-xs py-1 whitespace-pre-wrap break-words">
      {empty ? <span className="text-slate-500">{placeholder}</span> : value}
    </div>
  )
}

function ExerciseViewRow({ ex, onVideoToggle, videoId }) {
  const isVideoOpen = videoId === ex.exercises_catalog?.youtube_id
  return (
    <div>
      <div className="bg-navy-900 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="font-medium text-white text-sm">{ex.exercises_catalog?.name}</p>
          {ex.exercises_catalog?.youtube_id && (
            <button onClick={() => onVideoToggle(ex.exercises_catalog.youtube_id)} className="btn-ghost text-xs px-2 py-1">
              {isVideoOpen ? 'Chiudi' : '▶ Video'}
            </button>
          )}
        </div>
        <div className="grid grid-cols-12 gap-1.5 mb-1.5">
          <div className="col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Serie</label>
            <ReadBox value={ex.sets} />
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-slate-500 mb-1">Reps</label>
            <ReadBox value={ex.reps} />
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-slate-500 mb-1">Reps effettive</label>
            <ReadBox value={ex.reps_effettive} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Carico</label>
            <ReadBox value={ex.carico} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Riposo (s)</label>
            <ReadBox value={ex.rest_seconds} />
          </div>
        </div>
        <ReadBox value={ex.cadenza} placeholder="Cadenza (opzionale)" />
        <div className="mt-1.5">
          <ReadBox value={ex.notes} placeholder="Note (opzionale)" />
        </div>
      </div>
      {isVideoOpen && (
        <div className="aspect-video bg-black">
          <iframe src={`https://www.youtube.com/embed/${ex.exercises_catalog.youtube_id}`} className="w-full h-full" allowFullScreen title={ex.exercises_catalog.name} />
        </div>
      )}
    </div>
  )
}

function ExerciseEditRow({ ex, data, onChange, onMoveUp, onMoveDown, isFirst, isLast }) {
  return (
    <div className="bg-navy-900 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-white text-sm">{ex.exercises_catalog?.name}</p>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={isFirst} className="p-1 text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors">
            <ArrowUp size={13} />
          </button>
          <button onClick={onMoveDown} disabled={isLast} className="p-1 text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors">
            <ArrowDown size={13} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-1.5 mb-1.5">
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Serie</label>
          <input className="input text-xs py-1" value={data.sets ?? ''} onChange={e => onChange('sets', e.target.value)} placeholder="4" />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-slate-500 mb-1">Reps</label>
          <input className="input text-xs py-1" value={data.reps ?? ''} onChange={e => onChange('reps', e.target.value)} placeholder="8-10" />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-slate-500 mb-1">Reps effettive</label>
          <ReadBox value={ex.reps_effettive} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Carico</label>
          <input className="input text-xs py-1" value={data.carico ?? ''} onChange={e => onChange('carico', e.target.value)} placeholder="80kg" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Riposo (s)</label>
          <input className="input text-xs py-1" value={data.rest_seconds ?? ''} onChange={e => onChange('rest_seconds', e.target.value)} placeholder="90" />
        </div>
      </div>
      <input className="input text-xs py-1 mb-1.5" value={data.cadenza ?? ''} onChange={e => onChange('cadenza', e.target.value)} placeholder="Cadenza (opzionale)" />
      <input className="input text-xs py-1" value={data.notes ?? ''} onChange={e => onChange('notes', e.target.value)} placeholder="Note (opzionale)" />
    </div>
  )
}

// ─── Volume counter ───────────────────────────────────────────

function countsFromExercises(exercises) {
  const counts = {}
  for (const ex of (exercises ?? [])) {
    const mg = ex.exercises_catalog?.muscle_group
    if (mg) counts[mg] = (counts[mg] || 0) + 1
  }
  return counts
}

function VolumeBadges({ counts }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (!entries.length) return null
  const total = entries.reduce((s, [, c]) => s + c, 0)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map(([mg, count]) => (
        <span key={mg} className="flex items-center gap-1 bg-navy-800 border border-navy-700 px-2 py-0.5 text-xs">
          <span className="text-slate-400">{mg}</span>
          <span className="text-gold-500 font-bold">{count}</span>
        </span>
      ))}
      <span className="flex items-center gap-1 bg-gold-500/10 border border-gold-500/40 px-2 py-0.5 text-xs">
        <span className="text-gold-300 uppercase tracking-wider">Totale</span>
        <span className="text-gold-400 font-bold">{total}</span>
      </span>
    </div>
  )
}

function ProgramVolumeCounter({ plans }) {
  const [open, setOpen] = useState(false)
  const counts = countsFromExercises((plans ?? []).flatMap(p => p.workout_exercises ?? []))
  const entries = Object.entries(counts)
  if (!entries.length) return null
  const total = entries.reduce((s, [, c]) => s + c, 0)
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        <span className="uppercase tracking-wider font-heading">Volume muscolare</span>
        <span className="text-gold-400 font-bold">{total}</span>
      </button>
      {open && <div className="mt-2"><VolumeBadges counts={counts} /></div>}
    </div>
  )
}

function PlanVolumeCounter({ plan }) {
  const counts = countsFromExercises(plan.workout_exercises)
  if (!Object.keys(counts).length) return null
  return (
    <div className="px-4 py-2 bg-navy-950 border-b border-navy-700">
      <VolumeBadges counts={counts} />
    </div>
  )
}

// ─── Expiry cards ─────────────────────────────────────────────

function ExpiryCard({ icon: Icon, type, item, onSave, isSaving }) {
  const [editing, setEditing] = useState(false)
  const [dateValue, setDateValue] = useState(item?.expires_at ?? '')

  const days = item?.expires_at ? Math.ceil((new Date(item.expires_at) - new Date()) / (1000 * 60 * 60 * 24)) : null
  const urgent = days !== null && days <= 7
  const dateColor = days === null ? 'text-slate-600' : days < 0 ? 'text-red-400' : days <= 7 ? 'text-amber-400' : 'text-white'

  async function handleSave() {
    await onSave(dateValue)
    setEditing(false)
  }

  async function handleRemove() {
    setDateValue('')
    await onSave('')
    setEditing(false)
  }

  return (
    <div className={`card flex items-center justify-between gap-3 ${urgent ? 'border-amber-500/30' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 flex items-center justify-center shrink-0 ${urgent ? 'bg-amber-900/30' : 'bg-navy-900'}`}>
          <Icon size={15} className={urgent ? 'text-amber-400' : 'text-gold-500'} />
        </div>
          <div>
            <p className="text-xs font-heading uppercase tracking-wider text-slate-500">{type}</p>
            {!editing && (
              <p className={`text-base font-heading font-bold uppercase tracking-wider mt-0.5 ${dateColor}`}>
                <span className="text-slate-500 mr-1.5">Scadenza:</span>
                {item?.expires_at ? fmt(item.expires_at).toUpperCase() : '—'}
              </p>
            )}
            {editing && (
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="date"
                  className="input text-xs py-1 w-36"
                  style={{ colorScheme: 'dark' }}
                  min={new Date().toISOString().split('T')[0]}
                  value={dateValue}
                  onChange={e => setDateValue(e.target.value)}
                  autoFocus
                />
                <button onClick={handleSave} disabled={isSaving} className="btn-primary text-xs px-2 py-1 disabled:opacity-50">
                  <Check size={12} />
                </button>
                <button onClick={() => { setDateValue(item?.expires_at ?? ''); setEditing(false) }} className="btn-ghost text-xs px-2 py-1">
                  <X size={12} />
                </button>
                {item?.expires_at && (
                  <button onClick={handleRemove} disabled={isSaving} className="btn-ghost text-xs px-2 py-1 text-red-400 hover:text-red-300 disabled:opacity-50" title="Rimuovi scadenza">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

      {item && !editing && (
        <button
          onClick={() => { setDateValue(item.expires_at ?? ''); setEditing(true) }}
          className="p-1.5 text-slate-600 hover:text-white transition-colors shrink-0"
        >
          <Pencil size={13} />
        </button>
      )}
    </div>
  )
}

// ─── Tab: Scheda ──────────────────────────────────────────────

function PlanCard({ plan, programIsActive, clientId }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [videoId, setVideoId] = useState(null)
  const [editData, setEditData] = useState({})
  const [editOrder, setEditOrder] = useState([]) // array di exercise.id nell'ordine corrente
  const updateExercises = useUpdateExercises()

  function startEdit() {
    const initial = {}
    plan.workout_exercises?.forEach(ex => {
      initial[ex.id] = { sets: ex.sets ?? '', reps: ex.reps ?? '', carico: ex.carico ?? '', rest_seconds: ex.rest_seconds ?? '', cadenza: ex.cadenza ?? '', notes: ex.notes ?? '' }
    })
    setEditData(initial)
    setEditOrder(plan.workout_exercises?.map(ex => ex.id) ?? [])
    setEditing(true)
    setExpanded(true)
  }

  function moveExercise(id, dir) {
    setEditOrder(prev => {
      const idx = prev.indexOf(id)
      const next = [...prev]
      const swapIdx = idx + dir
      if (swapIdx < 0 || swapIdx >= next.length) return prev
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      return next
    })
  }

  async function saveEdit() {
    const exById = Object.fromEntries(plan.workout_exercises?.map(ex => [ex.id, ex]) ?? [])
    const exercises = editOrder.map((id, i) => ({ id, ...editData[id], order_index: i }))
    await updateExercises.mutateAsync({ clientId, exercises })
    setEditing(false)
  }

  function cancelEdit() {
    setEditing(false)
  }

  function toggleVideo(ytId) {
    setVideoId(prev => prev === ytId ? null : ytId)
  }

  return (
    <div className="border border-navy-700 bg-navy-900">
      {/* Plan header — sfondo e accento distinti dal corpo esercizi */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-navy-800 border-l-2 border-gold-500/60">
        <button
          className="flex items-center gap-3 flex-1 text-left"
          onClick={() => { setExpanded(e => !e); setEditing(false) }}
        >
          <div className="flex items-baseline gap-2.5">
            <span className="font-heading font-bold uppercase tracking-wider text-gold-400 text-sm">{plan.name}</span>
            <span className="text-slate-500 text-xs">{plan.workout_exercises?.length ?? 0} esercizi</span>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {programIsActive && !editing && (
            <button onClick={startEdit} className="btn-ghost text-xs px-2 py-1">
              <Pencil size={12} /> Modifica
            </button>
          )}
          {editing && (
            <>
              <button onClick={cancelEdit} className="btn-ghost text-xs px-2 py-1">
                <X size={12} /> Annulla
              </button>
              <button onClick={saveEdit} disabled={updateExercises.isPending} className="btn-primary text-xs px-3 py-1 disabled:opacity-50">
                <Check size={12} /> {updateExercises.isPending ? 'Salvo...' : 'Salva'}
              </button>
            </>
          )}
          {expanded
            ? <ChevronUp size={16} className="text-slate-500" />
            : <ChevronDown size={16} className="text-slate-500" />
          }
        </div>
      </div>

      {/* Exercises */}
      {expanded && (
        <div className="border-t border-navy-700">
          <PlanVolumeCounter plan={plan} />
          <div className="divide-y divide-navy-700">
          {editing
            ? editOrder.map((id, idx) => {
                const ex = plan.workout_exercises?.find(e => e.id === id)
                if (!ex) return null
                return (
                  <ExerciseEditRow
                    key={id}
                    ex={ex}
                    data={editData[id] ?? {}}
                    onChange={(field, val) => setEditData(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))}
                    onMoveUp={() => moveExercise(id, -1)}
                    onMoveDown={() => moveExercise(id, 1)}
                    isFirst={idx === 0}
                    isLast={idx === editOrder.length - 1}
                  />
                )
              })
            : plan.workout_exercises?.map(ex => (
                <ExerciseViewRow
                  key={ex.id}
                  ex={ex}
                  videoId={videoId}
                  onVideoToggle={toggleVideo}
                />
              ))
          }
          {!plan.workout_exercises?.length && (
            <p className="text-slate-500 text-sm px-4 py-3">Nessun esercizio</p>
          )}
          </div>
        </div>
      )}
    </div>
  )
}

function ProgramCard({ program, clientId }) {
  const [open, setOpen] = useState(program.is_active)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState(program.notes ?? '')
  const updateNotes = useUpdateProgramNotes()

  const expiryStatus = program.is_active ? expiryInfo(program.expires_at) : null

  async function saveNotes() {
    await updateNotes.mutateAsync({ clientId, programId: program.id, notes: notesValue })
    setEditingNotes(false)
  }

  function cancelNotes() {
    setNotesValue(program.notes ?? '')
    setEditingNotes(false)
  }

  return (
    <div className={`card mb-4 ${program.is_active ? 'border-gold-500/30' : ''}`}>
      {/* Header: solo badge + nome */}
      <button className="w-full flex items-center justify-between gap-4" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-3">
          <p className="font-heading font-bold italic uppercase tracking-wide text-white text-lg text-left">
            {program.name ?? 'Programma'}
          </p>
          {program.is_active && <span className="badge-gold">Attivo</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-500 text-xs">
            {fmt(program.created_at)}{program.expires_at ? ` — ${fmt(program.expires_at)}` : ''}
          </span>
          {open ? <ChevronUp size={16} className="text-slate-500 shrink-0" /> : <ChevronDown size={16} className="text-slate-500 shrink-0" />}
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Volume */}
          <ProgramVolumeCounter plans={program.workout_plans} />

          {/* Note: visibili solo se presenti, editing inline */}
          {!editingNotes && notesValue && (
            <div className="flex items-start gap-2">
              <p className="text-sm italic flex-1 whitespace-pre-wrap">
                <span className="text-slate-300">Note programma: </span>
                <span className="text-slate-400">{notesValue}</span>
              </p>
              {program.is_active && (
                <button onClick={() => setEditingNotes(true)} className="p-1 text-slate-600 hover:text-white transition-colors shrink-0 mt-0.5">
                  <Pencil size={12} />
                </button>
              )}
            </div>
          )}
          {!editingNotes && !notesValue && program.is_active && (
            <button onClick={() => setEditingNotes(true)} className="text-slate-600 hover:text-slate-400 text-xs transition-colors text-left">
              + Aggiungi note
            </button>
          )}
          {editingNotes && (
            <div>
              <textarea
                className="input w-full text-sm resize-none"
                rows={3}
                value={notesValue}
                onChange={e => setNotesValue(e.target.value)}
                placeholder="Note generali per il cliente..."
                autoFocus
              />
              <div className="flex gap-2 mt-2">
                <button onClick={cancelNotes} className="btn-ghost text-xs px-2 py-1">
                  <X size={12} /> Annulla
                </button>
                <button onClick={saveNotes} disabled={updateNotes.isPending} className="btn-primary text-xs px-3 py-1 disabled:opacity-50">
                  <Check size={12} /> {updateNotes.isPending ? 'Salvo...' : 'Salva'}
                </button>
              </div>
            </div>
          )}

          {/* Schede */}
          <div className="space-y-2">
            {program.workout_plans?.map(plan => (
              <PlanCard
                key={plan.id}
                plan={plan}
                programIsActive={program.is_active}
                clientId={clientId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TabScheda({ clientId }) {
  const { data: programs, isLoading } = useWorkoutPrograms(clientId)

  if (isLoading) return <p className="text-slate-500 text-sm">Caricamento...</p>

  const active = programs?.find(p => p.is_active)
  const history = programs?.filter(p => !p.is_active)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-heading font-bold italic text-xl uppercase text-white">
          Programmi di allenamento
        </h3>
        <Link to={`/clients/${clientId}/programs/new`} className="btn-primary text-sm">
          <Plus size={14} />
          Nuovo programma
        </Link>
      </div>

      {!programs?.length && (
        <div className="card text-center py-10">
          <p className="text-slate-500">Nessun programma assegnato</p>
        </div>
      )}

      {active && <ProgramCard program={active} clientId={clientId} />}

      {history?.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-heading uppercase tracking-wider text-slate-500 mb-4">Storico</p>
          {history.map(prog => <ProgramCard key={prog.id} program={prog} clientId={clientId} />)}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Dieta ───────────────────────────────────────────────

function TabDieta({ clientId }) {
  const { data: diets, isLoading } = useDietPlans(clientId)
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [planName, setPlanName] = useState('')
  const [planExpiry, setPlanExpiry] = useState('')
  const [uploadError, setUploadError] = useState(null)

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !planName.trim()) return
    // reset input file per permettere upload dello stesso file
    e.target.value = ''
    setUploadError(null)
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${clientId}/${Date.now()}.${ext}`
      const { error: storageError } = await supabase.storage
        .from('diet-pdfs')
        .upload(path, file, { contentType: 'application/pdf' })
      if (storageError) throw new Error(`Storage: ${storageError.message}`)

      await supabase.from('diet_plans').update({ is_active: false }).eq('client_id', clientId)

      const { error: insertError } = await supabase.from('diet_plans').insert({
        client_id: clientId,
        name: planName,
        pdf_url: path,
        is_active: true,
        expires_at: planExpiry || null,
      })
      if (insertError) throw new Error(`DB: ${insertError.message}`)

      qc.invalidateQueries({ queryKey: ['diet-plans', clientId] })
      qc.invalidateQueries({ queryKey: ['active-diet-info', clientId] })
      qc.invalidateQueries({ queryKey: ['expiring-items'] })
      setPlanName('')
      setPlanExpiry('')
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  if (isLoading) return <p className="text-slate-500 text-sm">Caricamento...</p>

  const activeDiet = diets?.find(d => d.is_active)
  const oldDiets = diets?.filter(d => !d.is_active)

  return (
    <div className="max-w-4xl mx-auto">
      <h3 className="font-heading font-bold italic text-xl uppercase text-white mb-6">Diete</h3>

      <div className="card mb-6">
        <p className="text-xs font-heading uppercase tracking-wider text-slate-400 mb-3">Carica nuova dieta (PDF)</p>
        <div className="flex gap-3 items-start">
          <input
            className="input flex-1"
            placeholder="Nome (es. Bulk Fase 2)"
            value={planName}
            onChange={e => setPlanName(e.target.value)}
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              type="date"
              className="input w-44"
              style={{ colorScheme: 'dark' }}
              min={new Date().toISOString().split('T')[0]}
              value={planExpiry}
              onChange={e => setPlanExpiry(e.target.value)}
              title="Scadenza (opzionale)"
            />
            {planExpiry && (
              <button
                type="button"
                onClick={() => setPlanExpiry('')}
                className="text-slate-600 hover:text-red-400 transition-colors"
                title="Rimuovi scadenza"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <label className={`btn-primary shrink-0 ${!planName.trim() || uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <Upload size={14} />
            {uploading ? 'CARICAMENTO...' : 'CARICA PDF'}
            <input type="file" accept=".pdf" className="hidden" disabled={!planName.trim() || uploading} onChange={handleUpload} />
          </label>
        </div>
        {uploadError && (
          <p className="text-red-400 text-xs mt-3 bg-red-900/20 px-3 py-2">
            Errore: {uploadError}
            {uploadError.includes('not found') && (
              <span className="block mt-1">→ Il bucket "diet-pdfs" non esiste. Crealo da Supabase Dashboard → Storage → New bucket.</span>
            )}
          </p>
        )}
      </div>

      {activeDiet && (
        <div className="card mb-4 border-gold-500/30">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="badge-gold mr-2">Attiva</span>
              <span className="font-heading font-bold text-lg text-white">{activeDiet.name}</span>
            </div>
            <a href={activeDiet.signedUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-sm">
              <ExternalLink size={14} /> Apri PDF
            </a>
          </div>

          <iframe src={activeDiet.signedUrl} className="w-full h-96 border-0" title="Dieta" />
        </div>
      )}

      {!activeDiet && !oldDiets?.length && (
        <div className="card text-center py-10"><p className="text-slate-500">Nessuna dieta assegnata</p></div>
      )}

      {oldDiets?.length > 0 && (
        <div>
          <p className="text-xs font-heading uppercase tracking-wider text-slate-500 mb-3">Storico</p>
          {oldDiets.map(diet => (
            <div key={diet.id} className="card mb-2 flex items-center justify-between">
              <div>
                <span className="font-heading font-bold text-slate-300">{diet.name}</span>
                <span className="text-slate-500 text-xs ml-3">
                  {fmt(diet.created_at)}{diet.expires_at ? ` — ${fmt(diet.expires_at)}` : ''}
                </span>
              </div>
              <a href={diet.signedUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs px-3 py-1.5">
                <ExternalLink size={12} /> PDF
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Foto ────────────────────────────────────────────────

function PhotoCarousel({ photos }) {
  const [start, setStart] = useState(0)
  const visible = 3
  const total = photos.length
  const canPrev = start > 0
  const canNext = start + visible < total

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setStart(s => s - 1)}
          disabled={!canPrev}
          className="btn-ghost p-1.5 w-8 h-8 flex items-center justify-center shrink-0 disabled:opacity-20 disabled:cursor-default"
        >
          <ArrowLeft size={15} />
        </button>

        <div className="grid grid-cols-3 gap-2 flex-1">
          {photos.slice(start, start + visible).map(photo => (
            <a key={photo.id} href={photo.signedUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={photo.signedUrl}
                alt="Progress"
                className="w-full aspect-square object-cover hover:opacity-80 transition-opacity"
              />
            </a>
          ))}
        </div>

        <button
          onClick={() => setStart(s => s + 1)}
          disabled={!canNext}
          className="btn-ghost p-1.5 w-8 h-8 flex items-center justify-center shrink-0 disabled:opacity-20 disabled:cursor-default"
        >
          <ArrowRight size={15} />
        </button>
      </div>

      {total > visible && (
        <p className="text-slate-600 text-xs mt-2 text-right">{start + 1}–{Math.min(start + visible, total)} di {total}</p>
      )}

      {photos[start]?.notes && (
        <p className="text-slate-400 text-sm mt-2 italic">{photos[start].notes}</p>
      )}
    </div>
  )
}

function WeekRow({ week, clientId }) {
  const [open, setOpen] = useState(false)
  const { data: photos, isLoading } = useWeekPhotos(clientId, week.key, week.weekStart, open)

  return (
    <div className="card mb-3">
      <button className="w-full flex items-center justify-between gap-4" onClick={() => setOpen(o => !o)}>
        <div className="text-left">
          <p className="font-heading font-bold text-white">
            {fmt(week.weekStart, { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">{week.count} foto</p>
        </div>
        {open
          ? <ChevronUp size={16} className="text-slate-500 shrink-0" />
          : <ChevronDown size={16} className="text-slate-500 shrink-0" />
        }
      </button>

      {open && (
        <div className="mt-4 border-t border-navy-700 pt-4">
          {isLoading
            ? <p className="text-slate-500 text-sm">Caricamento...</p>
            : photos?.length
              ? <PhotoCarousel photos={photos.filter(p => p.signedUrl)} />
              : <p className="text-slate-500 text-sm">Nessuna foto</p>
          }
        </div>
      )}
    </div>
  )
}

const PHOTO_PERIODS = [
  { value: 'all', label: 'Tutto' },
  { value: '1',   label: 'Ultimo mese' },
  { value: '3',   label: 'Ultimi 3 mesi' },
  { value: '6',   label: 'Ultimi 6 mesi' },
  { value: '12',  label: 'Ultimo anno' },
]

function periodToSince(value) {
  if (value === 'all') return null
  const d = new Date()
  d.setMonth(d.getMonth() - Number(value))
  d.setHours(0, 0, 0, 0)
  return d
}

function TabFoto({ clientId }) {
  const [period, setPeriod] = useState('all')
  const sinceDate = periodToSince(period)
  const { data: weeks, isLoading, isError, error } = usePhotoWeeks(clientId, sinceDate)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h3 className="font-heading font-bold italic text-xl uppercase text-white">Foto progressi</h3>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 text-xs font-heading uppercase tracking-wider">Periodo</span>
          <select
            className="input text-sm py-1.5 w-40"
            value={period}
            onChange={e => setPeriod(e.target.value)}
          >
            {PHOTO_PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {isLoading && <p className="text-slate-500 text-sm">Caricamento...</p>}
      {isError && <div className="card text-center py-10"><p className="text-red-400 text-sm">Errore: {error?.message}</p></div>}
      {!isLoading && !isError && !weeks?.length && (
        <div className="card text-center py-10">
          <p className="text-slate-500">
            {period === 'all' ? 'Il cliente non ha ancora caricato foto' : 'Nessuna foto nel periodo selezionato'}
          </p>
        </div>
      )}

      {weeks?.map(week => (
        <WeekRow key={week.key} week={week} clientId={clientId} />
      ))}
    </div>
  )
}

// ─── Tab: Dati ────────────────────────────────────────────────

const METRICS = [
  { key: 'peso',           label: 'Peso',            unit: 'kg',   type: 'number'  },
  { key: 'vita',           label: 'Vita',            unit: 'cm',   type: 'number'  },
  { key: 'allenamento',    label: 'Allenamento',     unit: '',     type: 'boolean' },
  { key: 'cheat',          label: 'Cheat',           unit: '',     type: 'boolean' },
  { key: 'ore_sonno',      label: 'Ore sonno',       unit: 'h',    type: 'number'  },
  { key: 'qualita_sonno',  label: 'Qualità sonno',   unit: '1-10', type: 'number'  },
  { key: 'stress',         label: 'Stress',          unit: '1-10', type: 'number'  },
]

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

function getWeekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return d
  })
}

function getMondayOf(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  d.setHours(0, 0, 0, 0)
  return d
}

function toDateKey(date) {
  return date.toISOString().split('T')[0]
}

function useDailyLogs(clientId, weekStart) {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  return useQuery({
    queryKey: ['daily-logs', clientId, toDateKey(weekStart)],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_logs')
        .select('logged_date, data')
        .eq('client_id', clientId)
        .gte('logged_date', toDateKey(weekStart))
        .lt('logged_date', toDateKey(weekEnd))
      if (error) throw error
      return Object.fromEntries((data ?? []).map(r => [r.logged_date, r.data]))
    },
  })
}

function useWeeklyNote(clientId, weekStart) {
  return useQuery({
    queryKey: ['weekly-note', clientId, toDateKey(weekStart)],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weekly_notes')
        .select('notes')
        .eq('client_id', clientId)
        .eq('week_start', toDateKey(weekStart))
        .maybeSingle()
      if (error) throw error
      return data?.notes ?? ''
    },
  })
}

function useSaveWeeklyNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, weekStart, notes }) => {
      const { error } = await supabase
        .from('weekly_notes')
        .upsert(
          { client_id: clientId, week_start: weekStart, notes: notes || null },
          { onConflict: 'client_id,week_start' }
        )
      if (error) throw error
    },
    onSuccess: (_, { clientId, weekStart }) => {
      qc.invalidateQueries({ queryKey: ['weekly-note', clientId, weekStart] })
    },
  })
}

function WeeklyNoteSection({ clientId, monday }) {
  const weekStartStr = toDateKey(monday)
  const { data: note, isLoading } = useWeeklyNote(clientId, monday)
  const saveNote = useSaveWeeklyNote()
  const [value, setValue] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setValue(note ?? '')
    setDirty(false)
  }, [note, weekStartStr])

  async function handleSave() {
    await saveNote.mutateAsync({ clientId, weekStart: weekStartStr, notes: value })
    setDirty(false)
  }

  return (
    <div className="card mt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-heading uppercase tracking-wider text-slate-400">Note della settimana</p>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saveNote.isPending}
            className="btn-primary text-xs px-3 py-1 disabled:opacity-50"
          >
            <Check size={12} /> {saveNote.isPending ? 'Salvo...' : 'Salva'}
          </button>
        )}
      </div>
      <textarea
        className="input w-full text-sm resize-none"
        rows={4}
        placeholder={isLoading ? 'Caricamento...' : 'Annotazioni riferite a questa settimana...'}
        value={value}
        onChange={e => { setValue(e.target.value); setDirty(true) }}
      />
    </div>
  )
}

function computeWeeklyAvg(logs, days, metric) {
  if (metric.type === 'boolean') {
    const count = days.filter(d => logs?.[toDateKey(d)]?.[metric.key] === true).length
    return count > 0 ? `${count}/7` : null
  }
  const vals = days
    .map(d => logs?.[toDateKey(d)]?.[metric.key])
    .filter(v => v != null && v !== '' && !isNaN(Number(v)))
    .map(Number)
  if (vals.length === 0) return null
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  return Number.isInteger(avg) ? avg : avg.toFixed(1)
}

function TabDati({ clientId }) {
  const [monday, setMonday] = useState(() => getMondayOf(new Date()))
  const days = getWeekDays(monday)
  const { data: logs, isLoading } = useDailyLogs(clientId, monday)

  const fmtDay = (d) => d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })

  function prevWeek() { setMonday(m => { const d = new Date(m); d.setDate(d.getDate() - 7); return d }) }
  function nextWeek() { setMonday(m => { const d = new Date(m); d.setDate(d.getDate() + 7); return d }) }
  const isCurrentWeek = toDateKey(monday) === toDateKey(getMondayOf(new Date()))

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-heading font-bold italic text-xl uppercase text-white">Raccolta dati</h3>
        <div className="flex items-center gap-3">
          <button onClick={prevWeek} className="btn-ghost p-1.5"><ArrowLeft size={15} /></button>
          <span className="text-slate-300 text-sm font-heading uppercase tracking-wider min-w-40 text-center">
            {fmtDay(days[0])} – {fmtDay(days[6])}
          </span>
          <button onClick={nextWeek} disabled={isCurrentWeek} className="btn-ghost p-1.5 disabled:opacity-30">
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-700">
              <th className="text-left py-2 pr-4 text-slate-500 text-xs font-heading uppercase tracking-wider whitespace-nowrap w-36">
                Metrica
              </th>
              {days.map((d, i) => (
                <th key={i} className="text-center py-2 px-2 text-slate-500 text-xs font-heading uppercase tracking-wider">
                  <span className="block">{DAY_LABELS[i]}</span>
                  <span className="block text-slate-600 font-normal normal-case tracking-normal">{d.getDate()}</span>
                </th>
              ))}
              <th className="text-center py-2 px-3 text-gold-600 text-xs font-heading uppercase tracking-wider whitespace-nowrap">
                Media
              </th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((metric, mi) => {
              const avg = isLoading ? null : computeWeeklyAvg(logs, days, metric)
              return (
                <tr key={metric.key} className={mi < METRICS.length - 1 ? 'border-b border-navy-800' : ''}>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <span className="text-slate-300 text-xs">{metric.label}</span>
                    {metric.unit && <span className="text-slate-600 text-xs ml-1">({metric.unit})</span>}
                  </td>
                  {days.map((d, di) => {
                    const key = toDateKey(d)
                    const val = logs?.[key]?.[metric.key]
                    let display
                    if (isLoading) {
                      display = <span className="text-navy-700">·</span>
                    } else if (metric.type === 'boolean') {
                      display = val === true
                        ? <span className="text-gold-500 font-bold">✓</span>
                        : <span className="text-navy-700">—</span>
                    } else {
                      display = val != null
                        ? <span className="text-white font-medium">{val}</span>
                        : <span className="text-navy-700">—</span>
                    }
                    return (
                      <td key={di} className="py-3 px-2 text-center">{display}</td>
                    )
                  })}
                  <td className="py-3 px-3 text-center">
                    {isLoading
                      ? <span className="text-navy-700">·</span>
                      : avg != null
                        ? <span className="text-gold-400 font-semibold text-xs">{avg}</span>
                        : <span className="text-navy-700">—</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <WeeklyNoteSection clientId={clientId} monday={monday} />
    </div>
  )
}

// ─── Pagina principale ─────────────────────────────────────────

const TABS = [
  { id: 'scheda', label: 'SCHEDA' },
  { id: 'dieta',  label: 'DIETA' },
  { id: 'photos', label: 'FOTO PROGRESSI' },
  { id: 'dati',   label: 'DATI' },
]

export function ClientDetail() {
  const { id } = useParams()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const cameFromHome = location.state?.from === 'home'
  const activeTab = searchParams.get('tab') || 'scheda'
  const { data: client, isLoading } = useClient(id)
  const { data: activeProgram } = useActiveProgram(id)
  const { data: activeDietInfo } = useActiveDietInfo(id)
  const { data: formUrl } = useQuestionnaireFormUrl()
  const setQuestionnaire = useSetQuestionnaire()
  const updateProgramExpiry = useUpdateProgramExpiry()
  const updateDietExpiry = useUpdateDietExpiry()

  const pending = client?.questionnaire_pending ?? false

  async function handleSendQuestionnaire() {
    await setQuestionnaire.mutateAsync({ clientId: id, pending: true })
  }

  async function handleRevokeQuestionnaire() {
    await setQuestionnaire.mutateAsync({ clientId: id, pending: false })
  }

  if (isLoading) return <div className="p-8 max-w-4xl mx-auto w-full"><p className="text-slate-500">Caricamento...</p></div>

  return (
    <div className="p-8">
      <Link to={cameFromHome ? '/' : '/clients'} className="btn-ghost mb-6 -ml-2 text-sm">
        <ArrowLeft size={15} /> {cameFromHome ? 'Home' : 'Tutti i clienti'}
      </Link>

      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-navy-800 border border-navy-700 flex items-center justify-center shrink-0">
            <span className="font-heading font-bold text-gold-500 text-2xl">
              {client?.full_name?.[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div>
            <h1 className="font-heading font-bold italic text-4xl text-white uppercase leading-tight">
              {client?.full_name ?? '—'}
            </h1>
            <div className="flex items-center gap-4 mt-1">
              {client?.email && <span className="text-slate-400 text-sm">{client.email}</span>}
              {client?.phone && <>
                <span className="text-navy-600">·</span>
                <span className="text-slate-400 text-sm">{client.phone}</span>
              </>}
            </div>
          </div>
        </div>

        {/* Questionario */}
        <div className="flex items-center gap-2 shrink-0">
          {pending && (
            <span className="flex items-center gap-1.5 text-amber-400 text-xs font-heading uppercase tracking-wider">
              <Clock size={13} /> In attesa
            </span>
          )}
          {pending
            ? (
              <button
                onClick={handleRevokeQuestionnaire}
                disabled={setQuestionnaire.isPending}
                className="btn-ghost text-xs px-3 py-1.5 disabled:opacity-50"
              >
                <X size={13} /> Annulla invio
              </button>
            )
            : (
              <button
                onClick={handleSendQuestionnaire}
                disabled={setQuestionnaire.isPending || !formUrl}
                title={!formUrl ? 'Configura il link del form in Impostazioni' : undefined}
                className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
              >
                <Send size={13} /> Invia questionario
              </button>
            )
          }
        </div>
      </div>

      {/* Scadenze programma e dieta */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <ExpiryCard
          icon={Dumbbell}
          type="Programma"
          item={activeProgram}
          clientId={id}
          isSaving={updateProgramExpiry.isPending}
          onSave={dateValue => updateProgramExpiry.mutateAsync({ clientId: id, programId: activeProgram?.id, expiresAt: dateValue })}
        />
        <ExpiryCard
          icon={Salad}
          type="Dieta"
          item={activeDietInfo}
          clientId={id}
          isSaving={updateDietExpiry.isPending}
          onSave={dateValue => updateDietExpiry.mutateAsync({ clientId: id, dietId: activeDietInfo?.id, expiresAt: dateValue })}
        />
      </div>

      <div className="flex gap-0 border-b border-navy-700 mb-8 justify-center">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSearchParams({ tab: tab.id })}
            className={`font-heading font-bold italic uppercase tracking-wider px-6 py-3 text-sm border-b-2 transition-colors
              ${activeTab === tab.id ? 'text-gold-500 border-gold-500' : 'text-slate-400 border-transparent hover:text-white'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'scheda' && <TabScheda clientId={id} />}
      {activeTab === 'dieta'  && <TabDieta  clientId={id} />}
      {activeTab === 'photos' && <TabFoto   clientId={id} />}
      {activeTab === 'dati'   && <TabDati   clientId={id} />}
    </div>
  )
}
