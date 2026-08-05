import { useState } from 'react'

// Syllabus progress checklist. Chapters are grouped into "remaining" and
// "completed" per subject — remaining first, since that's what decides the next
// class. Clicking a chapter's circle or a unit chip toggles its completion
// (the server cascades: all units done → chapter done; chapter marked → units
// follow). Read-only when onToggle is absent.
//
// Renders the list only — the page that mounts it owns the heading and the
// loading/empty states, since it knows whether data is still on its way.
export default function SyllabusProgress({ subjects, onToggle }) {
  const [openId, setOpenId] = useState(null)

  if (subjects === null) return null
  if (!subjects.length) return null

  return (
    <div className="space-y-3">
        {subjects.map(s => {
          const chapters = s.chapters || []
          const done = chapters.filter(c => c.completed).length
          const open = openId === s._id
          // The bar moves per unit, not per chapter — chapters with units count
          // each unit as a step, so one marked unit shows partial progress
          // instead of the bar jumping a whole chapter at once.
          const steps = chapters.flatMap(c => (c.units?.length ? c.units : [c]))
          const stepsDone = steps.filter(x => x.completed).length
          const units = chapters.flatMap(c => c.units || [])
          const unitsDone = units.filter(u => u.completed).length
          const pct = steps.length ? Math.round((stepsDone / steps.length) * 100) : 0
          return (
            <div key={s._id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <button type="button" onClick={() => setOpenId(open ? null : s._id)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 text-left">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {s.name} <span className="text-[11px] font-medium text-gray-400">({s.level})</span>
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="h-1.5 rounded-full bg-gray-100 flex-1 max-w-[180px] overflow-hidden">
                      <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">
                      {done}/{chapters.length} chapters{units.length ? ` · ${unitsDone}/${units.length} units` : ''}
                    </span>
                  </div>
                </div>
                <span className="text-gray-300 text-xs flex-shrink-0">{open ? '▾' : '▸'}</span>
              </button>

              {open && (
                <div className="border-t border-gray-100 p-3 space-y-3">
                  {!chapters.length && <p className="text-xs text-gray-400">No chapters defined yet.</p>}
                  <ChapterGroup
                    label="⏳ Remaining" chapters={chapters.filter(c => !c.completed)}
                    subjectId={s._id} onToggle={onToggle} emptyText="Nothing left — all done 🎉"
                  />
                  <ChapterGroup
                    label="✅ Completed" chapters={chapters.filter(c => c.completed)}
                    subjectId={s._id} onToggle={onToggle} emptyText="Nothing completed yet"
                  />
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}

function ChapterGroup({ label, chapters, subjectId, onToggle, emptyText }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">{label} ({chapters.length})</p>
      {!chapters.length ? (
        <p className="text-xs text-gray-300 mb-1">{emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {chapters.map(ch => (
            <div key={ch._id} className={`rounded-xl border p-2.5 ${ch.completed ? 'border-teal-100 bg-teal-50/40' : 'border-gray-100'}`}>
              <div className="flex items-center gap-2">
                <ToggleDot
                  done={ch.completed}
                  disabled={!onToggle}
                  title={ch.completed ? 'Mark chapter as not completed' : 'Mark whole chapter completed'}
                  onClick={() => onToggle?.(subjectId, ch._id, null, !ch.completed)}
                />
                <p className={`text-sm font-medium flex-1 min-w-0 break-words ${ch.completed ? 'text-teal-700' : 'text-gray-800'}`}>
                  {ch.name}
                </p>
                {ch.completed && ch.completedBy?.name && (
                  <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0">
                    by {ch.completedBy.name}
                  </span>
                )}
              </div>
              {!!(ch.units || []).length && (
                <div className="flex flex-wrap gap-1.5 mt-1.5 pl-7">
                  {ch.units.map(u => (
                    <button key={u._id} type="button"
                      disabled={!onToggle}
                      onClick={() => onToggle?.(subjectId, ch._id, u._id, !u.completed)}
                      title={u.completed ? `Completed${u.completedBy?.name ? ` by ${u.completedBy.name}` : ''} — click to unmark` : 'Mark unit completed'}
                      className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                        u.completed
                          ? 'bg-teal-100 text-teal-800 border-teal-200'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-teal-300'}`}>
                      {u.completed ? '✓ ' : ''}{u.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ToggleDot({ done, onClick, disabled, title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-colors ${
        done ? 'bg-teal-500 border-teal-500 text-white' : 'border-gray-300 text-transparent hover:border-teal-400'}`}>
      ✓
    </button>
  )
}
