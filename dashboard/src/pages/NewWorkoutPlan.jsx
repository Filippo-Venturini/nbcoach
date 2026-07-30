import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, Search, GripVertical } from 'lucide-react'
import { supabase } from '../lib/supabase'

function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exercises_catalog')
        .select('*')
        .order('muscle_group')
        .order('name')
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
        .from('profiles')
        .select('id, full_name, email')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
  })
}

function useSaveWorkoutPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, name, notes, exercises }) => {
      // Disattiva le schede precedenti
      await supabase
        .from('workout_plans')
        .update({ is_active: false })
        .eq('client_id', clientId)

      // Crea la nuova scheda
      const { data: plan, error: planError } = await supabase
        .from('workout_plans')
        .insert({ client_id: clientId, name, notes, is_active: true })
        .select()
        .single()
      if (planError) throw planError

      // Inserisci gli esercizi
      if (exercises.length > 0) {
        const rows = exercises.map((ex, i) => ({
          plan_id: plan.id,
          exercise_id: ex.exercise_id,
          sets: ex.sets ? parseInt(ex.sets) : null,
          reps: ex.reps || null,
          rest: ex.rest?.trim() || null,
          notes: ex.notes || null,
          order_index: i,
        }))
        const { error: exError } = await supabase.from('workout_exercises').insert(rows)
        if (exError) throw exError
      }

      return plan
    },
    onSuccess: (plan, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['workout-plans', clientId] })
    },
  })
}

const MUSCLE_GROUPS = [
  'Tutti', 'Petto', 'Schiena', 'Spalle', 'Bicipiti', 'Tricipiti',
  'Addominali', 'Quadricipiti', 'Femorali', 'Glutei', 'Polpacci', 'Tutto il corpo',
]

export function NewWorkoutPlan() {
  const { id: clientId } = useParams()
  const navigate = useNavigate()
  const { data: client } = useClient(clientId)
  const { data: catalog } = useCatalog()
  const savePlan = useSaveWorkoutPlan()

  const [planName, setPlanName] = useState('')
  const [planNotes, setPlanNotes] = useState('')
  const [exercises, setExercises] = useState([]) // esercizi aggiunti alla scheda
  const [search, setSearch] = useState('')
  const [filterGroup, setFilterGroup] = useState('Tutti')
  const [error, setError] = useState(null)

  const filteredCatalog = catalog?.filter(ex => {
    const matchSearch = ex.name.toLowerCase().includes(search.toLowerCase())
    const matchGroup = filterGroup === 'Tutti' || ex.muscle_group === filterGroup
    return matchSearch && matchGroup
  })

  function addExercise(catalogItem) {
    // Evita duplicati
    if (exercises.find(e => e.exercise_id === catalogItem.id)) return
    setExercises(prev => [...prev, {
      exercise_id: catalogItem.id,
      name: catalogItem.name,
      muscle_group: catalogItem.muscle_group,
      youtube_id: catalogItem.youtube_id,
      sets: '4',
      reps: '10',
      rest: '1:30',
      notes: '',
    }])
  }

  function removeExercise(exerciseId) {
    setExercises(prev => prev.filter(e => e.exercise_id !== exerciseId))
  }

  function updateExercise(exerciseId, field, value) {
    setExercises(prev => prev.map(e =>
      e.exercise_id === exerciseId ? { ...e, [field]: value } : e
    ))
  }

  function moveExercise(index, direction) {
    const newList = [...exercises]
    const swapIndex = index + direction
    if (swapIndex < 0 || swapIndex >= newList.length) return
    ;[newList[index], newList[swapIndex]] = [newList[swapIndex], newList[index]]
    setExercises(newList)
  }

  async function handleSave() {
    if (!planName.trim()) { setError('Inserisci un nome per la scheda'); return }
    if (exercises.length === 0) { setError('Aggiungi almeno un esercizio'); return }
    setError(null)
    try {
      await savePlan.mutateAsync({ clientId, name: planName, notes: planNotes, exercises })
      navigate(`/clients/${clientId}?tab=scheda`)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <Link to={`/clients/${clientId}?tab=scheda`} className="btn-ghost mb-6 -ml-2 text-sm">
        <ArrowLeft size={15} />
        Torna a {client?.full_name ?? 'cliente'}
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-heading font-bold italic text-4xl text-white uppercase">
            Nuova scheda
          </h1>
          {client && (
            <p className="text-slate-400 mt-1">per {client.full_name}</p>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={savePlan.isPending}
          className="btn-primary disabled:opacity-50"
        >
          {savePlan.isPending ? 'SALVATAGGIO...' : 'SALVA SCHEDA'}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm bg-red-900/20 px-4 py-3 mb-6">{error}</p>
      )}

      {/* Nome e note scheda */}
      <div className="card mb-6 space-y-4">
        <div>
          <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-400 mb-1.5">
            Nome scheda *
          </label>
          <input
            className="input"
            placeholder="es. Forza — Fase 1, Push/Pull/Legs..."
            value={planName}
            onChange={e => setPlanName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-400 mb-1.5">
            Note generali (opzionale)
          </label>
          <textarea
            className="input resize-none"
            rows={2}
            placeholder="Istruzioni, frequenza settimanale..."
            value={planNotes}
            onChange={e => setPlanNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Colonna sinistra: catalogo */}
        <div>
          <h2 className="font-heading font-bold italic text-xl uppercase text-white mb-4">
            Catalogo esercizi
          </h2>

          {/* Filtri */}
          <div className="space-y-2 mb-4">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9"
                placeholder="Cerca..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select
              className="input"
              value={filterGroup}
              onChange={e => setFilterGroup(e.target.value)}
            >
              {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {/* Lista esercizi */}
          <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
            {filteredCatalog?.map(ex => {
              const already = exercises.some(e => e.exercise_id === ex.id)
              return (
                <button
                  key={ex.id}
                  onClick={() => addExercise(ex)}
                  disabled={already}
                  className={`w-full text-left px-4 py-3 border transition-colors
                    ${already
                      ? 'bg-navy-700 border-navy-600 opacity-40 cursor-not-allowed'
                      : 'bg-navy-800 border-navy-700 hover:border-gold-500/50 hover:bg-navy-700 cursor-pointer'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-medium">{ex.name}</p>
                      {ex.muscle_group && (
                        <p className="text-slate-500 text-xs mt-0.5">{ex.muscle_group}</p>
                      )}
                    </div>
                    {!already && (
                      <Plus size={14} className="text-gold-500 shrink-0 ml-2" />
                    )}
                  </div>
                </button>
              )
            })}
            {filteredCatalog?.length === 0 && (
              <p className="text-slate-500 text-sm px-4 py-3">Nessun esercizio trovato</p>
            )}
          </div>
        </div>

        {/* Colonna destra: scheda in costruzione */}
        <div>
          <h2 className="font-heading font-bold italic text-xl uppercase text-white mb-4">
            Scheda ({exercises.length} esercizi)
          </h2>

          {exercises.length === 0 && (
            <div className="card text-center py-10 text-slate-500">
              Aggiungi esercizi dal catalogo →
            </div>
          )}

          <div className="space-y-2">
            {exercises.map((ex, index) => (
              <div key={ex.exercise_id} className="card border-navy-600">
                {/* Header esercizio */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveExercise(index, -1)}
                        disabled={index === 0}
                        className="text-slate-600 hover:text-slate-400 disabled:opacity-20 text-xs leading-none"
                      >▲</button>
                      <button
                        onClick={() => moveExercise(index, 1)}
                        disabled={index === exercises.length - 1}
                        className="text-slate-600 hover:text-slate-400 disabled:opacity-20 text-xs leading-none"
                      >▼</button>
                    </div>
                    <div>
                      <p className="font-heading font-bold text-white text-sm">{ex.name}</p>
                      {ex.muscle_group && (
                        <p className="text-slate-500 text-xs">{ex.muscle_group}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeExercise(ex.exercise_id)}
                    className="text-slate-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Parametri */}
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Serie</label>
                    <input
                      className="input text-sm py-1.5"
                      value={ex.sets}
                      onChange={e => updateExercise(ex.exercise_id, 'sets', e.target.value)}
                      placeholder="4"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Reps</label>
                    <input
                      className="input text-sm py-1.5"
                      value={ex.reps}
                      onChange={e => updateExercise(ex.exercise_id, 'reps', e.target.value)}
                      placeholder="8-10"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Riposo (min)</label>
                    <input
                      className="input text-sm py-1.5"
                      value={ex.rest}
                      onChange={e => updateExercise(ex.exercise_id, 'rest', e.target.value)}
                      placeholder="1:30"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Note esercizio</label>
                  <input
                    className="input text-sm py-1.5"
                    value={ex.notes}
                    onChange={e => updateExercise(ex.exercise_id, 'notes', e.target.value)}
                    placeholder="Esecuzione, varianti..."
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
