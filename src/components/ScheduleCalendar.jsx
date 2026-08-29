import { useState, useEffect, useMemo, useCallback } from 'react'
import { apiFetch } from '../api'

// Monthly + daily calendar of live-class slots, shared by the student and the
// mentor portals — only the feed differs, so the endpoint is a prop:
//   student: /api/live-classes/schedule         (classes this student may see)
//   mentor:  /api/live-classes/manage/schedule  (classes the admin allotted them)
// Month view is the overview; clicking a date shows that day's allotted schedule
// under the grid, and the Day view lays the same slots out on a time grid.

const HOUR_PX = 56          // one hour of the day-view time grid
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const STATUS_CHIP = {
  scheduled: 'bg-sky-100 text-sky-700',
  live:      'bg-red-100 text-red-700',
  ended:     'bg-gray-100 text-gray-500',
  cancelled: 'bg-amber-100 text-amber-700',
}
// Solid variants for month-cell chips and day-view blocks.
const STATUS_BLOCK = {
  scheduled: 'bg-sky-50 border-sky-300 text-sky-800',
  live:      'bg-red-50 border-red-300 text-red-700',
  ended:     'bg-gray-50 border-gray-300 text-gray-500',
  cancelled: 'bg-amber-50 border-amber-300 text-amber-600 line-through',
}
const STATUS_DOT = {
  scheduled: 'bg-sky-500',
  live:      'bg-red-500',
  ended:     'bg-gray-400',
  cancelled: 'bg-amber-500',
}

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const sameDay = (a, b) => dayKey(a) === dayKey(b)
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1)
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)

// The 6-week grid a month view shows: the Sunday on/before the 1st, 42 days on.
function gridRange(monthDate) {
  const first = startOfMonth(monthDate)
  const start = addDays(first, -first.getDay())
  return { start, end: addDays(start, 42) }
}

const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const fmtLongDate = (d) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtMonth = (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

// Column layout for overlapping day-view blocks: events that overlap in time are
// grouped into a cluster and split its width evenly (two tracks running at once
// sit side by side). Returns Map(id -> { col, cols }).
function layoutDayEvents(events) {
  const sorted = [...events].sort((a, b) =>
    new Date(a.scheduledStart) - new Date(b.scheduledStart) || new Date(a.scheduledEnd) - new Date(b.scheduledEnd))
  const placed = new Map()
  let cluster = []          // [{ ev, col }]
  let colEnds = []          // per-column latest end within the cluster
  let clusterEnd = 0

  const closeCluster = () => {
    for (const { ev, col } of cluster) placed.set(ev._id, { col, cols: colEnds.length })
    cluster = []; colEnds = []; clusterEnd = 0
  }

  for (const ev of sorted) {
    const start = new Date(ev.scheduledStart).getTime()
    const end = new Date(ev.scheduledEnd).getTime()
    if (cluster.length && start >= clusterEnd) closeCluster()
    let col = colEnds.findIndex((e) => e <= start)
    if (col === -1) { col = colEnds.length; colEnds.push(end) } else { colEnds[col] = end }
    cluster.push({ ev, col })
    clusterEnd = Math.max(clusterEnd, end)
  }
  closeCluster()
  return placed
}

function StatusBadge({ status }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${STATUS_CHIP[status] || ''}`}>
      {status === 'live' ? '● live' : status}
    </span>
  )
}

// Full slot details — what the admin allotted for this class.
function ClassDetailModal({ cls, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <StatusBadge status={cls.status} />
              {cls.roomLabel && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                  {cls.roomLabel}{cls.trackLabel ? ` · ${cls.trackLabel}` : ''}
                </span>
              )}
            </div>
            <p className="text-sm font-bold text-gray-900">{cls.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none flex-shrink-0">×</button>
        </div>
        <div className="p-5 space-y-2.5">
          <p className="text-sm text-gray-700">
            🕐 {new Date(cls.scheduledStart).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
            {' · '}{fmtTime(cls.scheduledStart)} – {fmtTime(cls.scheduledEnd)}
          </p>
          {cls.hostName && <p className="text-sm text-gray-700">🧑‍🏫 {cls.hostName}</p>}
          {cls.chapterName && (
            <p className="text-sm text-indigo-600">
              📖 {cls.subjectName ? `${cls.subjectName} · ` : ''}{cls.chapterName}{cls.unitName ? ` · ${cls.unitName}` : ''}
            </p>
          )}
          {cls.description && <p className="text-sm text-gray-500">{cls.description}</p>}
        </div>
      </div>
    </div>
  )
}

export default function ScheduleCalendar({ endpoint }) {
  const today = new Date()
  const [view, setView] = useState('month')             // 'month' | 'day'
  const [cursor, setCursor] = useState(startOfMonth(today)) // visible month
  const [selected, setSelected] = useState(today)       // clicked/day-view date
  const [eventsById, setEventsById] = useState({})      // merged cache across fetches
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)            // class in the detail modal

  const { start: rangeStart, end: rangeEnd } = useMemo(() => gridRange(cursor), [cursor])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const d = await apiFetch(`${endpoint}?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`)
      setEventsById((prev) => {
        // Replace, don't merge, inside the fetched window — a class the admin
        // cancelled or moved must drop off the calendar, not linger from cache.
        const next = {}
        for (const c of Object.values(prev)) {
          const inWindow = new Date(c.scheduledStart) < rangeEnd && new Date(c.scheduledEnd) > rangeStart
          if (!inWindow) next[c._id] = c
        }
        for (const c of d.classes || []) next[c._id] = c
        return next
      })
      setError('')
    } catch (err) {
      setError(err.message || 'Could not load the schedule')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [endpoint, rangeStart.getTime(), rangeEnd.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // Quiet refresh so a class flips to "live" on the calendar without a reload.
  useEffect(() => {
    const t = setInterval(() => load(true), 60_000)
    return () => clearInterval(t)
  }, [load])

  // Bucket by the local date the class starts on.
  const eventsByDay = useMemo(() => {
    const map = {}
    for (const c of Object.values(eventsById)) {
      const k = dayKey(new Date(c.scheduledStart))
      ;(map[k] ||= []).push(c)
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart))
    }
    return map
  }, [eventsById])

  const dayEvents = (d) => eventsByDay[dayKey(d)] || []

  // Keep the fetched month in step with wherever the user navigates.
  const goToDate = (d) => {
    setSelected(d)
    if (d.getMonth() !== cursor.getMonth() || d.getFullYear() !== cursor.getFullYear()) {
      setCursor(startOfMonth(d))
    }
  }

  const navigate = (dir) => {
    if (view === 'month') setCursor((c) => addMonths(c, dir))
    else goToDate(addDays(selected, dir))
  }

  const goToday = () => { setCursor(startOfMonth(today)); setSelected(new Date()) }

  // ── Month view ──
  const renderMonth = () => {
    const cells = Array.from({ length: 42 }, (_, i) => addDays(rangeStart, i))
    return (
      <>
        <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-gray-400 uppercase mb-1">
          {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-xl overflow-hidden border border-gray-100">
          {cells.map((d) => {
            const inMonth = d.getMonth() === cursor.getMonth()
            const isToday = sameDay(d, today)
            const isSelected = sameDay(d, selected)
            const evs = dayEvents(d)
            return (
              <button key={d.toISOString()} onClick={() => goToDate(d)}
                className={`min-h-[64px] md:min-h-[92px] p-1 md:p-1.5 text-left align-top transition-colors ${
                  isSelected ? 'bg-teal-50' : 'bg-white hover:bg-gray-50'} ${inMonth ? '' : 'opacity-40'}`}>
                <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full ${
                  isToday ? 'bg-teal-600 text-white' : 'text-gray-700'}`}>
                  {d.getDate()}
                </span>
                {/* Chips on wider screens, dots on phones */}
                <div className="hidden md:block mt-1 space-y-0.5">
                  {evs.slice(0, 2).map((c) => (
                    <span key={c._id} onClick={(e) => { e.stopPropagation(); setDetail(c) }}
                      className={`block truncate text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_BLOCK[c.status] || ''}`}>
                      {fmtTime(c.scheduledStart)} {c.title}
                    </span>
                  ))}
                  {evs.length > 2 && (
                    <span className="block text-[10px] text-gray-400 px-1.5">+{evs.length - 2} more</span>
                  )}
                </div>
                <div className="md:hidden mt-1 flex gap-0.5 flex-wrap">
                  {evs.slice(0, 4).map((c) => (
                    <span key={c._id} className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[c.status] || 'bg-gray-300'}`} />
                  ))}
                  {evs.length > 4 && <span className="text-[9px] text-gray-400 leading-none">+{evs.length - 4}</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* The clicked date's allotted schedule */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-gray-800">{fmtLongDate(selected)}</p>
            {dayEvents(selected).length > 0 && (
              <button onClick={() => setView('day')}
                className="text-xs font-semibold text-teal-600 hover:text-teal-800">
                Open day view →
              </button>
            )}
          </div>
          {!dayEvents(selected).length ? (
            <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">No classes scheduled on this day.</p>
          ) : (
            <div className="space-y-2">
              {dayEvents(selected).map((c) => (
                <button key={c._id} onClick={() => setDetail(c)}
                  className="w-full text-left bg-white border border-gray-100 rounded-xl px-3.5 py-2.5 hover:bg-gray-50 flex items-center gap-3">
                  <div className="text-xs font-semibold text-gray-500 w-[105px] flex-shrink-0">
                    {fmtTime(c.scheduledStart)} – {fmtTime(c.scheduledEnd)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.title}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {[c.roomLabel && `${c.roomLabel} · ${c.trackLabel}`, c.hostName, c.chapterName]
                        .filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </button>
              ))}
            </div>
          )}
        </div>
      </>
    )
  }

  // ── Day view ──
  const renderDay = () => {
    const evs = dayEvents(selected)
    const startHour = Math.min(8, ...evs.map((c) => new Date(c.scheduledStart).getHours()))
    const endHour = Math.max(21, ...evs.map((c) => {
      const e = new Date(c.scheduledEnd)
      return e.getHours() + (e.getMinutes() > 0 ? 1 : 0)
    }))
    const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)
    const placed = layoutDayEvents(evs)
    const topFor = (d) => {
      const t = new Date(d)
      return ((t.getHours() - startHour) + t.getMinutes() / 60) * HOUR_PX
    }

    return (
      <div className="overflow-x-auto">
        <div className="relative min-w-[280px]" style={{ height: (endHour - startHour) * HOUR_PX + 20 }}>
          {/* Hour lines + labels */}
          {hours.map((h) => (
            <div key={h} className="absolute left-0 right-0 flex items-start" style={{ top: (h - startHour) * HOUR_PX }}>
              <span className="w-12 flex-shrink-0 text-[10px] text-gray-400 -translate-y-1.5 pr-1 text-right">
                {new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}
              </span>
              <div className="flex-1 border-t border-gray-100" />
            </div>
          ))}
          {/* Now line, when viewing today */}
          {sameDay(selected, today) && today.getHours() >= startHour && today.getHours() <= endHour && (
            <div className="absolute left-12 right-0 border-t-2 border-red-400 z-10 pointer-events-none"
              style={{ top: topFor(today) }} />
          )}
          {/* Slot blocks */}
          <div className="absolute left-12 right-0 top-0 bottom-0">
            {evs.map((c) => {
              const { col, cols } = placed.get(c._id) || { col: 0, cols: 1 }
              const top = topFor(c.scheduledStart)
              const height = Math.max(28, topFor(c.scheduledEnd) - top - 2)
              return (
                <button key={c._id} onClick={() => setDetail(c)}
                  className={`absolute rounded-lg border px-2 py-1 text-left overflow-hidden hover:shadow-md transition-shadow ${STATUS_BLOCK[c.status] || 'bg-white border-gray-200'}`}
                  style={{
                    top, height,
                    left: `calc(${(col / cols) * 100}% + 2px)`,
                    width: `calc(${(1 / cols) * 100}% - 4px)`,
                  }}>
                  <p className="text-[11px] font-bold truncate">
                    {c.status === 'live' && '● '}{c.title}
                  </p>
                  <p className="text-[10px] truncate opacity-80">
                    {fmtTime(c.scheduledStart)} – {fmtTime(c.scheduledEnd)}
                    {c.roomLabel ? ` · ${c.roomLabel} · ${c.trackLabel}` : ''}
                  </p>
                  {height > 52 && (c.hostName || c.chapterName) && (
                    <p className="text-[10px] truncate opacity-70">
                      {[c.hostName, c.chapterName].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
          {!evs.length && (
            <p className="absolute inset-x-0 top-1/3 text-center text-sm text-gray-400">
              No classes scheduled on this day.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-3 md:p-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} aria-label="Previous"
            className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 font-bold">‹</button>
          <button onClick={() => navigate(1)} aria-label="Next"
            className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 font-bold">›</button>
          <button onClick={goToday}
            className="ml-1 px-3 h-8 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50">
            Today
          </button>
          <p className="ml-2 text-sm md:text-base font-bold text-gray-900">
            {view === 'month' ? fmtMonth(cursor) : fmtLongDate(selected)}
          </p>
          {loading && <span className="text-xs text-gray-400 ml-1">…</span>}
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
          {['month', 'day'].map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 h-8 capitalize ${view === v ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {view === 'month' ? renderMonth() : renderDay()}

      {/* Legend */}
      <div className="flex items-center gap-3 mt-4 flex-wrap">
        {Object.entries(STATUS_DOT).map(([s, cls]) => (
          <span key={s} className="flex items-center gap-1.5 text-[11px] text-gray-500 capitalize">
            <span className={`w-2 h-2 rounded-full ${cls}`} /> {s}
          </span>
        ))}
      </div>

      {detail && <ClassDetailModal cls={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
