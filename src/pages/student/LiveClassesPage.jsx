import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { apiFetch } from '../../api'

// Lazy-loaded so the ~1.4 MB LiveKit bundle is only fetched when a student
// actually joins a class, not on every page visit.
const LiveRoom = lazy(() => import('../../components/LiveRoom'))
// Same reasoning for the recorder — only loaded when work is actually submitted.
const SubmitWorkPanel = lazy(() => import('../../components/SubmitWorkPanel'))

function fmtWhen(d) {
  if (!d) return ''
  return new Date(d).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function LiveClassesPage() {
  const [classes, setClasses] = useState(null)
  const [session, setSession] = useState(null)   // { classId, token, wsUrl, title } while in a room
  const [joining, setJoining] = useState(null)    // id being joined
  const [error, setError]     = useState('')
  const [handRaised, setHandRaised] = useState(false)
  const [submitFor, setSubmitFor] = useState(null)  // { id, title } while the panel is open

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/api/live-classes')
      setClasses(d.classes || [])
    } catch {
      setClasses([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Refresh every 20s so a class flips to "Join now" shortly after the host starts it.
  useEffect(() => {
    if (session) return                 // pause polling while in a call
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
  }, [load, session])

  const join = async (cls) => {
    setJoining(cls._id); setError('')
    try {
      const d = await apiFetch(`/api/live-classes/${cls._id}/join-token`)
      setHandRaised(false)   // the server drops any stale hand on (re)join
      setSession({
        classId: cls._id,
        token: d.token,
        wsUrl: d.wsUrl,
        title: d.liveClass?.title || cls.title,
        subtitle: [d.liveClass?.roomLabel, d.liveClass?.trackLabel].filter(Boolean).join(' · '),
      })
    } catch (e) {
      setError(e.message || 'Could not join the class')
    } finally {
      setJoining(null)
    }
  }

  const leave = () => { setSession(null); setHandRaised(false); load() }

  // 🖐 toggle — the server notifies the host, even when they're currently
  // teaching in the other track of the room.
  const toggleHand = async () => {
    const next = !handRaised
    try {
      await apiFetch(`/api/live-classes/${session.classId}/hand`, {
        method: 'POST', body: JSON.stringify({ raised: next }),
      })
      setHandRaised(next)
    } catch {
      // Best-effort — a failed raise just leaves the button as it was.
    }
  }

  if (session) {
    return (
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0b0b0f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>Loading class…</div>}>
        <LiveRoom
          token={session.token}
          wsUrl={session.wsUrl}
          canHost={false}
          title={session.title}
          subtitle={session.subtitle}
          onRaiseHand={toggleHand}
          handRaised={handRaised}
          submitClass={{ id: session.classId, title: session.title }}
          onLeave={leave}
        />
      </Suspense>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Live Classes</h1>
        <p className="text-gray-400 text-sm mt-1">Join your live sessions with mentors. Classes appear here once scheduled.</p>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {classes === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !classes.length ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">No live classes scheduled</p>
          <p className="text-gray-400 text-sm">When a mentor schedules a class, it'll show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {classes.map((c) => {
            const live = c.status === 'live'
            const ended = c.status === 'ended'
            return (
              <div key={c._id} className="bg-white rounded-2xl shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      live ? 'bg-red-100 text-red-700'
                        : ended ? 'bg-gray-100 text-gray-500'
                        : 'bg-sky-100 text-sky-700'}`}>
                      {live ? '● LIVE' : ended ? 'Ended' : 'Upcoming'}
                    </span>
                    {c.roomLabel && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                        {c.roomLabel} · {c.trackLabel}
                      </span>
                    )}
                    {c.hostName && <span className="text-[11px] text-gray-400">with {c.hostName}</span>}
                  </div>
                  <p className="text-sm font-semibold text-gray-900 truncate">{c.title}</p>
                  {c.chapterName && (
                    <p className="text-xs text-indigo-500 truncate mt-0.5">
                      📖 {c.subjectName ? `${c.subjectName} · ` : ''}{c.chapterName}{c.unitName ? ` · ${c.unitName}` : ''}
                    </p>
                  )}
                  {c.description && <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{c.description}</p>}
                  <p className="text-xs text-gray-400 mt-1">{fmtWhen(c.scheduledStart)}</p>
                </div>

                <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto">
                  {/* Hand work in without rejoining — the class stays here for
                      the whole submission window after it ends. */}
                  {c.submissionOpen && (
                    <button onClick={() => setSubmitFor({ id: c._id, title: c.title })}
                      className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-teal-300 text-teal-700 text-sm font-semibold hover:bg-teal-50 whitespace-nowrap">
                      📎 Submit work
                    </button>
                  )}
                  {live ? (
                    <button onClick={() => join(c)} disabled={joining === c._id}
                      className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 whitespace-nowrap">
                      {joining === c._id ? 'Joining…' : 'Join now'}
                    </button>
                  ) : !ended ? (
                    <span className="flex-1 sm:flex-none text-center px-4 py-2.5 rounded-xl bg-gray-100 text-gray-400 text-sm font-semibold whitespace-nowrap">
                      Not started
                    </span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {submitFor && (
        <Suspense fallback={null}>
          <SubmitWorkPanel
            classId={submitFor.id}
            classTitle={submitFor.title}
            onClose={() => { setSubmitFor(null); load() }}
          />
        </Suspense>
      )}
    </div>
  )
}
