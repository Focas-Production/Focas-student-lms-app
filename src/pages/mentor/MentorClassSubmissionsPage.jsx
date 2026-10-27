import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../../api'
import { useLiveSession } from '../../components/LiveSessionProvider'
import { SubmissionRow } from '../../components/SubmissionsModal'
import { once, playConfirmed, playDeclined } from '../../utils/chime'

// One class's submissions as a full PAGE (not a modal): every student who
// joined the room, split into who has handed work in and who hasn't. Opened
// from the 📎 Submissions button inside a live class — the room shrinks to its
// corner window and keeps running behind this page — and it stays useful after
// the class ends (the same URL from the inbox or history).
//
// Built for a class of 10–20, where a reviewer works DOWN a queue:
//   • Laptop (≥1024px): two columns — the student list on the left (sticky,
//     scrolls on its own), the selected student's submission on the right with
//     the files (voice notes / videos play inline), the note and the review
//     form. "Mark reviewed" moves on to the next student waiting.
//   • Phone / tablet: one accordion list under a sticky filter bar; a row
//     expands into the same detail and collapses when marked reviewed.
//   • Order is the review queue (oldest hand-in first), then reviewed, then
//     the not-submitted — and it's STABLE across refreshes: a student adding
//     a second file doesn't shuffle the list under the reviewer.
//   • Filters (all / to review / reviewed / not submitted) and, from six
//     students up, a name/phone search.
//
// "Heard in class": while the class is live, the host can record work a
// student explained out loud (no file). The student is asked on their own
// screen and it only counts once they say yes — see HeardInClass below and
// markVerbal/respondVerbal in the server's classSubmissionController.
//
// Kept fresh three ways while the class is live: a 15 s poll (new joiners come
// from the LiveKit webhook), an immediate reload whenever the provider's
// per-class pending count moves (a student's upload is pushed to the host over
// the data channel), and a manual Refresh button.

const BASE = '/api/live-classes/manage'
const BTN  = 'bg-teal-600 hover:bg-teal-700'
const DESKTOP_MQ = '(min-width: 1024px)'
const SEARCH_FROM = 6   // students; below that a search box is just noise

const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—')
const fmtWhen = (d) => (d ? new Date(d).toLocaleString(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}) : '')
function fmtDur(ms) {
  if (!ms || ms < 0) return '0m'
  const m = Math.round(ms / 60000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const CLASS_STATUS = {
  live:      { label: 'Live now', cls: 'bg-red-50 text-red-600 border-red-200' },
  ended:     { label: 'Ended',    cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  scheduled: { label: 'Scheduled', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

// Where a roster row stands, for chips, avatars and ordering.
const ROW_STATE = {
  pending:  { label: 'Awaiting review', chip: 'bg-amber-100 text-amber-700',     avatar: 'bg-amber-100 text-amber-700' },
  changes:  { label: 'Changes asked',   chip: 'bg-orange-100 text-orange-700',   avatar: 'bg-orange-100 text-orange-700' },
  reviewed: { label: 'Reviewed',        chip: 'bg-emerald-100 text-emerald-700', avatar: 'bg-emerald-100 text-emerald-700' },
  missing:  { label: 'Not submitted',   chip: 'bg-red-50 text-red-600',          avatar: 'bg-gray-100 text-gray-500' },
}
const stateOf = (r) => !r.submission ? 'missing'
  : r.submission.status === 'reviewed' ? 'reviewed'
  : r.submission.status === 'changes_requested' ? 'changes'
  : 'pending'
const isPending = (r) => { const s = stateOf(r); return s === 'pending' || s === 'changes' }

// Review queue first, oldest hand-in on top; then reviewed; then not submitted
// (in the room first, then by name). Same rule as the server's — repeated here
// so a row moves to the right group the moment its review is saved, without a
// refetch.
function sortRoster(roster) {
  const group = (r) => (isPending(r) ? 0 : r.submission ? 1 : 2)
  return [...roster].sort((a, b) => {
    const ga = group(a), gb = group(b)
    if (ga !== gb) return ga - gb
    if (ga < 2) return new Date(a.submission.submittedAt) - new Date(b.submission.submittedAt)
    if (a.live !== b.live) return a.live ? -1 : 1
    return (a.name || '').localeCompare(b.name || '')
  })
}

const EMPTY = { roster: [], counts: { joined: 0, inRoom: 0, submitted: 0, notSubmitted: 0, pending: 0, reviewed: 0 }, class: null }

function recount(roster) {
  const submitted = roster.filter((r) => r.submission)
  return {
    joined:       roster.filter((r) => r.joined).length,
    inRoom:       roster.filter((r) => r.live).length,
    submitted:    submitted.length,
    notSubmitted: roster.length - submitted.length,
    pending:      submitted.filter((r) => r.submission.status !== 'reviewed').length,
    reviewed:     submitted.filter((r) => r.submission.status === 'reviewed').length,
  }
}

// Two-column layout or accordion — decided by a real media query, not by
// rendering both and hiding one (that would double the DOM and split state).
function useIsDesktop() {
  const [is, setIs] = useState(() => typeof window !== 'undefined' && window.matchMedia(DESKTOP_MQ).matches)
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ)
    const on = (e) => setIs(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return is
}

export default function MentorClassSubmissionsPage() {
  const { classId } = useParams()
  // Null outside MentorLayout (never the case for this route), but don't crash on it.
  const live = useLiveSession()
  const session   = live?.session || null
  const minimized = !!live?.minimized
  const subCounts = live?.subCounts || {}
  const isDesktop = useIsDesktop()

  const [data, setData]         = useState(null)   // { class, roster, counts }
  const [error, setError]       = useState('')
  const [filter, setFilter]     = useState('all')  // all | pending | reviewed | missing
  const [q, setQ]               = useState('')
  const [activeId, setActiveId] = useState(null)   // selected (laptop) / expanded (phone) student id
  const [refreshing, setRefreshing] = useState(false)

  // "Heard in class" requests seen waiting, so the poll can ring when one gets
  // its answer — a backup for a missed room push (both share once() keys, so
  // a student's answer rings once on this page, not twice).
  const pendingChecksRef = useRef(new Set())
  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`${BASE}/${classId}/submissions/roster`)
      const waiting = pendingChecksRef.current
      for (const r of d.roster || []) {
        const c = r.verbalCheck
        if (!c) continue
        const id = String(c._id)
        if (c.state === 'pending') waiting.add(id)
        else if (waiting.has(id)) {
          waiting.delete(id)
          if (c.state === 'declined') once(`verbal-no:${id}`, playDeclined)
          else if (c.state === 'confirmed') once(`verbal-yes:${id}`, playConfirmed)
        }
      }
      setData(d)
      setError('')
    } catch (e) {
      setError(e.message || 'Could not load submissions')
      setData((cur) => cur || EMPTY)
    }
  }, [classId])

  useEffect(() => { load() }, [load])

  const refresh = async () => {
    setRefreshing(true)
    try { await load() } finally { setRefreshing(false) }
  }

  // Live class: poll so new joiners and fresh uploads appear on their own.
  // Skipped while the tab is hidden — nothing to show anyone then.
  const isLive = data?.class?.status === 'live'
  // A "heard in class" request waiting on a student's answer → poll faster, so
  // the yes/no shows up within seconds rather than at the next 15 s tick.
  const waitingOnStudent = (data?.roster || []).some((r) => r.verbalCheck?.state === 'pending')
  useEffect(() => {
    if (!isLive) return undefined
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, waitingOnStudent ? 4_000 : 15_000)
    return () => clearInterval(t)
  }, [isLive, load, waitingOnStudent])

  // Push: a student handing work in moves this class's pending count in the
  // provider (see LiveSessionProvider.onHandEvent) — reload right away rather
  // than waiting for the poll. The count is compared against what this page
  // last acted on, so the initial render doesn't double-load.
  const pushPending = subCounts[classId]?.pending
  const [seenPush, setSeenPush] = useState(pushPending)
  useEffect(() => {
    if (seenPush === pushPending) return
    setSeenPush(pushPending)
    load()
  }, [pushPending, seenPush, load])

  const sorted = useMemo(() => sortRoster(data?.roster || []), [data])
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sorted.filter((r) => {
      if (filter === 'pending'  && !isPending(r)) return false
      if (filter === 'reviewed' && stateOf(r) !== 'reviewed') return false
      if (filter === 'missing'  && r.submission) return false
      if (needle && !`${r.name || ''} ${r.phone || ''}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [sorted, filter, q])

  // Laptop: something is always selected — the reviewer's pick while it's still
  // in view, else the first student waiting for review. Phone: only what was tapped.
  const selectedId = isDesktop
    ? (rows.some((r) => r.userId === activeId) ? activeId : ((rows.find(isPending) || rows[0])?.userId ?? null))
    : activeId
  const selected = rows.find((r) => r.userId === selectedId) || null

  // A review saved inside a row: patch that row in place (functional update, so
  // a poll that landed mid-save isn't clobbered). Marking reviewed moves on —
  // to the next student waiting on a laptop, or collapses the row on a phone —
  // so a reviewer working through twenty never hunts for the next one.
  const patchRow = (updated) => {
    const before = sorted.find((r) => r.submission?._id === updated._id)
    setData((d) => {
      if (!d) return d
      const roster = d.roster.map((r) => (r.submission?._id === updated._id ? { ...r, submission: updated } : r))
      return { ...d, roster, counts: recount(roster) }
    })
    if (before && updated.status === 'reviewed' && before.submission.status !== 'reviewed') {
      if (isDesktop) {
        const next = sorted.find((r) => isPending(r) && r.userId !== before.userId)
        setActiveId(next ? next.userId : before.userId)
      } else {
        setActiveId(null)
      }
    }
  }

  const cls    = data?.class
  const counts = data?.counts || EMPTY.counts
  const status = CLASS_STATUS[cls?.status] || null
  const workLabel = cls ? [cls.subject?.name, cls.chapter?.name, cls.unit?.name].filter(Boolean).join(' · ') : ''
  const where = cls ? [cls.room?.label, cls.track?.label].filter(Boolean).join(' · ') : ''

  // This page's class is the one running in the corner window → offer a way
  // back; a different class is running → say so, with a link to its page.
  const hostingThis  = session?.classId === classId
  const hostingOther = session && !hostingThis

  const tabs = [
    { k: 'all',      label: 'All',           n: sorted.length },
    { k: 'pending',  label: 'To review',     n: counts.pending },
    { k: 'reviewed', label: 'Reviewed',      n: counts.reviewed },
    { k: 'missing',  label: 'Not submitted', n: counts.notSubmitted },
  ]
  const toolbar = (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setFilter(t.k)}
            className={`flex-1 whitespace-nowrap text-[11px] font-semibold px-2 py-1.5 rounded-lg transition ${
              filter === t.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label} <span className={filter === t.k ? 'text-gray-500' : 'text-gray-400'}>{t.n}</span>
          </button>
        ))}
      </div>
      {sorted.length >= SEARCH_FROM && (
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or phone…"
          className="w-full text-sm text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"
        />
      )}
    </div>
  )

  const nothingInFilter = (
    <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">
      {q.trim() ? 'No student matches that search.'
        : filter === 'pending' ? 'Nothing waiting for review. 🎉'
        : filter === 'reviewed' ? 'Nothing reviewed yet.'
        : filter === 'missing' ? 'Everyone who joined has submitted. 🎉'
        : 'Nothing here.'}
    </div>
  )

  return (
    // Extra bottom padding while the room sits in its corner window, so the
    // last rows aren't hidden under it. Wider on laptops for the two columns.
    <div className={`p-4 md:p-8 max-w-4xl lg:max-w-6xl mx-auto ${session && minimized ? 'pb-60' : ''}`}>
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
        <Link to="/mentor/submissions" className="hover:text-gray-700">Submissions</Link>
        <span>›</span>
        <span className="text-gray-600 truncate">{cls?.title || 'Class'}</span>
      </div>

      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 truncate">{cls?.title || (data ? 'Class' : 'Loading…')}</h1>
            {status && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${status.cls}`}>
                {cls.status === 'live' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse mr-1 align-middle" />}
                {status.label}
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm mt-0.5">
            {[where, workLabel].filter(Boolean).join(' — ') || 'Who joined this class, who has handed in work, and who hasn\'t.'}
          </p>
          {cls?.startedAt && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              Started {fmtWhen(cls.startedAt)}{cls.endedAt ? ` · ended ${fmtTime(cls.endedAt)}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={refresh} disabled={refreshing}
            className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
          {/* Only ever seen while the room is minimized — full-screen, the
              room covers this page — so this is purely the way back. */}
          {hostingThis && minimized && (
            <button onClick={() => live.toggleMinimize()}
              className="px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-semibold hover:bg-black">
              ⤢ Back to class
            </button>
          )}
        </div>
      </div>

      {hostingOther && (
        <div className="mt-3 mb-1 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex items-center gap-2 flex-wrap">
          <span>You're currently hosting <b>{session.title}</b>{session.subtitle ? ` (${session.subtitle})` : ''}.</span>
          <Link to={`/mentor/submissions/${session.classId}`} className="font-semibold underline">See its submissions</Link>
        </div>
      )}

      {/* Counts — the point of the page: submitted vs not, at a glance. */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 mb-4">
          <Stat label="Joined" value={counts.joined}
            hint={isLive ? `${counts.inRoom} in the room now` : undefined} />
          <Stat label="Submitted" value={counts.submitted} tone="emerald"
            hint={counts.pending ? `${counts.pending} awaiting review` : counts.submitted ? 'all reviewed' : undefined} />
          <Stat label="Not submitted" value={counts.notSubmitted} tone={counts.notSubmitted ? 'red' : 'gray'} />
          <Stat label="Reviewed" value={counts.reviewed} />
        </div>
      )}

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {data === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !sorted.length ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">
            {isLive ? 'Nobody has joined yet' : 'Nobody joined this class'}
          </p>
          <p className="text-gray-400 text-sm">
            {isLive
              ? 'Students appear here as they join the room, and move to "Submitted" when they hand work in.'
              : 'Only students who joined the room, or handed work in, are listed.'}
          </p>
        </div>
      ) : isDesktop ? (
        // ── Laptop: list | detail ──
        // items-start keeps the aside its own height so sticky can work; the
        // list scrolls inside it, never the whole page, so the detail pane and
        // the counters stay put while the reviewer moves down twenty names.
        <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
          <aside className="sticky top-2 flex flex-col gap-2 max-h-[calc(100vh-1rem)]">
            {toolbar}
            <div className="bg-white rounded-2xl shadow-sm overflow-y-auto min-h-0 flex-1">
              {rows.length ? rows.map((r) => (
                <ListItem key={r.userId} row={r} selected={r.userId === selectedId} onClick={() => setActiveId(r.userId)} />
              )) : (
                <p className="p-6 text-center text-gray-400 text-sm">
                  {q.trim() ? 'No student matches that search.' : 'Nothing in this filter.'}
                </p>
              )}
            </div>
          </aside>
          <section className="min-w-0">
            {selected && (
              <HeardInClass key={`h-${selected.userId}`} row={selected} cls={cls} verbal={data?.verbal}
                onChanged={load} onError={setError} />
            )}
            {!selected ? (
              <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">
                Pick a student on the left.
              </div>
            ) : selected.submission ? (
              // colorScheme light: white card, so native inputs in the review
              // form don't follow an OS dark theme and render white-on-white.
              <div className="bg-white rounded-2xl shadow-sm p-2" style={{ colorScheme: 'light' }}>
                <SubmissionRow
                  key={selected.userId}
                  standalone
                  submission={selected.submission}
                  apiFetch={apiFetch}
                  basePath={BASE}
                  classId={classId}
                  btn={BTN}
                  onUpdated={patchRow}
                  onError={setError}
                  extraChips={<PresenceChip row={selected} isLive={isLive} />}
                />
              </div>
            ) : (
              <MissingDetail row={selected} isLive={isLive} />
            )}
          </section>
        </div>
      ) : (
        // ── Phone / tablet: sticky filter bar + accordion ──
        <>
          <div className="sticky top-0 z-10 -mx-4 md:-mx-8 px-4 md:px-8 py-2 bg-gray-50/95 backdrop-blur mb-2">
            {toolbar}
          </div>
          {!rows.length ? nothingInFilter : (
            <div className="bg-white rounded-2xl shadow-sm p-3 space-y-2" style={{ colorScheme: 'light' }}>
              {rows.map((r) => r.submission ? (
                <div key={r.userId}>
                  <SubmissionRow
                    submission={r.submission}
                    open={activeId === r.userId}
                    onToggle={() => setActiveId(activeId === r.userId ? null : r.userId)}
                    apiFetch={apiFetch}
                    basePath={BASE}
                    classId={classId}
                    btn={BTN}
                    onUpdated={patchRow}
                    onError={setError}
                    extraChips={<PresenceChip row={r} isLive={isLive} />}
                  />
                  <HeardInClass compact row={r} cls={cls} verbal={data?.verbal} onChanged={load} onError={setError} />
                </div>
              ) : (
                <div key={r.userId}>
                  <MissingRow row={r} isLive={isLive} />
                  <HeardInClass compact row={r} cls={cls} verbal={data?.verbal} onChanged={load} onError={setError} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const STAT_TONE = {
  gray:    'text-gray-900',
  emerald: 'text-emerald-600',
  red:     'text-red-600',
}

function Stat({ label, value, hint, tone = 'gray' }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm px-4 py-3">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold leading-tight ${STAT_TONE[tone] || STAT_TONE.gray}`}>{value}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{hint}</p>}
    </div>
  )
}

const initialOf = (name) => (name || '?').trim()[0]?.toUpperCase() || '?'

// One line in the laptop's student list: who, where they stand, and enough to
// pick the next one without opening it (files, marks, in the room or not).
function ListItem({ row, selected, onClick }) {
  const st = ROW_STATE[stateOf(row)]
  const s = row.submission
  const graded = s ? s.files.filter((f) => f.review).length : 0
  const meta = s
    ? `${s.files.length} file${s.files.length === 1 ? '' : 's'}${graded ? ` (${graded} graded)` : ''} · ${fmtTime(s.lastFileAt)}`
    : row.firstJoin ? `Joined ${fmtTime(row.firstJoin)}` : 'Never joined'
  return (
    <button onClick={onClick} aria-current={selected ? 'true' : undefined}
      className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-gray-100 last:border-0 transition ${
        selected ? 'bg-teal-50' : 'hover:bg-gray-50'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${st.avatar}`}>
        {initialOf(row.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm truncate ${selected ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>
            {row.name || 'Student'}
          </span>
          {row.live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" title="In the room now" />}
        </div>
        <p className="text-[11px] text-gray-400 truncate">
          <span className={`font-semibold ${st.chip.split(' ')[1]}`}>{st.label}</span> · {meta}
        </p>
      </div>
      {s?.marks != null && (
        <span className="text-xs font-bold text-gray-900 flex-shrink-0">
          {s.marks}{s.totalMarks != null ? `/${s.totalMarks}` : ''}
        </span>
      )}
    </button>
  )
}

// Where the student is relative to the room: still in it, left, or never
// joined (submitted from the after-class window). Green dot = in the room.
function PresenceChip({ row, isLive }) {
  if (row.live) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 uppercase"
        title={`In the room now · joined ${fmtTime(row.firstJoin)}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />in room
      </span>
    )
  }
  if (row.joined) {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase"
        title={`Joined ${fmtTime(row.firstJoin)} · left ${fmtTime(row.lastLeave)} · ${fmtDur(row.totalMs)} in class`}>
        {isLive ? 'left' : `${fmtDur(row.totalMs)} in class`}
      </span>
    )
  }
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 uppercase"
      title="Handed work in without joining the room (after-class window)">
      didn't join
    </span>
  )
}

// A student who joined but hasn't handed anything in — the accordion row. No
// expand: there is nothing to open. Who, when they joined, still here or not.
function MissingRow({ row, isLive }) {
  return (
    <div className="rounded-xl border border-gray-200 border-dashed flex items-center gap-3 px-3 py-2.5">
      <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-sm font-bold flex-shrink-0">
        {initialOf(row.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 truncate">{row.name || 'Student'}</span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${ROW_STATE.missing.chip}`}>Not submitted</span>
          <PresenceChip row={row} isLive={isLive} />
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {row.firstJoin ? `Joined ${fmtTime(row.firstJoin)}` : 'Never joined'}
          {row.sessionCount > 1 ? ` · ${row.sessionCount} joins` : ''}
          {row.phone ? ` · ${row.phone}` : ''}
        </p>
      </div>
      <span className="text-gray-300 text-lg flex-shrink-0" aria-hidden="true">—</span>
    </div>
  )
}

// The same student in the laptop's detail pane.
function MissingDetail({ row, isLive }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xl font-bold mx-auto mb-3">
        {initialOf(row.name)}
      </div>
      <p className="text-gray-900 font-semibold">{row.name || 'Student'}</p>
      {row.phone && <p className="text-xs text-gray-400">{row.phone}</p>}
      <div className="flex items-center justify-center gap-2 mt-3">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${ROW_STATE.missing.chip}`}>Not submitted</span>
        <PresenceChip row={row} isLive={isLive} />
      </div>
      <p className="text-sm text-gray-500 mt-4">
        {isLive
          ? 'Nothing handed in yet. This page updates on its own when they submit.'
          : 'Nothing was handed in for this class.'}
      </p>
      <p className="text-[11px] text-gray-400 mt-2">
        {row.firstJoin ? `Joined ${fmtTime(row.firstJoin)}` : 'Never joined the room'}
        {row.lastLeave && !row.live ? ` · left ${fmtTime(row.lastLeave)}` : ''}
        {row.totalMs ? ` · ${fmtDur(row.totalMs)} in class` : ''}
        {row.sessionCount > 1 ? ` · ${row.sessionCount} joins` : ''}
      </p>
    </div>
  )
}

// ── "Heard in class" ─────────────────────────────────────────────────────────
// The host records that this student explained their work out loud. Nothing
// counts until the student taps "Yes" on their own screen; the server checks
// that the class is live and the student is actually connected, both times.
// Shows the latest request's state: waiting (with a countdown and Cancel),
// said no, or didn't answer.

const VERBAL_LABEL = {
  declined:  { text: 'Said no to "heard in class"', cls: 'text-red-600' },
  expired:   { text: "Didn't answer the confirmation in time", cls: 'text-gray-500' },
  cancelled: { text: 'Request cancelled', cls: 'text-gray-400' },
}

function useSecondsLeft(until) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  return until ? Math.max(0, Math.round((new Date(until).getTime() - now) / 1000)) : 0
}

function HeardInClass({ row, cls, verbal, onChanged, onError, compact = false }) {
  const [asking, setAsking] = useState(false)   // confirm box open
  const [note, setNote]     = useState('')
  const [busy, setBusy]     = useState(false)
  const check = row.verbalCheck
  const pending = check?.state === 'pending' ? check : null
  const left = useSecondsLeft(pending?.expiresAt)

  const open = !!verbal?.open
  const spoken = (row.submission?.files || []).filter((f) => f.kind === 'verbal').length
  const atLimit = verbal?.maxPerStudent != null && spoken >= verbal.maxPerStudent
  const canMark = open && row.live && !pending && !atLimit
  const recent = check && check.state !== 'pending' && check.state !== 'confirmed' && open ? VERBAL_LABEL[check.state] : null

  if (!open && !compact) return null
  if (compact && !pending && !canMark && !recent) return null

  const chapter = cls?.chapter?.name || cls?.subject?.name || ''
  const send = async () => {
    setBusy(true)
    try {
      await apiFetch(`${BASE}/${cls._id}/submissions/verbal`, {
        method: 'POST',
        body: JSON.stringify({ studentId: row.userId, note: note.trim() }),
      })
      setAsking(false); setNote('')
      await onChanged()
    } catch (e) {
      onError(e.message || 'Could not send')
    } finally {
      setBusy(false)
    }
  }
  const cancel = async () => {
    setBusy(true)
    try {
      await apiFetch(`${BASE}/${cls._id}/submissions/verbal/${pending._id}`, { method: 'DELETE' })
      await onChanged()
    } catch (e) {
      onError(e.message || 'Could not cancel')
    } finally {
      setBusy(false)
    }
  }

  const box = compact ? 'mt-1.5 rounded-xl px-3 py-2' : 'mb-3 rounded-2xl shadow-sm px-4 py-3'

  if (pending) {
    return (
      <div className={`${box} bg-amber-50 border border-amber-200 flex items-center gap-2 flex-wrap text-xs text-amber-800`}>
        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
        <span className="flex-1 min-w-0">
          Waiting for <b>{row.name || 'the student'}</b> to confirm on their screen…
          {left > 0 ? ` ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}
        </span>
        <button onClick={cancel} disabled={busy}
          className="font-semibold underline disabled:opacity-50">Cancel</button>
      </div>
    )
  }

  if (asking) {
    return (
      <div className={`${box} bg-white border border-teal-200`}>
        <p className="text-sm text-gray-800">
          Mark that <b>{row.name || 'this student'}</b> explained {chapter ? <b>{chapter}</b> : 'their work'} to you out loud?
        </p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          They'll be asked to confirm on their screen. It counts as handed in only when they say yes.
        </p>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
          placeholder="Optional note (e.g. which question)"
          className="mt-2 w-full text-sm text-gray-900 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-teal-400" />
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={() => setAsking(false)} disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100">Back</button>
          <button onClick={send} disabled={busy}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white ${BTN} disabled:opacity-50`}>
            {busy ? 'Sending…' : 'Ask student to confirm'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`${box} ${compact ? '' : 'bg-white'} flex items-center gap-2 flex-wrap`}>
      {recent && <span className={`text-[11px] flex-1 min-w-0 ${recent.cls}`}>{recent.text} · {fmtTime(check.respondedAt)}</span>}
      {!recent && !compact && (
        <span className="text-[11px] text-gray-500 flex-1 min-w-0">
          {!row.live ? 'Student must be in the room to mark work explained in class.'
            : atLimit ? `This student has reached the limit of ${verbal.maxPerStudent} spoken entries.`
            : 'Did they explain their work to you out loud?'}
        </span>
      )}
      {canMark && (
        <button onClick={() => setAsking(true)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-teal-300 text-teal-700 hover:bg-teal-50 flex-shrink-0">
          🗣 Heard in class
        </button>
      )}
    </div>
  )
}
