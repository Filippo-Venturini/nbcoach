import { GripVertical, Search } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, useLocation, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Upload, Plus, ExternalLink, ChevronDown, ChevronUp, Pencil, Check, X, ArrowUp, ArrowDown, Send, Clock, Dumbbell, Salad, Trash2, KeyRound, Copy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { APP_URL } from '../lib/config'
import { ConfirmModal } from '../components/ConfirmModal'
import { SupersetPicker, supersetCardStyle } from '../components/SupersetPicker'

// ─── Data hooks ───────────────────────────────────────────────

function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exercises_catalog')
        .select('id, name, youtube_id, muscle_group')
        .order('muscle_group').order('name')
      if (error) throw error
      return data
    },
  })
}

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

function useSyncPlanExercises() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, planId, exercises, deletedIds }) => {
      if (deletedIds.length) {
        const { error } = await supabase.from('workout_exercises').delete().in('id', deletedIds)
        if (error) throw error
      }

      const results = await Promise.all(exercises.map((ex, i) => {
        const payload = {
          sets: ex.sets ? parseInt(ex.sets) : null,
          reps: ex.reps || null,
          carico: ex.carico || null,
          rest: ex.rest?.trim() || null,
          cadenza: ex.cadenza || null,
          notes: ex.notes || null,
          superset_color: ex.superset_color || null,
          order_index: i,
        }
        return ex.dbId
          ? supabase.from('workout_exercises').update(payload).eq('id', ex.dbId)
          : supabase.from('workout_exercises').insert({ ...payload, plan_id: planId, exercise_id: ex.exercise_id })
      }))
      const failed = results.find(r => r.error)
      if (failed) throw failed.error
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

// Programma "in evidenza" per la card riassuntiva in testa alla pagina cliente:
// non ci basiamo più su un flag is_active esclusivo (ora un cliente può avere
// più programmi attivi/futuri insieme), calcoliamo l'attivo per data e, se ce
// ne sono più d'uno, mostriamo quello con scadenza più vicina.
function useActiveProgram(clientId) {
  return useQuery({
    queryKey: ['active-program', clientId],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('workout_programs')
        .select('id, name, starts_at, expires_at')
        .eq('client_id', clientId)
        .or(`starts_at.is.null,starts_at.lte.${today}`)
        .or(`expires_at.is.null,expires_at.gte.${today}`)
        // Scadenza più lontana tra gli attivi: nessuna scadenza (NULL) è
        // "infinita" quindi vince su qualunque data → va per prima.
        .order('expires_at', { ascending: false, nullsFirst: true })
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
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('diet_plans')
        .select('id, name, starts_at, expires_at')
        .eq('client_id', clientId)
        .or(`starts_at.is.null,starts_at.lte.${today}`)
        .or(`expires_at.is.null,expires_at.gte.${today}`)
        .order('expires_at', { ascending: false, nullsFirst: true })
        .limit(1)
        .maybeSingle()
      return data
    },
  })
}

// Elimina un programma e tutto ciò che dipende da lui (schede + esercizi),
// esplicitamente e in ordine, così non restano residui in DB indipendentemente
// da come sono configurate le foreign key.
function useDeleteProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, programId }) => {
      const { data: planRows, error: planFetchError } = await supabase
        .from('workout_plans')
        .select('id')
        .eq('program_id', programId)
      if (planFetchError) throw planFetchError

      const planIds = (planRows ?? []).map(p => p.id)
      if (planIds.length) {
        const { error: exError } = await supabase.from('workout_exercises').delete().in('plan_id', planIds)
        if (exError) throw exError
      }

      const { error: plansError } = await supabase.from('workout_plans').delete().eq('program_id', programId)
      if (plansError) throw plansError

      const { error: progError } = await supabase.from('workout_programs').delete().eq('id', programId)
      if (progError) throw progError
    },
    onSuccess: (_, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['workout-programs', clientId] })
      qc.invalidateQueries({ queryKey: ['active-program', clientId] })
      qc.invalidateQueries({ queryKey: ['last-program', clientId] })
      qc.invalidateQueries({ queryKey: ['expiring-items'] })
      qc.invalidateQueries({ queryKey: ['home-kpis'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

// Elimina una dieta: prima il PDF dal bucket storage, poi la riga in DB.
// Se la rimozione dal bucket fallisce, la riga non viene toccata (l'errore
// propaga e la modale resta aperta), così non si perde il riferimento a un
// file che è ancora effettivamente su storage.
function useDeleteDiet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, dietId, pdfPath }) => {
      if (pdfPath) {
        const { error: storageError } = await supabase.storage.from('diet-pdfs').remove([pdfPath])
        if (storageError) throw storageError
      }
      const { error } = await supabase.from('diet_plans').delete().eq('id', dietId)
      if (error) throw error
    },
    onSuccess: (_, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['diet-plans', clientId] })
      qc.invalidateQueries({ queryKey: ['active-diet-info', clientId] })
      qc.invalidateQueries({ queryKey: ['expiring-items'] })
      qc.invalidateQueries({ queryKey: ['home-kpis'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

// Aggiorna inizio + fine insieme, usato dall'editor inline nelle box di
// programma/dieta: è l'unico punto dove le date restano modificabili, dopo
// che il badge riassuntivo in testa pagina è diventato di sola lettura.
function useUpdateProgramDates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, programId, starts_at, expires_at }) => {
      const { error } = await supabase
        .from('workout_programs')
        .update({ starts_at, expires_at })
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

function useUpdateDietDates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, dietId, starts_at, expires_at }) => {
      const { error } = await supabase
        .from('diet_plans')
        .update({ starts_at, expires_at })
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

// Elimina TUTTE le foto di una settimana in un colpo solo: prima i file dal
// bucket (batch), poi le righe in DB (batch). Se lo storage fallisce non
// tocchiamo il DB, così non resta un riferimento a file ancora presenti.
function useDeleteWeekPhotos() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, weekStart }) => {
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 7)

      const { data: rows, error: fetchError } = await supabase
        .from('progress_photos')
        .select('id, photo_url')
        .eq('client_id', clientId)
        .gte('created_at', weekStart.toISOString())
        .lt('created_at', weekEnd.toISOString())
      if (fetchError) throw fetchError

      const paths = (rows ?? []).map(r => r.photo_url).filter(Boolean)
      if (paths.length) {
        const { error: storageError } = await supabase.storage.from('progress-photos').remove(paths)
        if (storageError) throw storageError
      }

      const ids = (rows ?? []).map(r => r.id)
      if (ids.length) {
        const { error: deleteError } = await supabase.from('progress_photos').delete().in('id', ids)
        if (deleteError) throw deleteError
      }
    },
    onSuccess: (_, { clientId }) => {
      // 'photo-weeks' e 'week-photos' sono chiavizzate anche per periodo/settimana,
      // che qui non conosciamo tutte: invalidiamo tutte le varianti per questo cliente.
      qc.invalidateQueries({ predicate: q => q.queryKey[0] === 'photo-weeks' && q.queryKey[1] === clientId })
      qc.invalidateQueries({ predicate: q => q.queryKey[0] === 'week-photos' && q.queryKey[1] === clientId })
      qc.invalidateQueries({ queryKey: ['recent-photos'] })
    },
  })

}

// ─── Helpers ──────────────────────────────────────────────────

function normalizeExercise(ex) {
  return {
    id: ex.id,           // usato anche come chiave sortable
    dbId: ex.id,          // presente => riga esistente in db
    exercise_id: ex.exercise_id,
    name: ex.exercises_catalog?.name ?? '',
    muscle_group: ex.exercises_catalog?.muscle_group ?? '',
    youtube_id: ex.exercises_catalog?.youtube_id ?? '',
    reps_effettive: ex.reps_effettive,
    sets: ex.sets ?? '',
    reps: ex.reps ?? '',
    carico: ex.carico ?? '',
    rest: ex.rest ?? '',
    cadenza: ex.cadenza ?? '',
    notes: ex.notes ?? '',
    superset_color: ex.superset_color ?? null,
  }
}

function makeNewDraftExercise(catalogItem) {
  return {
    id: crypto.randomUUID(),
    dbId: null,
    exercise_id: catalogItem.id,
    name: catalogItem.name,
    muscle_group: catalogItem.muscle_group,
    youtube_id: catalogItem.youtube_id,
    reps_effettive: null,
    sets: '', reps: '', carico: '', rest: '', cadenza: '', notes: '',
    superset_color: null,
  }
}

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

// Stato calcolato di un programma/dieta a partire dalle date, non da un
// flag salvato in DB: 'future' se non ancora iniziato, 'history' se
// scaduto, altrimenti 'active'. Un record senza starts_at è considerato
// già iniziato (retrocompatibilità con i record creati prima di questa
// modifica). Essendo calcolato ad ogni render, la transizione tra stati
// è automatica: non serve nessun cron/job che aggiorni un flag.
function getStatus(item) {
  const today = new Date().toISOString().split('T')[0]
  if (item.starts_at && item.starts_at > today) return 'future'
  if (item.expires_at && item.expires_at < today) return 'history'
  return 'active'
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

// Etichetta inline dell'intervallo di date, cliccabile per modificarle.
// Usata sia nelle box dei programmi che in quelle delle diete.
function DateRangeEditor({ startsAt, expiresAt, onSave, isSaving }) {
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState(startsAt ?? '')
  const [end, setEnd] = useState(expiresAt ?? '')

  useEffect(() => {
    setStart(startsAt ?? '')
    setEnd(expiresAt ?? '')
  }, [startsAt, expiresAt])

  async function handleSave() {
    await onSave({ starts_at: start || null, expires_at: end || null })
    setEditing(false)
  }

  function handleCancel() {
    setStart(startsAt ?? '')
    setEnd(expiresAt ?? '')
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setEditing(true) }}
        className="flex items-center gap-1.5 text-slate-500 hover:text-white text-xs transition-colors shrink-0"
        title="Modifica date"
      >
        <span>{startsAt ? fmt(startsAt) : '—'} → {expiresAt ? fmt(expiresAt) : '—'}</span>
        <Pencil size={11} />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
      <input
        type="date"
        className="input text-xs py-1 w-32"
        style={{ colorScheme: 'dark' }}
        value={start}
        onChange={e => setStart(e.target.value)}
      />
      <span className="text-slate-600 text-xs">→</span>
      <input
        type="date"
        className="input text-xs py-1 w-32"
        style={{ colorScheme: 'dark' }}
        value={end}
        min={start || undefined}
        onChange={e => setEnd(e.target.value)}
      />
      <button onClick={handleSave} disabled={isSaving} className="btn-primary text-xs px-2 py-1 disabled:opacity-50">
        <Check size={12} />
      </button>
      <button onClick={handleCancel} className="btn-ghost text-xs px-2 py-1">
        <X size={12} />
      </button>
    </div>
  )
}

// Badge di stato per programmi/diete (null per lo storico: niente badge)
function StatusBadge({ status }) {
  if (status === 'active') return <span className="badge-gold">Attivo</span>
  if (status === 'future') {
    return (
      <span className="text-xs font-heading uppercase tracking-wider px-2 py-0.5 border border-blue-400/40 text-blue-300 bg-blue-900/20">
        In programma
      </span>
    )
  }
  return null
}

function ExerciseViewRow({ ex, onVideoToggle, videoId }) {
  const isVideoOpen = videoId === ex.exercises_catalog?.youtube_id
  return (
    <div>
      <div className="bg-navy-900 px-4 py-3" style={supersetCardStyle(ex.superset_color)}>
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
            <label className="block text-xs text-slate-500 mb-1">Riposo (min)</label>
            <ReadBox value={ex.rest} />
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

function SortableExerciseEditRow({ id, ex, onChange, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
    ...supersetCardStyle(ex.superset_color),
  }
  return (
    <div ref={setNodeRef} style={style} className="bg-navy-900 px-4 py-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400 transition-colors p-0.5 touch-none shrink-0"
            onClick={e => e.stopPropagation()}
          >
            <GripVertical size={15} />
          </button>
          <p className="font-medium text-white text-sm truncate">{ex.name}</p>
        </div>
        <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-12 gap-1.5 mb-1.5">
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Serie</label>
          <input className="input text-xs py-1" value={ex.sets} onChange={e => onChange('sets', e.target.value)} placeholder="4" />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-slate-500 mb-1">Reps</label>
          <input className="input text-xs py-1" value={ex.reps} onChange={e => onChange('reps', e.target.value)} placeholder="8-10" />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-slate-500 mb-1">Reps effettive</label>
          <ReadBox value={ex.reps_effettive} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Carico</label>
          <input className="input text-xs py-1" value={ex.carico} onChange={e => onChange('carico', e.target.value)} placeholder="80kg" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Riposo (min)</label>
          <input className="input text-xs py-1" value={ex.rest} onChange={e => onChange('rest', e.target.value)} placeholder="1:30" />
        </div>
      </div>
      <input className="input text-xs py-1 mb-1.5" value={ex.cadenza ?? ''} onChange={e => onChange('cadenza', e.target.value)} placeholder="Cadenza (opzionale)" />
      <input className="input text-xs py-1" value={ex.notes ?? ''} onChange={e => onChange('notes', e.target.value)} placeholder="Note (opzionale)" />

      <div className="mt-2">
        <SupersetPicker color={ex.superset_color} onChange={val => onChange('superset_color', val)} />
      </div>
    </div>
  )
}

const MUSCLE_GROUPS = [
  'Tutti', 'Petto', 'Centro Schiena', 'Dorsale', 'Spalle', 'Spalla Posteriore', 'Bicipiti',
  'Tricipiti', 'Quadricipiti', 'Femorali', 'Glutei', 'Addome', 'Stabilizzatori',
]

function ExerciseCatalogModal({ onSelect, onClose }) {
  const { data: catalog } = useCatalog()
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('Tutti')

  const filtered = catalog?.filter(ex => {
    const matchSearch = ex.name.toLowerCase().includes(search.toLowerCase())
    const matchGroup = group === 'Tutti' || ex.muscle_group === group
    return matchSearch && matchGroup
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading font-bold italic text-lg text-white uppercase tracking-wide">Aggiungi esercizio</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>
        <div className="relative mb-2">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-8 text-sm py-2" placeholder="Cerca..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        </div>
        <select className="input text-sm py-2 mb-3" value={group} onChange={e => setGroup(e.target.value)}>
          {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <div className="overflow-y-auto flex-1 space-y-1 pr-0.5">
          {filtered?.map(ex => (
            <button
              key={ex.id}
              onClick={() => { onSelect(ex); onClose() }}
              className="w-full text-left px-3 py-2 border transition-colors bg-navy-800 border-navy-700 hover:border-gold-500/50 cursor-pointer"
            >
              <p className="text-white text-xs font-medium">{ex.name}</p>
              {ex.muscle_group && <p className="text-slate-500 text-xs">{ex.muscle_group}</p>}
            </button>
          ))}
          {filtered?.length === 0 && <p className="text-slate-500 text-sm text-center py-4">Nessun esercizio trovato</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Volume counter ───────────────────────────────────────────

// Numero di serie di un esercizio (0 se non valorizzato/non valido)
function setsCount(value) {
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// Volume = somma delle serie per gruppo muscolare (non numero di esercizi)
function countsFromExercises(exercises) {
  const counts = {}
  for (const ex of (exercises ?? [])) {
    const mg = ex.exercises_catalog?.muscle_group ?? ex.muscle_group
    if (!mg) continue
    const s = setsCount(ex.sets)
    if (s > 0) counts[mg] = (counts[mg] || 0) + s
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

// Esercizi di una scheda con applicati i valori in corso di modifica (bozza non
// ancora salvata), così i contatori di volume si aggiornano live
function exercisesWithDraft(plan, draft) {
  return draft ?? (plan.workout_exercises ?? [])
}

// drafts: { [planId]: bozza } delle schede attualmente in modifica
function ProgramVolumeCounter({ plans, drafts }) {
  const [open, setOpen] = useState(false)
  const counts = countsFromExercises(
    (plans ?? []).flatMap(p => exercisesWithDraft(p, drafts?.[p.id]))
  )
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

function PlanVolumeCounter({ plan, draft }) {
  const counts = countsFromExercises(exercisesWithDraft(plan, draft))
  if (!Object.keys(counts).length) return null
  return (
    <div className="px-4 py-2 bg-navy-950 border-b border-navy-700">
      <VolumeBadges counts={counts} />
    </div>
  )
}

// ─── Expiry cards ─────────────────────────────────────────────

// Sola lettura: mostra la scadenza del programma/dieta "di riferimento"
// (il più lontano tra gli attivi, vedi useActiveProgram/useActiveDietInfo).
// Le date si modificano solo dai box dei singoli programmi/diete più sotto,
// non più da qui.
function ExpiryCard({ icon: Icon, type, item }) {
  const days = item?.expires_at ? Math.ceil((new Date(item.expires_at) - new Date()) / (1000 * 60 * 60 * 24)) : null
  const urgent = days !== null && days <= 7
  const dateColor = days === null ? 'text-slate-600' : days < 0 ? 'text-red-400' : days <= 7 ? 'text-amber-400' : 'text-white'

  return (
    <div className={`card flex items-center gap-3 ${urgent ? 'border-amber-500/30' : ''}`}>
      <div className={`w-8 h-8 flex items-center justify-center shrink-0 ${urgent ? 'bg-amber-900/30' : 'bg-navy-900'}`}>
        <Icon size={15} className={urgent ? 'text-amber-400' : 'text-gold-500'} />
      </div>
      <div>
        <p className="text-xs font-heading uppercase tracking-wider text-slate-500">{type}</p>
        <p className={`text-base font-heading font-bold uppercase tracking-wider mt-0.5 ${dateColor}`}>
          <span className="text-slate-500 mr-1.5">Scadenza:</span>
          {item?.expires_at ? fmt(item.expires_at).toUpperCase() : '—'}
        </p>
      </div>
    </div>
  )
}

// ─── Tab: Scheda ──────────────────────────────────────────────

function PlanCard({ plan, editable, clientId, onDraftChange }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [videoId, setVideoId] = useState(null)
  const [draftExercises, setDraftExercises] = useState([])
  const [showCatalog, setShowCatalog] = useState(false)
  const syncExercises = useSyncPlanExercises()

  useEffect(() => {
    onDraftChange?.(plan.id, editing ? draftExercises : null)
  }, [plan.id, editing, draftExercises, onDraftChange])

  useEffect(() => () => onDraftChange?.(plan.id, null), [plan.id, onDraftChange])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function startEdit() {
    setDraftExercises((plan.workout_exercises ?? []).map(normalizeExercise))
    setEditing(true)
    setExpanded(true)
  }

  function updateDraftField(id, field, value) {
    setDraftExercises(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
  }

  function removeDraftExercise(id) {
    setDraftExercises(prev => prev.filter(e => e.id !== id))
  }

  function addDraftExercise(catalogItem) {
    setDraftExercises(prev => [...prev, makeNewDraftExercise(catalogItem)])
  }

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setDraftExercises(prev => {
      const oldIndex = prev.findIndex(e => e.id === active.id)
      const newIndex = prev.findIndex(e => e.id === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  async function saveEdit() {
    const deletedIds = (plan.workout_exercises ?? [])
      .filter(ex => !draftExercises.some(d => d.dbId === ex.id))
      .map(ex => ex.id)
    try {
      await syncExercises.mutateAsync({ clientId, planId: plan.id, exercises: draftExercises, deletedIds })
      setEditing(false)
    } catch {
      // resta in modifica: l'errore è mostrato accanto ai pulsanti
    }
  }

  function cancelEdit() {
    setEditing(false)
  }

  function toggleVideo(ytId) {
    setVideoId(prev => prev === ytId ? null : ytId)
  }

  return (
    <div className="border border-navy-700 bg-navy-900">
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
          {editable && !editing && (
            <button onClick={startEdit} className="btn-ghost text-xs px-2 py-1">
              <Pencil size={12} /> Modifica
            </button>
          )}
          {editing && (
            <>
              {syncExercises.isError && (
                <span className="text-red-400 text-xs">Salvataggio non riuscito</span>
              )}
              <button onClick={cancelEdit} className="btn-ghost text-xs px-2 py-1">
                <X size={12} /> Annulla
              </button>
              <button onClick={saveEdit} disabled={syncExercises.isPending} className="btn-primary text-xs px-3 py-1 disabled:opacity-50">
                <Check size={12} /> {syncExercises.isPending ? 'Salvo...' : 'Salva'}
              </button>
            </>
          )}
          {expanded
            ? <ChevronUp size={16} className="text-slate-500" />
            : <ChevronDown size={16} className="text-slate-500" />
          }
        </div>
      </div>

      {expanded && (
        <div className="border-t border-navy-700">
          <PlanVolumeCounter plan={plan} draft={editing ? draftExercises : null} />
          <div className="divide-y divide-navy-700">
            {editing ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={draftExercises.map(e => e.id)} strategy={verticalListSortingStrategy}>
                  {draftExercises.map(ex => (
                    <SortableExerciseEditRow
                      key={ex.id}
                      id={ex.id}
                      ex={ex}
                      onChange={(field, val) => updateDraftField(ex.id, field, val)}
                      onRemove={() => removeDraftExercise(ex.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              plan.workout_exercises?.map(ex => (
                <ExerciseViewRow key={ex.id} ex={ex} videoId={videoId} onVideoToggle={toggleVideo} />
              ))
            )}
            {editing && draftExercises.length === 0 && (
              <p className="text-slate-500 text-sm px-4 py-3">Nessun esercizio, aggiungine uno</p>
            )}
            {!editing && !plan.workout_exercises?.length && (
              <p className="text-slate-500 text-sm px-4 py-3">Nessun esercizio</p>
            )}
          </div>
          {editing && (
            <div className="px-4 py-3 border-t border-navy-700">
              <button onClick={() => setShowCatalog(true)} className="btn-ghost text-xs px-3 py-1.5">
                <Plus size={13} /> Aggiungi esercizio
              </button>
            </div>
          )}
        </div>
      )}

      {showCatalog && (
        <ExerciseCatalogModal onSelect={addDraftExercise} onClose={() => setShowCatalog(false)} />
      )}
    </div>
  )
}

function ProgramCard({ program, clientId }) {
  const status = getStatus(program)
  const [open, setOpen] = useState(status === 'active')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState(program.notes ?? '')
  // Bozze delle schede in modifica, per il contatore di volume del programma
  const [planDrafts, setPlanDrafts] = useState({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const updateNotes = useUpdateProgramNotes()
  const updateDates = useUpdateProgramDates()
  const deleteProgram = useDeleteProgram()

  const handleDraftChange = useCallback((planId, draft) => {
    setPlanDrafts(prev => {
      if (!draft) {
        if (!(planId in prev)) return prev
        const next = { ...prev }
        delete next[planId]
        return next
      }
      if (prev[planId] === draft) return prev
      return { ...prev, [planId]: draft }
    })
  }, [])

  async function saveNotes() {
    await updateNotes.mutateAsync({ clientId, programId: program.id, notes: notesValue })
    setEditingNotes(false)
  }

  function cancelNotes() {
    setNotesValue(program.notes ?? '')
    setEditingNotes(false)
  }

  async function handleDeleteProgram() {
    setDeleteError(null)
    try {
      await deleteProgram.mutateAsync({ clientId, programId: program.id })
      setConfirmDelete(false)
    } catch (err) {
      setDeleteError('Errore: ' + (err.message || 'eliminazione non riuscita'))
    }
  }

  return (
    <div className={`card mb-4 ${status === 'active' ? 'border-gold-500/30' : status === 'future' ? 'border-blue-500/20' : ''}`}>
      {/* Header: badge + nome + date, editabili senza aprire/chiudere la card */}
      <div className="flex items-center justify-between gap-4">
        <button className="flex items-center gap-3 flex-1 text-left" onClick={() => setOpen(o => !o)}>
          <p className="font-heading font-bold italic uppercase tracking-wide text-white text-lg text-left">
            {program.name ?? 'Programma'}
          </p>
          <StatusBadge status={status} />
        </button>
        <div className="flex items-center gap-3 shrink-0">
          <DateRangeEditor
            startsAt={program.starts_at}
            expiresAt={program.expires_at}
            isSaving={updateDates.isPending}
            onSave={dates => updateDates.mutateAsync({ clientId, programId: program.id, ...dates })}
          />
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
            className="text-slate-600 hover:text-red-400 transition-colors p-1"
            title="Elimina programma"
          >
            <Trash2 size={14} />
          </button>
          <button onClick={() => setOpen(o => !o)} className="text-slate-500 hover:text-white transition-colors">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Volume */}
          <ProgramVolumeCounter plans={program.workout_plans} drafts={planDrafts} />

          {/* Note: visibili solo se presenti, editing inline */}
          {!editingNotes && notesValue && (
            <div className="flex items-start gap-2">
              <p className="text-sm italic flex-1 whitespace-pre-wrap">
                <span className="text-slate-300">Note programma: </span>
                <span className="text-slate-400">{notesValue}</span>
              </p>
              {status !== 'history' && (
                <button onClick={() => setEditingNotes(true)} className="p-1 text-slate-600 hover:text-white transition-colors shrink-0 mt-0.5">
                  <Pencil size={12} />
                </button>
              )}
            </div>
          )}
          {!editingNotes && !notesValue && status !== 'history' && (
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
                editable={status !== 'history'}
                clientId={clientId}
                onDraftChange={handleDraftChange}
              />
            ))}
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          message="Eliminare questo programma?"
          detail={deleteError ?? `"${program.name ?? 'Programma'}" e tutte le sue schede/esercizi verranno eliminati definitivamente. L'azione è irreversibile.`}
          confirmLabel="ELIMINA"
          isPending={deleteProgram.isPending}
          onConfirm={handleDeleteProgram}
          onCancel={() => { setConfirmDelete(false); setDeleteError(null) }}
        />
      )}
    </div>
  )
}

function TabScheda({ clientId }) {
  const { data: programs, isLoading } = useWorkoutPrograms(clientId)

  if (isLoading) return <p className="text-slate-500 text-sm">Caricamento...</p>

  // Sezioni calcolate dalle date, non da un flag salvato: la transizione
  // futuro → attivo → storico avviene da sola quando cambia la data odierna.
  const active = programs?.filter(p => getStatus(p) === 'active') ?? []
  const future = (programs?.filter(p => getStatus(p) === 'future') ?? [])
    .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''))
  const history = programs?.filter(p => getStatus(p) === 'history') ?? []

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

      {active.map(prog => <ProgramCard key={prog.id} program={prog} clientId={clientId} />)}

      {future.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-heading uppercase tracking-wider text-slate-500 mb-4">Programmi futuri</p>
          {future.map(prog => <ProgramCard key={prog.id} program={prog} clientId={clientId} />)}
        </div>
      )}

      {history.length > 0 && (
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
  const updateDietDates = useUpdateDietDates()
  const deleteDiet = useDeleteDiet()
  const [uploading, setUploading] = useState(false)
  const [planName, setPlanName] = useState('')
  const [planStart, setPlanStart] = useState('')
  const [planExpiry, setPlanExpiry] = useState('')
  const [uploadError, setUploadError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState(null)

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

      // Non disattiviamo più le altre diete: possono coesistere più diete
      // attive/future, esattamente come per i programmi di allenamento.
      const { error: insertError } = await supabase.from('diet_plans').insert({
        client_id: clientId,
        name: planName,
        pdf_url: path,
        is_active: true,
        starts_at: planStart || null,
        expires_at: planExpiry || null,
      })
      if (insertError) throw new Error(`DB: ${insertError.message}`)

      qc.invalidateQueries({ queryKey: ['diet-plans', clientId] })
      qc.invalidateQueries({ queryKey: ['active-diet-info', clientId] })
      qc.invalidateQueries({ queryKey: ['expiring-items'] })
      setPlanName('')
      setPlanStart('')
      setPlanExpiry('')
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function saveDietDates(dietId, dates) {
    return updateDietDates.mutateAsync({ clientId, dietId, ...dates })
  }

  async function handleDeleteDiet() {
    setDeleteError(null)
    try {
      await deleteDiet.mutateAsync({ clientId, dietId: deleteTarget.id, pdfPath: deleteTarget.pdf_url })
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError('Errore: ' + (err.message || 'eliminazione non riuscita'))
    }
  }

  if (isLoading) return <p className="text-slate-500 text-sm">Caricamento...</p>

  const activeDiets = diets?.filter(d => getStatus(d) === 'active') ?? []
  const futureDiets = (diets?.filter(d => getStatus(d) === 'future') ?? [])
    .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''))
  const oldDiets = diets?.filter(d => getStatus(d) === 'history') ?? []

  return (
    <div className="max-w-4xl mx-auto">
      <h3 className="font-heading font-bold italic text-xl uppercase text-white mb-6">Diete</h3>

      <div className="card mb-6">
        <p className="text-xs font-heading uppercase tracking-wider text-slate-400 mb-3">Carica nuova dieta (PDF)</p>
        <div className="flex gap-3 items-start flex-wrap">
          <input
            className="input flex-1 min-w-48"
            placeholder="Nome (es. Bulk Fase 2)"
            value={planName}
            onChange={e => setPlanName(e.target.value)}
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              type="date"
              className="input w-40"
              style={{ colorScheme: 'dark' }}
              value={planStart}
              onChange={e => setPlanStart(e.target.value)}
              title="Data inizio (opzionale)"
            />
            {planStart && (
              <button
                type="button"
                onClick={() => setPlanStart('')}
                className="text-slate-600 hover:text-red-400 transition-colors"
                title="Rimuovi data inizio"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              type="date"
              className="input w-40"
              style={{ colorScheme: 'dark' }}
              min={planStart || undefined}
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

      {activeDiets.map(diet => (
        <div key={diet.id} className="card mb-4 border-gold-500/30">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="badge-gold">Attiva</span>
              <span className="font-heading font-bold text-lg text-white">{diet.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <DateRangeEditor
                startsAt={diet.starts_at}
                expiresAt={diet.expires_at}
                isSaving={updateDietDates.isPending}
                onSave={dates => saveDietDates(diet.id, dates)}
              />
              <a href={diet.signedUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-sm">
                <ExternalLink size={14} /> Apri PDF
              </a>
              <button
                type="button"
                onClick={() => setDeleteTarget(diet)}
                className="text-slate-600 hover:text-red-400 transition-colors p-1.5"
                title="Elimina dieta"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <iframe src={diet.signedUrl} className="w-full h-96 border-0" title={diet.name} />
        </div>
      ))}

      {futureDiets.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-heading uppercase tracking-wider text-slate-500 mb-3">Diete future</p>
          {futureDiets.map(diet => (
            <div key={diet.id} className="card mb-2 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <StatusBadge status="future" />
                <span className="font-heading font-bold text-white">{diet.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <DateRangeEditor
                  startsAt={diet.starts_at}
                  expiresAt={diet.expires_at}
                  isSaving={updateDietDates.isPending}
                  onSave={dates => saveDietDates(diet.id, dates)}
                />
                <a href={diet.signedUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs px-3 py-1.5">
                  <ExternalLink size={12} /> PDF
                </a>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(diet)}
                  className="text-slate-600 hover:text-red-400 transition-colors p-1"
                  title="Elimina dieta"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!activeDiets.length && !futureDiets.length && !oldDiets?.length && (
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
              <div className="flex items-center gap-1">
                <a href={diet.signedUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs px-3 py-1.5">
                  <ExternalLink size={12} /> PDF
                </a>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(diet)}
                  className="text-slate-600 hover:text-red-400 transition-colors p-1"
                  title="Elimina dieta"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          message="Eliminare questa dieta?"
          detail={deleteError ?? `"${deleteTarget.name}" e il relativo PDF verranno eliminati definitivamente da database e storage. L'azione è irreversibile.`}
          confirmLabel="ELIMINA"
          isPending={deleteDiet.isPending}
          onConfirm={handleDeleteDiet}
          onCancel={() => { setDeleteTarget(null); setDeleteError(null) }}
        />
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
                loading="lazy"
                decoding="async"
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const { data: photos, isLoading } = useWeekPhotos(clientId, week.key, week.weekStart, open)
  const deleteWeek = useDeleteWeekPhotos()

  async function handleDeleteWeek() {
    setDeleteError(null)
    try {
      await deleteWeek.mutateAsync({ clientId, weekStart: week.weekStart })
      setConfirmDelete(false)
    } catch (err) {
      setDeleteError('Errore: ' + (err.message || 'eliminazione non riuscita'))
    }
  }

  return (
    <div className="card mb-3">
      <div className="flex items-center justify-between gap-4">
        <button className="flex-1 text-left" onClick={() => setOpen(o => !o)}>
          <p className="font-heading font-bold text-white">
            {fmt(week.weekStart, { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">{week.count} foto</p>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-slate-600 hover:text-red-400 transition-colors p-1"
            title="Elimina tutte le foto di questa settimana"
          >
            <Trash2 size={15} />
          </button>
          <button onClick={() => setOpen(o => !o)} className="text-slate-500 hover:text-white transition-colors">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

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

      {confirmDelete && (
        <ConfirmModal
          message="Eliminare tutte le foto di questa settimana?"
          detail={deleteError ?? `Verranno eliminate definitivamente tutte le ${week.count} foto di questa settimana, da database e storage. L'azione è irreversibile.`}
          confirmLabel="ELIMINA"
          isPending={deleteWeek.isPending}
          onConfirm={handleDeleteWeek}
          onCancel={() => { setConfirmDelete(false); setDeleteError(null) }}
        />
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

// ─── Reset password: link generato dal PT, senza email ────────
function ResetPasswordModal({ client, onClose }) {
  const [link, setLink]       = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]   = useState(false)

  async function generate() {
    setError(null)
    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('reset-password', {
        body: { email: client.email, redirect_to: `${APP_URL}/set-password` },
      })
      if (error) {
        let message = error.message
        try {
          const body = await error.context?.json?.()
          if (body?.error) message = body.error
        } catch { /* corpo non leggibile */ }
        throw new Error(message)
      }
      if (data?.error) throw new Error(data.error)
      setLink(data?.link ?? null)
    } catch (err) {
      setError(err.message || 'Errore durante la generazione del link')
    } finally {
      setLoading(false)
    }
  }

  function copyLink() {
    if (!link) return
    navigator.clipboard?.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="font-heading font-bold italic text-xl text-white uppercase tracking-wide mb-2">
          Reset password
        </h3>
        <p className="text-slate-400 text-sm mb-5">
          Genera un link di reset per <span className="text-white">{client.full_name || client.email}</span> e
          inviaglielo su un canale sicuro (es. WhatsApp). Aprendolo potrà impostare una nuova password.
          Il link scade ed è monouso.
        </p>

        {error && <p className="text-red-400 text-sm bg-red-900/20 px-4 py-2.5 mb-4">{error}</p>}

        {link ? (
          <>
            <div className="flex gap-2">
              <input readOnly value={link} className="input flex-1 text-xs" onFocus={e => e.target.select()} />
              <button onClick={copyLink} className="btn-primary px-3 shrink-0" title="Copia link">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <button onClick={onClose} className="btn-ghost text-sm w-full justify-center mt-3">Chiudi</button>
          </>
        ) : (
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost text-sm">Annulla</button>
            <button onClick={generate} disabled={loading} className="btn-primary text-sm disabled:opacity-50">
              {loading ? 'GENERO...' : 'GENERA LINK'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function useDeleteClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (clientId) => {
      const { data, error } = await supabase.functions.invoke('delete-client', {
        body: { client_id: clientId },
      })
      if (error) {
        let message = error.message
        try {
          const body = await error.context?.json?.()
          if (body?.error) message = body.error
        } catch { /* corpo non leggibile */ }
        throw new Error(message)
      }
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['home-kpis'] })
      qc.invalidateQueries({ queryKey: ['expiring-items'] })
    },
  })
}

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

  const pending = client?.questionnaire_pending ?? false
  const [showReset, setShowReset] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const navigate = useNavigate()
  const deleteClient = useDeleteClient()

  async function handleDelete() {
    setDeleteError(null)
    try {
      await deleteClient.mutateAsync(id)
      navigate('/clients', { replace: true })
    } catch (err) {
      setDeleteError('Errore: ' + (err.message || 'eliminazione non riuscita'))
    }
  }

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

        {/* Azioni */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowReset(true)}
            className="btn-ghost text-xs px-3 py-1.5"
            title="Genera un link per reimpostare la password del cliente"
          >
            <KeyRound size={13} /> Reset password
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="btn-ghost text-xs px-3 py-1.5 text-red-400 hover:text-red-300"
            title="Elimina definitivamente il cliente e tutti i suoi dati"
          >
            <Trash2 size={13} /> Elimina
          </button>
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

      {showReset && client && (
        <ResetPasswordModal client={client} onClose={() => setShowReset(false)} />
      )}

      {showDelete && (
        <ConfirmModal
          message="Eliminare questo cliente?"
          detail={deleteError ?? `Verranno eliminati definitivamente ${client?.full_name || 'il cliente'} e tutti i suoi dati: schede, diete, foto e dati giornalieri. L'azione è irreversibile.`}
          confirmLabel="ELIMINA"
          isPending={deleteClient.isPending}
          onConfirm={handleDelete}
          onCancel={() => { setShowDelete(false); setDeleteError(null) }}
        />
      )}

      {/* Scadenze programma e dieta (sola lettura: si modificano dai box sotto) */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <ExpiryCard icon={Dumbbell} type="Programma" item={activeProgram} />
        <ExpiryCard icon={Salad} type="Dieta" item={activeDietInfo} />
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
