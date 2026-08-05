import { useState, useEffect } from 'react'
import { apiFetch } from '../../api'

// The student's own view of what they've completed, on its own page. Same data
// the admin sees on the Users page, scoped to themselves by the endpoint (it
// reads req.user, never an id from the request). Read-only: completion is earned
// by attendance and confirmed by a mentor, never self-declared.
export default function ProgressPage() {
  const [data, setData]     = useState(null)   // null = loading
  const [filter, setFilter] = useState('all')  // all | done | pending
  const [query, setQuery]   = useState('')
  const [open, setOpen]     = useState(() => new Set())
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    apiFetch('/api/live-classes/my-chapter-progress')
      .then(setData)
      .catch(() => setData({ subjects: [] }))
  }, [])

  const subjects = data?.subjects || []
  const allItems = subjects.flatMap(s => s.items)
  const doneCount = allItems.filter(i => i.completed).length

  const q = query.trim().toLowerCase()
  const visible = subjects
    .map(s => ({
      ...s,
      done: s.items.filter(i => i.completed).length,
      total: s.items.length,
      items: s.items.filter(i =>
        (filter === 'all' || (filter === 'done' ? i.completed : !i.completed)) &&
        (!q || `${i.chapterName} ${i.unitName}`.toLowerCase().includes(q))),
    }))
    .filter(s => s.items.length)

  // Short lists stay open so there's nothing to click; longer ones collapse.
  const count = visible.reduce((n, s) => n + s.items.length, 0)
  const autoOpen = !!q || (!touched && count <= 12)
  const isOpen = (id) => autoOpen || open.has(id)
  const toggle = (id) => {
    setOpen(prev => {
      const next = new Set(autoOpen ? visible.map(s => s.subjectId) : prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setTouched(true)
  }

  const chips = [
    { value: 'all',     label: 'All',       count: allItems.length },
    { value: 'done',    label: 'Completed', count: doneCount },
    { value: 'pending', label: 'Remaining', count: allItems.length - doneCount },
  ]

  const overallPct = allItems.length ? Math.round((doneCount / allItems.length) * 100) : 0

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">My Progress</h1>
        <p className="text-gray-400 text-sm mt-1">
          Chapters you've completed through live classes.
          {data?.thresholdPercent != null && ` You need ${data.thresholdPercent}% attendance to complete one.`}
        </p>
      </div>

      {data === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading your progress…</div>
      ) : !allItems.length ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">No chapters yet</p>
          <p className="text-gray-400 text-sm">Once you attend live classes, your chapter progress shows up here.</p>
        </div>
      ) : (
        <>
          {/* Headline number — the one thing worth seeing on a small screen */}
          <div className="bg-white rounded-2xl shadow-sm p-4 md:p-5 mb-4">
            <div className="flex items-end justify-between gap-3 mb-2">
              <div>
                <p className="text-2xl md:text-3xl font-bold text-gray-900">{doneCount}<span className="text-gray-300 text-lg md:text-xl"> / {allItems.length}</span></p>
                <p className="text-xs text-gray-400 mt-0.5">chapters completed</p>
              </div>
              <p className="text-2xl md:text-3xl font-bold text-emerald-500">{overallPct}%</p>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${overallPct}%` }} />
            </div>
          </div>

          {/* Filters — chips scroll sideways rather than wrapping on a phone */}
          <div className="flex gap-2 mb-3 flex-col sm:flex-row sm:items-center">
            <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
              {chips.map(c => (
                <button key={c.value} onClick={() => setFilter(c.value)}
                  className={`text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap flex-shrink-0 transition-colors ${
                    filter === c.value ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  {c.label} {c.count}
                </button>
              ))}
            </div>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search chapter…"
              className="sm:ml-auto w-full sm:w-52 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>

          {!visible.length ? (
            <div className="bg-white rounded-2xl p-8 text-center text-sm text-gray-400">
              {q ? `Nothing matches "${query.trim()}".`
                : filter === 'done' ? 'No chapters completed yet — keep attending!'
                : "Nothing remaining. You're all caught up!"}
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map(subj => {
                const isOpn = isOpen(subj.subjectId)
                const pct = subj.total ? Math.round((subj.done / subj.total) * 100) : 0
                return (
                  <div key={subj.subjectId} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <button onClick={() => toggle(subj.subjectId)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
                      <span className="text-gray-300 text-xs w-3 flex-shrink-0">{isOpn ? '▾' : '▸'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{subj.name}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="h-1.5 bg-gray-100 rounded-full flex-1 max-w-[200px] overflow-hidden">
                            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[11px] text-gray-400 flex-shrink-0">{subj.done}/{subj.total}</span>
                        </div>
                      </div>
                    </button>

                    {isOpn && (
                      <div className="px-3 pb-3 space-y-1.5">
                        {subj.items.map(it => (
                          <div key={`${it.chapterId}:${it.unitId || ''}`}
                            className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 break-words">{it.unitName || it.chapterName}</p>
                              {it.unitName && <p className="text-xs text-gray-400 break-words">{it.chapterName}</p>}
                              <p className="text-xs text-gray-400 mt-1">
                                {it.sessions
                                  ? `${it.sessions} class${it.sessions !== 1 ? 'es' : ''} · you attended ${it.percent}%`
                                  : 'Not taught yet'}
                                {it.reason === 'attendance' && <span className="text-amber-600"> · attend more to complete</span>}
                              </p>
                            </div>
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md uppercase flex-shrink-0 ${
                              it.completed ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                              {it.completed ? '✓ Done' : 'Pending'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
