import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../api'
import { useLiveSession } from '../../components/LiveSessionProvider'

// The Submissions page, class by class. One card per class — how many
// students handed work in, how many still wait on a review, how many joined —
// and each card opens that class's own page (MentorClassSubmissionsPage):
// every student who joined, submitted or not, with the review forms. No
// modals anywhere on this path.
//
//   Needs review     — classes with work waiting on the mentor (the default:
//                      the question a mentor starts the day with)
//   With submissions — every class anyone submitted to, latest hand-in first
//   All classes      — every class that has run, live ones on top, so a
//                      class where nobody submitted can still be opened to
//                      see who joined and didn't hand anything in

const VIEWS = [
  { k: 'pending',   label: 'Needs review' },
  { k: 'submitted', label: 'With submissions' },
  { k: 'all',       label: 'All classes' },
]

const fmtWhen = (d) => (d ? new Date(d).toLocaleString(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}) : '')

const EMPTY = { classes: [], total: 0, totalPages: 1, pendingClasses: 0 }

export default function MentorSubmissionsPage() {
  const [data, setData]   = useState(null)
  const [view, setView]   = useState('pending')
  const [q, setQ]         = useState('')
  const [needle, setNeedle] = useState('')   // q, debounced — what's actually queried
  const [page, setPage]   = useState(1)
  const [error, setError] = useState('')
  const live = useLiveSession()
  const session   = live?.session || null
  const minimized = !!live?.minimized

  // Type-ahead without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setNeedle(q.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    try {
      const d = await apiFetch(
        `/api/mentor/class-submissions/classes?view=${view}&page=${page}&limit=20${needle ? `&q=${encodeURIComponent(needle)}` : ''}`,
      )
      setData(d)
      setError('')
    } catch (e) {
      setError(e.message || 'Could not load submissions')
      setData(EMPTY)
    }
  }, [view, page, needle])

  useEffect(() => { load() }, [load])

  // Minimizing the class brings this page back into view mid-session — the
  // counts have usually moved since it was last looked at.
  useEffect(() => { if (minimized) load() }, [minimized, load])

  const switchView = (k) => { setView(k); setPage(1) }

  const pendingBadge = data?.pendingClasses || 0

  return (
    // Bottom padding keeps the last card clear of the minimized class window.
    <div className={`p-4 md:p-8 max-w-4xl mx-auto ${session && minimized ? 'pb-60' : ''}`}>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Submissions</h1>
      <p className="text-gray-400 text-sm mb-5">
        Work handed in during your live classes, class by class. Open a class to see who submitted, who didn't, and to review.
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl overflow-x-auto sm:max-w-md sm:flex-1">
          {VIEWS.map((t) => (
            <button key={t.k} onClick={() => switchView(t.k)}
              className={`flex-1 whitespace-nowrap text-xs font-semibold px-3 py-2 rounded-lg transition ${
                view === t.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
              {t.k === 'pending' && pendingBadge > 0 && (
                <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">{pendingBadge}</span>
              )}
            </button>
          ))}
        </div>
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search class title…"
          className="sm:w-64 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"
        />
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {data === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !data.classes.length ? (
        <EmptyState view={view} needle={needle} />
      ) : (
        <div className="space-y-2">
          {data.classes.map((c) => (
            <ClassCard key={c._id} cls={c} hostingNow={session?.classId === c._id} />
          ))}
        </div>
      )}

      {data?.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-5">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40">
            Previous
          </button>
          <span className="text-xs text-gray-500">Page {page} of {data.totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages}
            className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function EmptyState({ view, needle }) {
  const [title, body] = needle
    ? [`No class matches "${needle}"`, 'Try a different word from the class title.']
    : view === 'pending'
      ? ['Nothing waiting on you', 'When a student submits work in one of your classes, it lands here.']
      : view === 'submitted'
        ? ['No submissions yet', 'Classes show up here once a student hands something in.']
        : ['No classes have run yet', 'Every class you host appears here once it has started.']
  return (
    <div className="bg-white rounded-2xl p-8 text-center">
      <p className="text-gray-700 font-semibold mb-1">{title}</p>
      <p className="text-gray-400 text-sm">{body}</p>
    </div>
  )
}

// One class. The whole card is the link; the right-hand side says at a glance
// whether anything is waiting, and how many of those who joined handed in.
function ClassCard({ cls: c, hostingNow }) {
  const { total, pending, joined } = c.counts
  const where = [c.room?.label, c.track?.label].filter(Boolean).join(' · ')
  const work  = [c.subject?.name, c.chapter?.name, c.unit?.name].filter(Boolean).join(' · ')
  const when  = fmtWhen(c.startedAt || c.scheduledStart)

  const verdict = pending > 0
    ? { label: `${pending} to review`, cls: 'bg-amber-100 text-amber-700' }
    : total > 0
      ? { label: 'All reviewed', cls: 'bg-emerald-100 text-emerald-700' }
      : { label: 'No submissions', cls: 'bg-gray-100 text-gray-500' }

  return (
    <Link to={`/mentor/submissions/${c._id}`}
      className="block bg-white rounded-2xl shadow-sm p-4 hover:shadow-md transition">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {c.status === 'live' && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />live
              </span>
            )}
            <p className="text-sm font-semibold text-gray-900 truncate">{c.title}</p>
            {hostingNow && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 uppercase">you're hosting</span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate mt-0.5">{[where, work].filter(Boolean).join(' — ')}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {when}{c.lastFileAt ? ` · last hand-in ${fmtWhen(c.lastFileAt)}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${verdict.cls}`}>{verdict.label}</span>
          <span className="text-[11px] text-gray-500 whitespace-nowrap">
            <b className="text-gray-900">{total}</b> submitted{joined ? ` · ${joined} joined` : ''}
          </span>
        </div>
        <span className="text-gray-300 text-lg flex-shrink-0" aria-hidden="true">›</span>
      </div>
    </Link>
  )
}
