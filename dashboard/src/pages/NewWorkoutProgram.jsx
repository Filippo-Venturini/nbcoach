import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, Search, X, ChevronDown, ChevronUp, GripVertical, Copy, ClipboardPaste, Check } from 'lucide-react'
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
import { supabase } from '../lib/supabase'
import { ConfirmModal } from '../components/ConfirmModal'
import { SupersetPicker, supersetCardStyle } from '../components/SupersetPicker'

// ─── Hooks ────────────────────────────────────────────────────

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

// Recupera l'ultimo programma del cliente per precompilare il nuovo
function useLastProgram(clientId) {
  return useQuery({
    queryKey: ['last-program', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workout_programs')
        .select(`
          notes,
          stimulus_matrix,
          volume_targets,
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
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!data) return null

      const plans = [...(data.workout_plans ?? [])]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(plan => ({
          ...plan,
          workout_exercises: [...(plan.workout_exercises ?? [])].sort((a, b) => a.order_index - b.order_index),
        }))

      return {
        notes: data.notes ?? '',
        stimulus_matrix: data.stimulus_matrix ?? {},
        volume_targets: data.volume_targets ?? {},
        plans,
      }
    },
    enabled: !!clientId,
    refetchOnMount: 'always',
  })
}

function useClient(id) {
  return useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
  })
}

function useSaveProgram() {
  const qc = useQueryClient()
  return useMutation({
    // NB: non disattiviamo più gli altri programmi del cliente prima di
    // inserire: ora un cliente può avere più programmi "attivi" e "futuri"
    // contemporaneamente. Lo stato (attivo/futuro/storico) viene calcolato
    // a runtime dalle date (vedi getStatus in ClientDetail.jsx), non da
    // un flag salvato in DB.
    mutationFn: async ({ clientId, programName, programNotes, programStart, programExpiry, stimulusMatrix, volumeTargets, plans, planVolumeTargets }) => {
      const { data: program, error: progError } = await supabase
        .from('workout_programs')
        .insert({
          client_id: clientId,
          name: programName || null,
          notes: programNotes || null,
          starts_at: programStart || null,
          expires_at: programExpiry || null,
          stimulus_matrix: stimulusMatrix ?? {},
          volume_targets: volumeTargets ?? {},
          is_active: true,
        })
        .select().single()
      if (progError) throw progError

      for (const plan of plans) {
        const { data: savedPlan, error: planError } = await supabase
          .from('workout_plans')
          .insert({
            client_id: clientId,
            program_id: program.id,
            name: plan.name,
            is_active: true,
            volume_targets: cleanVolumeTargets(planVolumeTargets?.[plan.id]),
          })
          .select().single()
        if (planError) throw planError

        if (plan.exercises.length > 0) {
          const rows = plan.exercises.map((ex, i) => ({
            plan_id: savedPlan.id,
            exercise_id: ex.exercise_id,
            sets: ex.sets ? parseInt(ex.sets) : null,
            reps: ex.reps || null,
            carico: ex.carico || null,
            rest: ex.rest?.trim() || null,
            cadenza: ex.cadenza || null,
            notes: ex.notes || null,
            superset_color: ex.superset_color || null,
            order_index: i,
          }))
          const { error: exError } = await supabase.from('workout_exercises').insert(rows)
          if (exError) throw exError
        }
      }
      return program
    },
    onSuccess: (_, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['workout-programs', clientId] })
      qc.invalidateQueries({ queryKey: ['last-program', clientId] })
      qc.invalidateQueries({ queryKey: ['active-program', clientId] })
      qc.invalidateQueries({ queryKey: ['expiring-items'] })
    },
  })
}

// ─── Componente esercizio sortable ────────────────────────────

function SortableExerciseRow({ ex, onUpdate, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ex.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
    ...supersetCardStyle(ex.superset_color),
  }

  return (
    <div ref={setNodeRef} style={style} className="bg-navy-900 border border-navy-700 p-3">
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
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{ex.name}</p>
            {ex.muscle_group && <p className="text-slate-500 text-xs">{ex.muscle_group}</p>}
          </div>
        </div>
        <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5 mb-1.5">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Serie</label>
          <input className="input text-xs py-1" value={ex.sets} onChange={e => onUpdate('sets', e.target.value)} placeholder="4" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Reps</label>
          <input className="input text-xs py-1" value={ex.reps} onChange={e => onUpdate('reps', e.target.value)} placeholder="8-10" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Carico</label>
          <input className="input text-xs py-1" value={ex.carico} onChange={e => onUpdate('carico', e.target.value)} placeholder="80kg" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Riposo (min)</label>
          <input className="input text-xs py-1" value={ex.rest} onChange={e => onUpdate('rest', e.target.value)} placeholder="1:30" />
        </div>
      </div>
      <input className="input text-xs py-1 mb-1.5" value={ex.cadenza} onChange={e => onUpdate('cadenza', e.target.value)} placeholder="Cadenza (opzionale)" />
      <input className="input text-xs py-1" value={ex.notes} onChange={e => onUpdate('notes', e.target.value)} placeholder="Note esercizio (opzionale)" />

      <div className="mt-2">
        <SupersetPicker color={ex.superset_color} onChange={val => onUpdate('superset_color', val)} />
      </div>
    </div>
  )
}

// ─── Catalogo laterale ────────────────────────────────────────

const MUSCLE_GROUPS = [
  'Tutti', 'Petto', 'Centro Schiena', 'Dorsale', 'Spalle', 'Spalla Posteriore', 'Bicipiti',
  'Tricipiti', 'Quadricipiti', 'Femorali', 'Glutei', 'Addome', 'Stabilizzatori',
]

// Gruppi muscolari per la matrice degli stimoli (tutti quelli registrati, senza "Tutti")
const STIMULUS_GROUPS = MUSCLE_GROUPS.filter(g => g !== 'Tutti')

// Gruppi muscolari del planner di volume: stesso elenco e stesso ordine anatomico
// della matrice degli stimoli (petto → schiena → spalle → braccia → gambe → core)
const VOLUME_GROUPS = STIMULUS_GROUPS

// Colonne della matrice degli stimoli
const STIMULUS_COLS = [
  { col: 'prev', label: 'Stimolo precedente' },
  { col: 'current', label: 'Stimolo attuale' },
  { col: 'next', label: 'Stimolo successivo' },
]

function CatalogPanel({ plans, activePlanIdx, onAddExercise }) {
  const { data: catalog } = useCatalog()
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('Tutti')

  const filtered = catalog?.filter(ex => {
    const matchSearch = ex.name.toLowerCase().includes(search.toLowerCase())
    const matchGroup = group === 'Tutti' || ex.muscle_group === group
    return matchSearch && matchGroup
  })

  const activePlan = plans[activePlanIdx]

  return (
    <div className="flex flex-col h-full">
      <div className="mb-3">
        <p className="text-xs font-heading font-bold uppercase tracking-wider text-gold-500 mb-2">
          Aggiungi a: {activePlan?.name || `Scheda ${activePlanIdx + 1}`}
        </p>
        <div className="relative mb-2">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-8 text-sm py-2" placeholder="Cerca..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input text-sm py-2" value={group} onChange={e => setGroup(e.target.value)}>
          {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className="overflow-y-auto flex-1 space-y-1 pr-0.5">
        {filtered?.map(ex => (
            <button
              key={ex.id}
              onClick={() => onAddExercise(ex)}
              className="w-full text-left px-3 py-2 border transition-colors bg-navy-800 border-navy-700 hover:border-gold-500/50 cursor-pointer"
            >
              <p className="text-white text-xs font-medium">{ex.name}</p>
              {ex.muscle_group && <p className="text-slate-500 text-xs">{ex.muscle_group}</p>}
            </button>
          ))}
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
    const mg = ex.muscle_group
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
    <div className="flex flex-wrap items-center gap-2">
      {entries.map(([mg, count]) => (
        <span key={mg} className="flex items-center gap-1.5 bg-navy-900 border border-navy-700 px-2 py-1 text-xs">
          <span className="text-slate-300">{mg}</span>
          <span className="text-gold-500 font-bold">{count}</span>
        </span>
      ))}
      <span className="flex items-center gap-1.5 bg-gold-500/10 border border-gold-500/40 px-2 py-1 text-xs">
        <span className="text-gold-300 uppercase tracking-wider">Totale</span>
        <span className="text-gold-400 font-bold">{total}</span>
      </span>
    </div>
  )
}

function VolumeMuscleGrid({ counts, targets, onSetTarget, onRemoveTarget }) {
  const editable = Boolean(onSetTarget)
  const rows = volumeRowGroups(counts, targets ?? {})

  return (
    <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
      {rows.map(mg => {
        const actual = counts[mg] ?? 0
        const raw = targets?.[mg] ?? ''
        const target = setsCount(raw)
        const pct = target ? Math.min(100, Math.round((actual / target) * 100)) : 0
        return (
          <div key={mg} className="bg-navy-900 border border-navy-700 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-300 text-xs truncate" title={mg}>{mg}</span>
              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-sm font-bold tabular-nums ${editable ? volumeTone(actual, target) : 'text-slate-300'}`}>{actual}</span>
                {editable && (
                  <>
                    <span className="text-slate-600 text-xs">/</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={3}
                      className="input text-xs py-0.5 px-1 w-12 text-center"
                      placeholder="–"
                      value={raw}
                      onFocus={e => e.target.select()}
                      onChange={e => onSetTarget(mg, e.target.value.replace(/\D/g, ''))}
                    />
                    {raw !== '' && (
                      <button
                        type="button"
                        onClick={() => onRemoveTarget(mg)}
                        title="Azzera obiettivo"
                        className="text-slate-600 hover:text-red-400 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            {editable && target > 0 && (
              <div className="mt-1.5 h-1 bg-navy-800">
                <div
                  className={`h-full transition-all ${actual > target ? 'bg-red-400' : actual === target ? 'bg-green-400' : 'bg-gold-500'}`}
                  style={{ width: `${actual > target ? 100 : pct}%` }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Tutti i gruppi muscolari, in ordine anatomico (upper push → schiena → spalle → braccia → gambe → core),
// più eventuali gruppi presenti negli esercizi ma non censiti in elenco
function volumeRowGroups(counts, targets) {
  const extra = [...new Set([...Object.keys(counts), ...Object.keys(targets ?? {})])]
    .filter(mg => !VOLUME_GROUPS.includes(mg))
    .sort((a, b) => a.localeCompare(b, 'it'))
  return [...VOLUME_GROUPS, ...extra]
}

// Colore del contatore in base al rapporto effettivo/pianificato
function volumeTone(actual, target) {
  if (!target) return 'text-slate-300'
  if (actual > target) return 'text-red-400'
  if (actual === target) return 'text-green-400'
  return 'text-gold-500'
}

function ProgramVolumePlanner({ plans, targets, onSetTarget, onRemoveTarget }) {
  const counts = countsFromExercises(plans.flatMap(p => p.exercises ?? []))
  const totalActual = Object.values(counts).reduce((s, n) => s + n, 0)
  const totalTarget = Object.values(targets).reduce((s, v) => s + setsCount(v), 0)

  return (
    <div className="mb-4 bg-navy-800 border border-navy-700 p-4">
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-xs font-heading uppercase tracking-wider text-slate-500">Volume programma</p>
        <span className="flex items-center gap-1.5 bg-gold-500/10 border border-gold-500/40 px-2 py-1 text-xs">
          <span className="text-gold-300 uppercase tracking-wider">Totale</span>
          <span className={`font-bold tabular-nums ${volumeTone(totalActual, totalTarget)}`}>{totalActual}</span>
          <span className="text-gold-500/50">/</span>
          <span className="text-gold-400 font-bold tabular-nums">{totalTarget || '–'}</span>
        </span>
      </div>
      <VolumeMuscleGrid counts={counts} targets={targets} onSetTarget={onSetTarget} onRemoveTarget={onRemoveTarget} />
    </div>
  )
}

function PlanVolumeCounter({ plan, targets, onSetTarget, onRemoveTarget }) {
  const counts = countsFromExercises(plan.exercises)
  const totalActual = Object.values(counts).reduce((s, n) => s + n, 0)
  const totalTarget = Object.values(targets).reduce((s, v) => s + setsCount(v), 0)

  return (
    <div className="mb-3 pb-3 border-b border-navy-700">
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-xs font-heading uppercase tracking-wider text-slate-500">Volume scheda</p>
        <span className="flex items-center gap-1.5 bg-gold-500/10 border border-gold-500/40 px-2 py-1 text-xs">
          <span className="text-gold-300 uppercase tracking-wider">Totale</span>
          <span className={`font-bold tabular-nums ${volumeTone(totalActual, totalTarget)}`}>{totalActual}</span>
          <span className="text-gold-500/50">/</span>
          <span className="text-gold-400 font-bold tabular-nums">{totalTarget || '–'}</span>
        </span>
      </div>
      <VolumeMuscleGrid counts={counts} targets={targets} onSetTarget={onSetTarget} onRemoveTarget={onRemoveTarget} />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────

function makeEmptyExercise(catalogItem) {
  return {
    id: crypto.randomUUID(),
    exercise_id: catalogItem.id,
    name: catalogItem.name,
    muscle_group: catalogItem.muscle_group,
    youtube_id: catalogItem.youtube_id,
    sets: '',
    reps: '',
    carico: '',
    rest: '',
    cadenza: '',
    notes: '',
    superset_color: null,
  }
}

function makeEmptyPlan(label) {
  return { id: crypto.randomUUID(), name: label, exercises: [] }
}

function mapDbExerciseToDraft(ex) {
  const cat = ex.exercises_catalog ?? {}
  return {
    id: crypto.randomUUID(),
    exercise_id: ex.exercise_id,
    name: cat.name ?? '',
    muscle_group: cat.muscle_group ?? '',
    youtube_id: cat.youtube_id ?? '',
    sets: ex.sets != null ? String(ex.sets) : '',
    reps: ex.reps ?? '',
    carico: ex.carico ?? '',
    rest: ex.rest ?? '',
    cadenza: ex.cadenza ?? '',
    notes: ex.notes ?? '',
    superset_color: ex.superset_color ?? null,
  }
}

function mapDbPlanToDraft(plan) {
  return {
    id: crypto.randomUUID(),
    name: plan.name ?? '',
    exercises: (plan.workout_exercises ?? []).map(mapDbExerciseToDraft),
  }
}

function mapVolumeTargetsToDraft(targets) {
  const out = {}
  for (const [mg, value] of Object.entries(targets ?? {})) {
    if (value != null && value !== '') out[mg] = String(value)
  }
  return out
}

// Converte i target di volume (stringhe dagli input) in numeri, scartando i valori vuoti/non validi
function cleanVolumeTargets(targets) {
  const out = {}
  for (const [mg, value] of Object.entries(targets ?? {})) {
    const n = setsCount(value)
    if (n > 0) out[mg] = n
  }
  return out
}

// ─── Pagina principale ─────────────────────────────────────────

export function NewWorkoutProgram() {
  const { id: clientId } = useParams()
  const navigate = useNavigate()
  const { data: client } = useClient(clientId)
  const { data: lastProgram, isFetching: lastProgramFetching } = useLastProgram(clientId)
  const saveProgram = useSaveProgram()

  const [programName, setProgramName] = useState('')
  const [programNotes, setProgramNotes] = useState('')
  const [programStart, setProgramStart] = useState('')
  const [programExpiry, setProgramExpiry] = useState('')
  const [stimuli, setStimuli] = useState({})
  const [previousProgramSeeded, setPreviousProgramSeeded] = useState(false)
  // Volume pianificato dal PT per gruppo muscolare (valori come stringhe, per input controllati)
  const [volumeTargets, setVolumeTargets] = useState({})
  // Volume pianificato dal PT per gruppo muscolare, PER SCHEDA (chiave = plan.id)
  const [planVolumeTargets, setPlanVolumeTargets] = useState({})
  const [copiedCol, setCopiedCol] = useState(null)
  const [plans, setPlans] = useState([makeEmptyPlan('Scheda A')])
  const [activePlanIdx, setActivePlanIdx] = useState(0)
  const [expandedPlans, setExpandedPlans] = useState({ 0: true })
  const [error, setError] = useState(null)
  const [deletePlanTarget, setDeletePlanTarget] = useState(null)

  // Precompila dal programma più recente del cliente (una sola volta, dopo fetch fresco)
  useEffect(() => {
    if (previousProgramSeeded || lastProgramFetching) return
    if (lastProgram) {
      setProgramNotes(lastProgram.notes)
      setStimuli(lastProgram.stimulus_matrix)
      setVolumeTargets(mapVolumeTargetsToDraft(lastProgram.volume_targets))
      const draftPlans = lastProgram.plans.map(mapDbPlanToDraft)
      if (draftPlans.length > 0) {
        setPlans(draftPlans)
        setExpandedPlans(Object.fromEntries(draftPlans.map((_, i) => [i, true])))
        setActivePlanIdx(0)
        setPlanVolumeTargets(Object.fromEntries(
          draftPlans.map((draftPlan, i) => [draftPlan.id, mapVolumeTargetsToDraft(lastProgram.plans[i].volume_targets)])
        ))
      }
    }
    setPreviousProgramSeeded(true)
  }, [lastProgram, lastProgramFetching, previousProgramSeeded])

  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: 5 }, // evita attivazione su click normali
  }))

  function updateStimulus(group, col, value) {
    setStimuli(prev => ({ ...prev, [group]: { ...prev[group], [col]: value } }))
  }

  function setVolumeTarget(group, value) {
    setVolumeTargets(prev => ({ ...prev, [group]: value }))
  }

  function removeVolumeTarget(group) {
    setVolumeTargets(prev => {
      const next = { ...prev }
      delete next[group]
      return next
    })
  }

    function setPlanVolumeTarget(planId, group, value) {
    setPlanVolumeTargets(prev => ({
      ...prev,
      [planId]: { ...prev[planId], [group]: value },
    }))
  }

  function removePlanVolumeTarget(planId, group) {
    setPlanVolumeTargets(prev => {
      const planTargets = { ...(prev[planId] ?? {}) }
      delete planTargets[group]
      return { ...prev, [planId]: planTargets }
    })
  }

  // Copia l'intera colonna negli appunti (una riga per gruppo muscolare, in ordine)
  function copyColumn(col) {
    const text = STIMULUS_GROUPS.map(mg => stimuli[mg]?.[col] ?? '').join('\n')
    navigator.clipboard?.writeText(text)
      .then(() => {
        setCopiedCol(col)
        setTimeout(() => setCopiedCol(c => (c === col ? null : c)), 1500)
      })
      .catch(() => {})
  }

  // Incolla dagli appunti riempiendo la colonna riga per riga (nell'ordine dei gruppi)
  async function pasteColumn(col) {
    try {
      const text = await navigator.clipboard.readText()
      const lines = text.split(/\r?\n/)
      setStimuli(prev => {
        const next = { ...prev }
        lines.forEach((line, i) => {
          const mg = STIMULUS_GROUPS[i]
          if (mg) next[mg] = { ...next[mg], [col]: line }
        })
        return next
      })
    } catch { /* clipboard non disponibile o permesso negato */ }
  }

  function addPlan() {
    const labels = ['Scheda A', 'Scheda B', 'Scheda C', 'Scheda D', 'Scheda E']
    const newIdx = plans.length
    setPlans(prev => [...prev, makeEmptyPlan(labels[newIdx] ?? `Scheda ${newIdx + 1}`)])
    setActivePlanIdx(newIdx)
    setExpandedPlans(prev => ({ ...prev, [newIdx]: true }))
  }

  function removePlan(idx) {
    setPlans(prev => prev.filter((_, i) => i !== idx))
    setActivePlanIdx(prev => Math.max(0, idx === 0 ? 0 : prev >= idx ? prev - 1 : prev))
  }

  function updatePlanName(idx, name) {
    setPlans(prev => prev.map((p, i) => i === idx ? { ...p, name } : p))
  }

  function addExercise(catalogItem) {
    setPlans(prev => prev.map((p, i) =>
      i === activePlanIdx
        ? { ...p, exercises: [...p.exercises, makeEmptyExercise(catalogItem)] }
        : p
    ))
  }

  function removeExercise(planIdx, instanceId) {
    setPlans(prev => prev.map((p, i) =>
      i === planIdx ? { ...p, exercises: p.exercises.filter(e => e.id !== instanceId) } : p
    ))
  }

  function updateExercise(planIdx, instanceId, field, value) {
    setPlans(prev => prev.map((p, i) =>
      i === planIdx
        ? { ...p, exercises: p.exercises.map(e => e.id === instanceId ? { ...e, [field]: value } : e) }
        : p
    ))
  }

  function handleDragEnd(event, planIdx) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setPlans(prev => prev.map((p, i) => {
      if (i !== planIdx) return p
      const oldIndex = p.exercises.findIndex(e => e.id === active.id)
      const newIndex = p.exercises.findIndex(e => e.id === over.id)
      return { ...p, exercises: arrayMove(p.exercises, oldIndex, newIndex) }
    }))
  }

  async function handleSave() {
    if (!programName.trim()) { setError('Dai un nome al programma'); return }
    if (programStart && programExpiry && programStart > programExpiry) {
      setError('La data di inizio deve precedere la scadenza')
      return
    }
    if (plans.some(p => !p.name.trim())) { setError('Dai un nome a ogni scheda'); return }
    if (plans.every(p => p.exercises.length === 0)) { setError('Aggiungi almeno un esercizio'); return }
    setError(null)
    try {
      await saveProgram.mutateAsync({ clientId, programName, programNotes, programStart, programExpiry, stimulusMatrix: stimuli, volumeTargets: cleanVolumeTargets(volumeTargets), plans, planVolumeTargets })
      navigate(`/clients/${clientId}?tab=scheda`)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-navy-700 bg-navy-950 shrink-0">
        <div className="flex items-center gap-5">
          <Link to={`/clients/${clientId}?tab=scheda`} className="btn-ghost text-sm -ml-2 shrink-0">
            <ArrowLeft size={15} />
            {client?.full_name ?? 'Cliente'}
          </Link>
          <div className="border-l border-navy-700 pl-5 flex items-end gap-6">
            <div>
              <p className="text-xs font-heading uppercase tracking-wider text-slate-500 mb-0.5">Nome programma</p>
              <input
                className={`bg-transparent text-white font-heading font-bold italic text-xl uppercase border-0 border-b focus:outline-none px-0 w-64 placeholder-navy-600 transition-colors ${error === 'Dai un nome al programma' && !programName.trim() ? 'border-red-500' : 'border-navy-600 focus:border-gold-500'}`}
                placeholder="ES. FORZA FASE 1, RECOMP..."
                value={programName}
                onChange={e => setProgramName(e.target.value)}
              />
            </div>
            <div>
              <p className="text-xs font-heading uppercase tracking-wider text-slate-500 mb-0.5">Data inizio <span className="text-navy-500 normal-case tracking-normal">(opzionale)</span></p>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="bg-transparent text-white border-0 border-b border-navy-600 focus:border-gold-500 focus:outline-none px-0 text-sm transition-colors"
                  style={{ colorScheme: 'dark' }}
                  value={programStart}
                  onChange={e => setProgramStart(e.target.value)}
                />
                {programStart && (
                  <button
                    type="button"
                    onClick={() => setProgramStart('')}
                    className="text-slate-600 hover:text-red-400 transition-colors shrink-0"
                    title="Rimuovi data inizio"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-heading uppercase tracking-wider text-slate-500 mb-0.5">Scadenza <span className="text-navy-500 normal-case tracking-normal">(opzionale)</span></p>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="bg-transparent text-white border-0 border-b border-navy-600 focus:border-gold-500 focus:outline-none px-0 text-sm transition-colors"
                  style={{ colorScheme: 'dark' }}
                  min={programStart || new Date().toISOString().split('T')[0]}
                  value={programExpiry}
                  onChange={e => setProgramExpiry(e.target.value)}
                />
                {programExpiry && (
                  <button
                    type="button"
                    onClick={() => setProgramExpiry('')}
                    className="text-slate-600 hover:text-red-400 transition-colors shrink-0"
                    title="Rimuovi scadenza"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button onClick={handleSave} disabled={saveProgram.isPending} className="btn-primary disabled:opacity-50">
            {saveProgram.isPending ? 'SALVATAGGIO...' : 'SALVA PROGRAMMA'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: plans */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-4 bg-navy-800 border border-navy-700 p-4">
            <p className="text-xs font-heading uppercase tracking-wider text-slate-500 mb-2">Note programma</p>
            <textarea
              className="input w-full text-sm resize-none"
              rows={3}
              placeholder="Note generali sul programma"
              value={programNotes}
              onChange={e => setProgramNotes(e.target.value)}
            />
          </div>

          {/* Matrice tipologia di stimolo per gruppo muscolare */}
          <div className="mb-4 bg-navy-800 border border-navy-700 p-4">
            <p className="text-xs font-heading uppercase tracking-wider text-slate-500 mb-3">Stimolo per gruppo muscolare</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-navy-700">
                    <th className="pb-2 pr-3 w-40"></th>
                    {STIMULUS_COLS.map(({ col, label }) => (
                      <th key={col} className="text-left text-xs font-heading uppercase tracking-wider text-slate-500 font-bold pb-2 px-1 align-bottom">
                        <div className="flex items-end justify-between gap-2">
                          <span>{label}</span>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => copyColumn(col)}
                              title="Copia colonna"
                              className="text-slate-500 hover:text-gold-400 transition-colors p-0.5"
                            >
                              {copiedCol === col ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => pasteColumn(col)}
                              title="Incolla nella colonna"
                              className="text-slate-500 hover:text-gold-400 transition-colors p-0.5"
                            >
                              <ClipboardPaste size={13} />
                            </button>
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STIMULUS_GROUPS.map(mg => (
                    <tr key={mg} className="border-b border-navy-900/60 last:border-0">
                      <td className="py-1.5 pr-3 text-slate-300 whitespace-nowrap align-middle">{mg}</td>
                      {STIMULUS_COLS.map(({ col }) => (
                        <td key={col} className="py-1.5 px-1">
                          <input
                            className="input text-xs py-1"
                            value={stimuli[mg]?.[col] ?? ''}
                            onChange={e => updateStimulus(mg, col, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Volume programma: pianificazione PT + contatori dinamici */}
          <ProgramVolumePlanner
            plans={plans}
            targets={volumeTargets}
            onSetTarget={setVolumeTarget}
            onRemoveTarget={removeVolumeTarget}
          />

          <div className="space-y-3">
            {plans.map((plan, planIdx) => {
              const isActive = activePlanIdx === planIdx
              const isExpanded = expandedPlans[planIdx]
              return (
                <div
                  key={plan.id}
                  className={`border transition-colors ${isActive ? 'border-gold-500/50 bg-navy-800' : 'border-navy-700 bg-navy-800 hover:border-navy-600'}`}
                >
                  {/* Plan header — click ovunque per aprire/chiudere */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer"
                    onClick={() => {
                      setActivePlanIdx(planIdx)
                      setExpandedPlans(prev => ({ ...prev, [planIdx]: !prev[planIdx] }))
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full shrink-0 transition-colors ${isActive ? 'bg-gold-500' : 'bg-navy-600'}`} />
                      <input
                        className="bg-transparent font-heading font-bold italic text-lg text-white uppercase border-0 focus:outline-none w-48"
                        value={plan.name}
                        onChange={e => updatePlanName(planIdx, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="Nome scheda"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      {plans.length > 1 && (
                        <button
                          onClick={e => { e.stopPropagation(); setDeletePlanTarget(planIdx) }}
                          className="text-slate-600 hover:text-red-400 transition-colors p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setActivePlanIdx(planIdx)
                          setExpandedPlans(prev => ({ ...prev, [planIdx]: !prev[planIdx] }))
                        }}
                        className="text-slate-500 hover:text-white transition-colors p-1"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Plan exercises con DnD */}
                  {isExpanded && (
                    <div className="px-4 pb-4" onClick={e => e.stopPropagation()}>
                      <PlanVolumeCounter
                        plan={plan}
                        targets={planVolumeTargets[plan.id] ?? {}}
                        onSetTarget={(mg, val) => setPlanVolumeTarget(plan.id, mg, val)}
                        onRemoveTarget={mg => removePlanVolumeTarget(plan.id, mg)}
                      />
                      {plan.exercises.length === 0 && (
                        <p className="text-slate-500 text-sm py-3 text-center">
                          Aggiungi esercizi dal catalogo
                        </p>
                      )}
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={e => handleDragEnd(e, planIdx)}
                      >
                        <SortableContext
                          items={plan.exercises.map(e => e.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-2">
                            {plan.exercises.map(ex => (
                              <SortableExerciseRow
                                key={ex.id}
                                ex={ex}
                                onUpdate={(field, val) => updateExercise(planIdx, ex.id, field, val)}
                                onRemove={() => removeExercise(planIdx, ex.id)}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {plans.length < 5 && (
            <button onClick={addPlan} className="btn-ghost mt-4 text-sm">
              <Plus size={14} />
              Aggiungi scheda
            </button>
          )}

        </div>

        {/* Right: catalog */}
        <div className="w-72 shrink-0 border-l border-navy-700 bg-navy-950 p-4 overflow-hidden flex flex-col">
          <CatalogPanel
            plans={plans}
            activePlanIdx={activePlanIdx}
            onAddExercise={addExercise}
          />
        </div>
      </div>

      {deletePlanTarget !== null && (
        <ConfirmModal
          message="Eliminare scheda?"
          detail={`"${plans[deletePlanTarget]?.name}" e tutti i suoi esercizi verranno rimossi.`}
          onConfirm={() => { removePlan(deletePlanTarget); setDeletePlanTarget(null) }}
          onCancel={() => setDeletePlanTarget(null)}
        />
      )}
    </div>
  )
}
