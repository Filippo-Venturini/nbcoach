export const SUPERSET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b',
]

export function SupersetPicker({ color, onChange }) {
  const enabled = Boolean(color)

  function toggle() {
    onChange(enabled ? null : SUPERSET_COLORS[0])
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span
        className="text-xs font-heading font-bold uppercase tracking-wider transition-colors"
        style={{ color: enabled ? color : undefined }}
        // quando disabilitato niente inline style => ricade sulla classe sotto
      >
        <span className={enabled ? '' : 'text-slate-300'}>Superserie</span>
      </span>

        <button
            type="button"
            onClick={toggle}
            className={`relative w-9 h-5 shrink-0 rounded-full transition-colors duration-150 ${
                enabled ? '' : 'bg-navy-700'
            }`}
            style={enabled ? { backgroundColor: color } : undefined}
            title="Parte di una superserie/circuito"
            >
            <span
                className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-150"
                style={{ transform: enabled ? 'translateX(16px)' : 'translateX(0)' }}
            />
        </button>

      {enabled && (
        <div className="flex items-center gap-1 ml-0.5">
          {SUPERSET_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className={`w-3.5 h-3.5 shrink-0 rounded transition-transform ${
                color === c ? 'scale-125 ring-1 ring-white' : ''
              }`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function supersetCardStyle(color) {
  if (!color) return {}
  return { backgroundColor: `${color}26`, borderLeft: `3px solid ${color}` }
}