import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { apiFetch } from '../api'
import { groupRoomSlots } from '../utils/roomSlots'

// Month / week / day calendar of live-class slots, shared by the student and the
// mentor portals. Only the feed and the buttons differ, so both are props:
//
//   endpoint       student: /api/live-classes/schedule         (classes they may see)
//                  mentor:  /api/live-classes/manage/schedule  (classes allotted to them)
//   renderActions  (item, { compact, refresh, close }) → the page's own buttons
//                  for one entry (Join now / Start / End …), or null when there
//                  are none. `item` is a class — or, with groupRooms, a room
//                  slot whose `classes` are its tracks (see utils/roomSlots.js;
//                  a lone class is a slot of one, with the same fields).
//                  `compact` asks for small buttons (agenda rows, the live
//                  strip); the detail modal gets the full-size set. `refresh`
//                  refetches after an action changed a class; `close`
//                  dismisses the detail modal.
//   groupRooms     mentor portal: collapse the tracks of one room that run at
//                  the same time into a single entry with one button — the
//                  mentor starts the room once and switches tracks inside.
//   refreshKey     any change triggers a quiet refetch (e.g. the hosted session
//                  starting, so the slot flips to live without a reload).
//   pollMs         background refresh interval — a class going live must show
//                  its Join button within seconds, not on the next page load.
//
// The page owns the join/start logic (tokens, the LiveKit room, modals); the
// calendar only decides WHERE those buttons appear: the "Live now" strip, the
// selected day's agenda rows, and the class detail modal.

const HOUR_PX = 56          // one hour of the week/day time grid
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const VIEWS = ['month', 'week', 'day']
const VIEW_KEY = 'focas.schedule.view'   // remembered per browser
const DEFAULT_POLL_MS = 20_000

const STATUS_CHIP = {
  scheduled: 'bg-sky-100 text-sky-700',
  live:      'bg-red-100 text-red-700',
  ended:     'bg-gray-100 text-gray-500',
  cancelled: 'bg-amber-100 text-amber-700',
}
// Solid variants for month-cell chips and time-grid blocks.
const STATUS_BLOCK = {
  scheduled: 'bg-sky-50 border-sky-300 text-sky-800',
  live:      'bg-red-50 border-red-300 text-red-700 ring-1 ring-red-200',
  ended:     'bg-gray-50 border-gray-300 text-gray-500',
  cancelled: 'bg-amber-50 border-amber-300 text-amber-600 line-through',
}
const STATUS_DOT = {
  scheduled: 'bg-sky-500',
  live:      'bg-red-500',
  ended:     'bg-gray-400',
  cancelled: 'bg-amber-500',
}

const readStoredView = () => {
  try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : 'month' } catch { return 'month' }
}
const storeView = (v) => { try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode etc. */ } }

// ── Date helpers (all in the browser's local time) ──
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const sameDay = (a, b) => dayKey(a) === dayKey(b)
const sameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1)
const startOfWeek = (d) => addDays(startOfDay(d), -d.getDay())
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)

// The 6-week grid a month view shows: the Sunday on/before the 1st, 42 days on.
// Every week that touches the month sits inside it, so the week view never
// needs a fetch of its own.
function gridRange(monthDate) {
  const first = startOfMonth(monthDate)
  const start = addDays(first, -first.getDay())
  return { start, end: addDays(start, 42) }
}

const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const fmtLongDate = (d) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtShortDate = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const fmtMonth = (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
// "Aug 30 – Sep 5, 2026" — month on both ends so every locale's day/month
// order reads unambiguously.
const fmtWeekRange = (start) => {
  const a = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const b = addDays(start, 6).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${a} – ${b}`
}

// "in 25 min" / "2 h 10 min ago" / "in 3 days" — for the detail modal's status line.
function relTime(target, now) {
  const diff = new Date(target).getTime() - now.getTime()
  const m = Math.round(Math.abs(diff) / 60_000)
  let s
  if (m < 1) s = 'less than a minute'
  else if (m < 60) s = `${m} min`
  else if (m < 24 * 60) { const h = Math.floor(m / 60), r = m % 60; s = r ? `${h} h ${r} min` : `${h} h` }
  else { const d = Math.round(m / (24 * 60)); s = `${d} day${d === 1 ? '' : 's'}` }
  return diff >= 0 ? `in ${s}` : `${s} ago`
}

// One line that answers "can I join this right now, and if not, when?".
function statusLine(cls, now) {
  const start = new Date(cls.scheduledStart)
  const end = new Date(cls.scheduledEnd)
  switch (cls.status) {
    case 'live':
      return { text: `Live now · started ${relTime(cls.startedAt || start, now)}`, tone: 'text-red-600' }
    case 'scheduled':
      return start > now
        ? { text: `Starts ${relTime(start, now)}`, tone: 'text-sky-700' }
        : { text: `Was due ${relTime(start, now)} · waiting for the host to start`, tone: 'text-amber-600' }
    case 'ended':
      return { text: `Ended ${relTime(cls.endedAt || end, now)}`, tone: 'text-gray-500' }
    case 'cancelled':
      return { text: 'This class was cancelled', tone: 'text-amber-600' }
    default:
      return null
  }
}

const metaLine = (c) => [c.roomLabel && `${c.roomLabel} · ${c.trackLabel}`, c.hostName, c.chapterName].filter(Boolean).join(' · ')

// Column layout for overlapping time-grid blocks: events that overlap in time are
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

// A clock that ticks every `intervalMs` — drives countdowns and the "now" line.
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function LiveDot({ className = '' }) {
  return (
    <span className={`relative inline-flex w-2 h-2 flex-shrink-0 ${className}`} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
      <span className="relative inline-flex rounded-full w-2 h-2 bg-red-500" />
    </span>
  )
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${STATUS_CHIP[status] || ''}`}>
      {status === 'live' && <LiveDot />}
      {status}
    </span>
  )
}

// Full slot details plus the page's buttons for it. A bottom sheet on phones, a
// centred dialog on wider screens. Escape closes; focus lands on the close button.
function ClassDetailModal({ cls, now, actions, onClose }) {
  const closeRef = useRef(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const line = statusLine(cls, now)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="class-detail-title"
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
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
            <p id="class-detail-title" className="text-sm font-bold text-gray-900">{cls.title}</p>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close"
            className="text-gray-400 hover:text-gray-700 text-xl leading-none flex-shrink-0 w-8 h-8 -mr-2 -mt-1 rounded-lg hover:bg-gray-50">
            ×
          </button>
        </div>
        <div className="p-5 space-y-2.5 overflow-y-auto">
          {line && <p className={`text-sm font-semibold ${line.tone}`}>{line.text}</p>}
          <p className="text-sm text-gray-700">
            🕐 {fmtShortDate(cls.scheduledStart)}{' · '}{fmtTime(cls.scheduledStart)} – {fmtTime(cls.scheduledEnd)}
          </p>
          {cls.hostName && <p className="text-sm text-gray-700">🧑‍🏫 {cls.hostName}</p>}
          {cls.chapterName && (
            <p className="text-sm text-indigo-600">
              📖 {cls.subjectName ? `${cls.subjectName} · ` : ''}{cls.chapterName}{cls.unitName ? ` · ${cls.unitName}` : ''}
            </p>
          )}
          {cls.description && <p className="text-sm text-gray-500 whitespace-pre-line">{cls.description}</p>}
          {/* A room slot: the tracks running in it, each with its own status */}
          {cls.isGroup && (
            <div className="pt-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">Tracks in this room</p>
              <div className="space-y-1.5">
                {cls.classes.map((t) => (
                  <div key={t._id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-800 truncate">{t.trackLabel}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {[`${fmtTime(t.scheduledStart)} – ${fmtTime(t.scheduledEnd)}`, t.subjectName, t.chapterName, t.unitName]
                          .filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">Start once, then switch tracks from inside the room.</p>
            </div>
          )}
        </div>
        {actions && (
          <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-2 justify-end bg-gray-50/60 rounded-b-2xl">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

// Time grid shared by the week (7 columns) and day (1 column) views.
function TimeGrid({ days, eventsFor, now, onOpen, onPickDay }) {
  const perDay = days.map((d) => ({ day: d, evs: eventsFor(d), placed: layoutDayEvents(eventsFor(d)) }))
  const all = perDay.flatMap((p) => p.evs)
  const isWeek = days.length > 1

  // Hour span: a working day by default, stretched to fit early/late slots.
  const startHour = Math.min(8, ...all.map((c) => new Date(c.scheduledStart).getHours()))
  const endHour = Math.max(21, ...perDay.flatMap(({ day, evs }) => evs.map((c) => {
    const e = new Date(c.scheduledEnd)
    if (!sameDay(e, day)) return 24                       // runs past midnight
    return e.getHours() + (e.getMinutes() > 0 ? 1 : 0)
  })))
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)
  const gridHeight = (endHour - startHour) * HOUR_PX

  // Pixel offset of an instant within one day's column, clamped to the grid.
  const topFor = (day, instant) => {
    const mins = (new Date(instant).getTime() - startOfDay(day).getTime()) / 60_000
    const clamped = Math.min(endHour * 60, Math.max(startHour * 60, mins))
    return (clamped / 60 - startHour) * HOUR_PX
  }

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className={isWeek ? 'min-w-[680px]' : 'min-w-[280px]'}>
        {isWeek && (
          <div className="flex pl-12 mb-1">
            {days.map((d) => {
              const isToday = sameDay(d, now)
              return (
                <button key={d.toISOString()} onClick={() => onPickDay(d)} title={fmtLongDate(d)}
                  className="flex-1 min-w-0 text-center py-1 rounded-lg hover:bg-gray-50">
                  <span className="block text-[10px] font-semibold uppercase text-gray-400">{WEEKDAYS[d.getDay()]}</span>
                  <span className={`inline-flex items-center justify-center w-7 h-7 text-sm font-semibold rounded-full ${
                    isToday ? 'bg-teal-600 text-white' : 'text-gray-800'}`}>
                    {d.getDate()}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className="relative" style={{ height: gridHeight + 20 }}>
          {/* Hour lines + labels */}
          {hours.map((h) => (
            <div key={h} className="absolute left-0 right-0 flex items-start" style={{ top: (h - startHour) * HOUR_PX }}>
              <span className="w-12 flex-shrink-0 text-[10px] text-gray-400 -translate-y-1.5 pr-1 text-right">
                {new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}
              </span>
              <div className="flex-1 border-t border-gray-100" />
            </div>
          ))}
          {/* Day columns */}
          <div className="absolute left-12 right-0 top-0 flex" style={{ height: gridHeight }}>
            {perDay.map(({ day, evs, placed }, i) => {
              const isToday = sameDay(day, now)
              const nowVisible = isToday && now.getHours() >= startHour && now.getHours() < endHour
              return (
                <div key={day.toISOString()}
                  className={`relative flex-1 min-w-0 ${isWeek && i > 0 ? 'border-l border-gray-100' : ''} ${
                    isWeek && isToday ? 'bg-teal-50/40' : ''}`}>
                  {nowVisible && (
                    <div className="absolute left-0 right-0 border-t-2 border-red-400 z-10 pointer-events-none"
                      style={{ top: topFor(day, now) }}>
                      <span className="absolute -left-1 -top-[5px] w-2 h-2 rounded-full bg-red-400" />
                    </div>
                  )}
                  {evs.map((c) => {
                    const { col, cols } = placed.get(c._id) || { col: 0, cols: 1 }
                    const top = topFor(day, c.scheduledStart)
                    const height = Math.max(28, topFor(day, c.scheduledEnd) - top - 2)
                    const live = c.status === 'live'
                    return (
                      <button key={c._id} onClick={() => onOpen(c)}
                        title={`${c.title} · ${fmtTime(c.scheduledStart)} – ${fmtTime(c.scheduledEnd)}`}
                        className={`absolute rounded-lg border px-1.5 py-1 text-left overflow-hidden hover:shadow-md transition-shadow ${
                          STATUS_BLOCK[c.status] || 'bg-white border-gray-200'}`}
                        style={{
                          top, height,
                          left: `calc(${(col / cols) * 100}% + 2px)`,
                          width: `calc(${(1 / cols) * 100}% - 4px)`,
                        }}>
                        <p className="text-[11px] font-bold truncate flex items-center gap-1">
                          {live && <LiveDot />}<span className="truncate">{c.title}</span>
                        </p>
                        <p className="text-[10px] truncate opacity-80">
                          {fmtTime(c.scheduledStart)} – {fmtTime(c.scheduledEnd)}
                          {!isWeek && c.roomLabel ? ` · ${c.roomLabel} · ${c.trackLabel}` : ''}
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
              )
            })}
          </div>
          {!all.length && (
            <p className="absolute inset-x-0 top-1/3 text-center text-sm text-gray-400 pointer-events-none">
              {isWeek ? 'No classes scheduled this week.' : 'No classes scheduled on this day.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ScheduleCalendar({ endpoint, renderActions, refreshKey, pollMs = DEFAULT_POLL_MS, groupRooms = false }) {
  const now = useNow()
  const [view, setViewState] = useState(readStoredView)       // 'month' | 'week' | 'day'
  const [cursor, setCursor] = useState(() => startOfMonth(new Date())) // fetched/visible month
  const [selected, setSelected] = useState(() => new Date())  // clicked / week / day date
  const [eventsById, setEventsById] = useState({})            // merged cache across fetches
  const [loaded, setLoaded] = useState(false)                 // first fetch settled
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailId, setDetailId] = useState(null)              // class in the detail modal

  const setView = (v) => { setViewState(v); storeView(v) }

  const range = useMemo(() => gridRange(cursor), [cursor])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const d = await apiFetch(`${endpoint}?from=${range.start.toISOString()}&to=${range.end.toISOString()}`)
      setEventsById((prev) => {
        // Replace, don't merge, inside the fetched window — a class the admin
        // cancelled or moved must drop off the calendar, not linger from cache.
        const next = {}
        for (const c of Object.values(prev)) {
          const inWindow = new Date(c.scheduledStart) < range.end && new Date(c.scheduledEnd) > range.start
          if (!inWindow) next[c._id] = c
        }
        for (const c of d.classes || []) next[c._id] = c
        return next
      })
      setError('')
    } catch (err) {
      setError(err.message || 'Could not load the schedule')
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [endpoint, range])

  // Latest loader for the timers/listeners below, so they never refetch with a
  // stale month and never have to re-subscribe when the month changes.
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  useEffect(() => { load() }, [load])

  // Background refresh — and an immediate one whenever the tab comes back into
  // view or the network returns, since that's exactly when the data is stalest.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') loadRef.current(true) }
    const t = setInterval(refresh, pollMs)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [pollMs])

  // The page tells us something changed (a class was started/ended) via refreshKey.
  const seenKey = useRef(refreshKey)
  useEffect(() => {
    if (seenKey.current === refreshKey) return
    seenKey.current = refreshKey
    loadRef.current(true)
  }, [refreshKey])

  // What the calendar draws: room slots (mentor — the tracks of one room at the
  // same time collapse into one entry) or plain classes (student). Both carry
  // the same display fields, so everything below just renders "slots".
  const slotsById = useMemo(() => {
    const map = {}
    for (const s of groupRoomSlots(Object.values(eventsById), groupRooms)) map[s._id] = s
    return map
  }, [eventsById, groupRooms])

  // Bucket by the local date the slot starts on.
  const eventsByDay = useMemo(() => {
    const map = {}
    for (const c of Object.values(slotsById)) {
      const k = dayKey(new Date(c.scheduledStart))
      ;(map[k] ||= []).push(c)
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart))
    }
    return map
  }, [slotsById])

  const liveNow = useMemo(() =>
    Object.values(slotsById)
      .filter((c) => c.status === 'live')
      .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart)),
  [slotsById])

  const dayEvents = (d) => eventsByDay[dayKey(d)] || []

  // The modal reads from the cache, so it follows a poll that flips its class
  // to live (the Join button appears in place) and closes if the class vanishes.
  const detail = detailId ? slotsById[detailId] : null
  const closeDetail = useCallback(() => setDetailId(null), [])
  // Handed to the page's buttons — plain `load`, not the ref: this runs inside a
  // render-prop, and reading a ref there is off-limits for the React Compiler.
  const refresh = useCallback(() => load(true), [load])

  const actionsFor = (cls, compact) =>
    renderActions ? renderActions(cls, { compact, refresh, close: closeDetail }) : null

  // Keep the fetched month in step with wherever the user navigates.
  const goToDate = (d) => {
    setSelected(d)
    if (!sameMonth(d, cursor)) setCursor(startOfMonth(d))
  }

  const navigate = (dir) => {
    if (view === 'month') {
      const next = addMonths(cursor, dir)
      setCursor(next)
      // The agenda under the grid follows the month: today if we're back on it,
      // otherwise the 1st — not a date from a month no longer on screen.
      setSelected(sameMonth(next, now) ? startOfDay(now) : next)
    } else {
      goToDate(addDays(selected, view === 'week' ? 7 * dir : dir))
    }
  }

  const goToday = () => { const t = new Date(); setCursor(startOfMonth(t)); setSelected(t) }

  const title = view === 'month' ? fmtMonth(cursor)
    : view === 'week' ? fmtWeekRange(startOfWeek(selected))
    : fmtLongDate(selected)

  // ── Month view ──
  const renderMonth = () => {
    const cells = Array.from({ length: 42 }, (_, i) => addDays(range.start, i))
    const agenda = dayEvents(selected)
    return (
      <>
        <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-gray-400 uppercase mb-1">
          {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-xl overflow-hidden border border-gray-100">
          {cells.map((d) => {
            const inMonth = sameMonth(d, cursor)
            const isToday = sameDay(d, now)
            const isSelected = sameDay(d, selected)
            const evs = dayEvents(d)
            return (
              <button key={d.toISOString()} onClick={() => goToDate(d)}
                aria-label={`${fmtLongDate(d)}${evs.length ? `, ${evs.length} class${evs.length === 1 ? '' : 'es'}` : ''}`}
                aria-pressed={isSelected}
                className={`min-h-[64px] md:min-h-[104px] p-1 md:p-1.5 text-left align-top transition-colors ${
                  isSelected ? 'bg-teal-50' : 'bg-white hover:bg-gray-50'} ${inMonth ? '' : 'opacity-40'}`}>
                <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full ${
                  isToday ? 'bg-teal-600 text-white' : 'text-gray-700'}`}>
                  {d.getDate()}
                </span>
                {/* Chips on wider screens, dots on phones */}
                <div className="hidden md:block mt-1 space-y-0.5">
                  {evs.slice(0, 3).map((c) => (
                    <span key={c._id} role="button" tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); setDetailId(c._id) }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setDetailId(c._id) } }}
                      className={`flex items-center gap-1 truncate text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_BLOCK[c.status] || ''}`}>
                      {c.status === 'live' && <LiveDot />}
                      <span className="truncate">{fmtTime(c.scheduledStart)} {c.title}</span>
                    </span>
                  ))}
                  {evs.length > 3 && (
                    <span className="block text-[10px] text-gray-400 px-1.5">+{evs.length - 3} more</span>
                  )}
                </div>
                <div className="md:hidden mt-1 flex gap-0.5 flex-wrap">
                  {evs.slice(0, 4).map((c) => (
                    <span key={c._id} className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[c.status] || 'bg-gray-300'} ${
                      c.status === 'live' ? 'animate-pulse' : ''}`} />
                  ))}
                  {evs.length > 4 && <span className="text-[9px] text-gray-400 leading-none">+{evs.length - 4}</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* The clicked date's allotted schedule, with the buttons for each slot */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <p className="text-sm font-bold text-gray-800">{fmtLongDate(selected)}</p>
            {agenda.length > 0 && (
              <button onClick={() => setView('day')}
                className="text-xs font-semibold text-teal-600 hover:text-teal-800 whitespace-nowrap">
                Open day view →
              </button>
            )}
          </div>
          {!agenda.length ? (
            <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">No classes scheduled on this day.</p>
          ) : (
            <div className="space-y-2">
              {agenda.map((c) => {
                const actions = actionsFor(c, true)
                return (
                  <div key={c._id}
                    className={`flex items-center gap-2 sm:gap-3 bg-white border rounded-xl pl-3.5 pr-2.5 py-2.5 ${
                      c.status === 'live' ? 'border-red-200 shadow-sm' : 'border-gray-100'}`}>
                    <button onClick={() => setDetailId(c._id)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-lg hover:bg-gray-50 -ml-1.5 pl-1.5 py-0.5">
                      <div className="hidden sm:block text-xs font-semibold text-gray-500 w-[105px] flex-shrink-0">
                        {fmtTime(c.scheduledStart)} – {fmtTime(c.scheduledEnd)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{c.title}</p>
                        <p className="text-xs text-gray-400 truncate">
                          <span className="sm:hidden">{fmtTime(c.scheduledStart)} · </span>{metaLine(c)}
                        </p>
                      </div>
                    </button>
                    <StatusBadge status={c.status} />
                    {actions && <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </>
    )
  }

  const renderTimeGrid = () => {
    const days = view === 'week'
      ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(selected), i))
      : [startOfDay(selected)]
    return (
      <TimeGrid days={days} eventsFor={dayEvents} now={now}
        onOpen={(c) => setDetailId(c._id)}
        onPickDay={(d) => { goToDate(d); setView('day') }} />
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-3 md:p-5">
      {/* Whatever is live right now, wherever the calendar is scrolled to —
          this is the one place a Join button must never be more than a glance away. */}
      {liveNow.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50/70 p-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-red-600 mb-2">
            <LiveDot /> Live now
          </p>
          <div className="space-y-2">
            {liveNow.map((c) => {
              const actions = actionsFor(c, true)
              return (
                <div key={c._id} className="flex items-center gap-2 sm:gap-3 bg-white border border-red-100 rounded-lg pl-3 pr-2 py-2">
                  <button onClick={() => setDetailId(c._id)} className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.title}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {[`${fmtTime(c.scheduledStart)} – ${fmtTime(c.scheduledEnd)}`, metaLine(c)].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                  {actions && <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-1 min-w-0">
          <button onClick={() => navigate(-1)} aria-label={`Previous ${view}`}
            className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 font-bold flex-shrink-0">‹</button>
          <button onClick={() => navigate(1)} aria-label={`Next ${view}`}
            className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 font-bold flex-shrink-0">›</button>
          <button onClick={goToday}
            className="ml-1 px-3 h-8 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 flex-shrink-0">
            Today
          </button>
          <p className="ml-2 text-sm md:text-base font-bold text-gray-900 truncate" aria-live="polite">{title}</p>
          {loading && loaded && <span className="text-xs text-gray-400 ml-1 flex-shrink-0">Updating…</span>}
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold" role="group" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={`px-3 h-8 capitalize ${view === v ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5">
          <p className="text-sm text-red-600 min-w-0 truncate">{error}</p>
          <button onClick={() => load()}
            className="text-xs font-semibold text-red-700 border border-red-200 bg-white rounded-lg px-2.5 py-1 hover:bg-red-50 flex-shrink-0">
            Retry
          </button>
        </div>
      )}

      {!loaded ? (
        <div className="animate-pulse" aria-busy="true" aria-label="Loading schedule">
          <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-xl overflow-hidden border border-gray-100">
            {Array.from({ length: 35 }, (_, i) => <div key={i} className="min-h-[64px] md:min-h-[104px] bg-gray-50" />)}
          </div>
        </div>
      ) : view === 'month' ? renderMonth() : renderTimeGrid()}

      {/* Legend */}
      <div className="flex items-center gap-3 mt-4 flex-wrap">
        {Object.entries(STATUS_DOT).map(([s, cls]) => (
          <span key={s} className="flex items-center gap-1.5 text-[11px] text-gray-500 capitalize">
            <span className={`w-2 h-2 rounded-full ${cls}`} /> {s}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-gray-400">Refreshes automatically</span>
      </div>

      {detail && (
        <ClassDetailModal cls={detail} now={now} actions={actionsFor(detail, false)} onClose={closeDetail} />
      )}
    </div>
  )
}
