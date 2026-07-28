import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { apiFetch } from '../../api'

// Lazy-loaded so the ~1.4 MB LiveKit bundle is only fetched when a student
// actually joins a class, not on every page visit.
const LiveRoom = lazy(() => import('../../components/LiveRoom'))

function fmtWhen(d) {
  if (!d) return ''
  return new Date(d).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function LiveClassesPage() {
  const [classes, setClasses] = useState(null)
  const [session, setSession] = useState(null)   // { token, wsUrl, title } while in a room
  const [joining, setJoining] = useState(null)    // id being joined
  const [error, setError]     = useState('')

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
      setSession({ token: d.token, wsUrl: d.wsUrl, title: d.liveClass?.title || cls.title })
    } catch (e) {
      setError(e.message || 'Could not join the class')
    } finally {
      setJoining(null)
    }
  }

  const leave = () => { setSession(null); load() }

  if (session) {
    return (
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0b0b0f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>Loading class…</div>}>
        <LiveRoom
          token={session.token}
          wsUrl={session.wsUrl}
          canHost={false}
          title={session.title}
          onLeave={leave}
        />
      </Suspense>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Live Classes</h1>
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
            return (
              <div key={c._id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      live ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'}`}>
                      {live ? '● LIVE' : 'Upcoming'}
                    </span>
                    {c.hostName && <span className="text-[11px] text-gray-400">with {c.hostName}</span>}
                  </div>
                  <p className="text-sm font-semibold text-gray-900 truncate">{c.title}</p>
                  {c.description && <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{c.description}</p>}
                  <p className="text-xs text-gray-400 mt-1">{fmtWhen(c.scheduledStart)}</p>
                </div>

                {live ? (
                  <button onClick={() => join(c)} disabled={joining === c._id}
                    className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 whitespace-nowrap">
                    {joining === c._id ? 'Joining…' : 'Join now'}
                  </button>
                ) : (
                  <span className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-400 text-sm font-semibold whitespace-nowrap">
                    Not started
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
