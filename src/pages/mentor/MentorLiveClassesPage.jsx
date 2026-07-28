import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { apiFetch } from '../../api'
import AttendanceModal from '../../components/AttendanceModal'

// Lazy-loaded so the LiveKit bundle only loads when the mentor actually hosts.
const LiveRoom = lazy(() => import('../../components/LiveRoom'))

function fmtWhen(d) {
  if (!d) return ''
  return new Date(d).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })
}

// How long the class ran on the clock: start → end (or → now if still live).
function runDuration(c) {
  if (!c.startedAt) return null
  const end = c.endedAt ? new Date(c.endedAt).getTime() : (c.status === 'live' ? Date.now() : null)
  if (!end) return null
  const m = Math.round((end - new Date(c.startedAt).getTime()) / 60000)
  const label = m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
  return c.status === 'live' ? `${label} so far` : label
}

const STATUS_STYLE = {
  scheduled: 'bg-sky-100 text-sky-700',
  live:      'bg-red-100 text-red-700',
  ended:     'bg-gray-100 text-gray-500',
  cancelled: 'bg-amber-100 text-amber-700',
}

export default function MentorLiveClassesPage() {
  const [classes, setClasses] = useState(null)
  const [form, setForm]       = useState({ title: '', description: '', scheduledStart: '', scheduledEnd: '' })
  const [saving, setSaving]   = useState(false)
  const [busyId, setBusyId]   = useState(null)
  const [error, setError]     = useState('')
  const [session, setSession] = useState(null)   // { token, wsUrl, title } while hosting
  const [attendance, setAttendance] = useState(null)  // { title, roster } modal

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/api/live-classes/manage')
      setClasses(d.classes || [])
    } catch {
      setClasses([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.scheduledStart) {
      setError('Title and start time are required'); return
    }
    setSaving(true); setError('')
    try {
      await apiFetch('/api/live-classes/manage', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          scheduledStart: new Date(form.scheduledStart).toISOString(),
          scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : undefined,
        }),
      })
      setForm({ title: '', description: '', scheduledStart: '', scheduledEnd: '' })
      await load()
    } catch (err) {
      setError(err.message || 'Could not create class')
    } finally {
      setSaving(false)
    }
  }

  const startOrEnter = async (cls) => {
    setBusyId(cls._id); setError('')
    try {
      // "start" flips it live and returns a host token; if already live it re-issues one.
      const path = cls.status === 'live'
        ? `/api/live-classes/manage/${cls._id}/host-token`
        : `/api/live-classes/manage/${cls._id}/start`
      const method = cls.status === 'live' ? 'GET' : 'POST'
      const d = await apiFetch(path, { method })
      setSession({ token: d.token, wsUrl: d.wsUrl, title: d.liveClass?.title || cls.title })
    } catch (err) {
      setError(err.message || 'Could not start the class')
    } finally {
      setBusyId(null)
    }
  }

  const endClass = async (cls) => {
    if (!confirm('End this class for everyone?')) return
    setBusyId(cls._id)
    try { await apiFetch(`/api/live-classes/manage/${cls._id}/end`, { method: 'POST' }); await load() }
    catch (err) { setError(err.message) }
    finally { setBusyId(null) }
  }

  const cancelClass = async (cls) => {
    if (!confirm('Cancel this scheduled class?')) return
    setBusyId(cls._id)
    try { await apiFetch(`/api/live-classes/manage/${cls._id}/cancel`, { method: 'POST' }); await load() }
    catch (err) { setError(err.message) }
    finally { setBusyId(null) }
  }

  const openAttendance = async (cls) => {
    setAttendance({ title: cls.title, roster: null, class: null })
    try {
      const d = await apiFetch(`/api/live-classes/manage/${cls._id}/attendance`)
      setAttendance({ title: cls.title, roster: d.roster || [], class: d.class || null })
    } catch {
      setAttendance({ title: cls.title, roster: [], class: null })
    }
  }

  const leave = () => { setSession(null); load() }

  if (session) {
    return (
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0b0b0f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>Loading class…</div>}>
        <LiveRoom token={session.token} wsUrl={session.wsUrl} canHost title={session.title} onLeave={leave} />
      </Suspense>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Live Classes</h1>
      <p className="text-gray-400 text-sm mb-6">Schedule a session and go live with your students.</p>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {/* Schedule form */}
      <form onSubmit={create} className="bg-white rounded-2xl shadow-sm p-5 mb-6 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Class title</label>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Advanced Accounting — AS 4 revision"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-400" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description (optional)</label>
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-400" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Starts at</label>
            <input type="datetime-local" value={form.scheduledStart}
              onChange={e => setForm({ ...form, scheduledStart: e.target.value })}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Ends at (optional)</label>
            <input type="datetime-local" value={form.scheduledEnd}
              onChange={e => setForm({ ...form, scheduledEnd: e.target.value })}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
        </div>
        <button type="submit" disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:bg-gray-300">
          {saving ? 'Scheduling…' : 'Schedule class'}
        </button>
      </form>

      {/* My classes */}
      {classes === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !classes.length ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">No classes scheduled yet.</div>
      ) : (
        <div className="space-y-3">
          {classes.map((c) => (
            <div key={c._id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${STATUS_STYLE[c.status] || ''}`}>
                    {c.status === 'live' ? '● live' : c.status}
                  </span>
                </div>
                <p className="text-sm font-semibold text-gray-900 truncate">{c.title}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {fmtWhen(c.scheduledStart)}
                  {runDuration(c) && <span className="text-gray-500"> · ran {runDuration(c)}</span>}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {(c.status === 'scheduled' || c.status === 'live') && (
                  <button onClick={() => startOrEnter(c)} disabled={busyId === c._id}
                    className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:bg-gray-300 whitespace-nowrap">
                    {busyId === c._id ? '…' : c.status === 'live' ? 'Enter' : 'Start'}
                  </button>
                )}
                {c.status === 'live' && (
                  <button onClick={() => endClass(c)} disabled={busyId === c._id}
                    className="px-3 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 whitespace-nowrap">
                    End
                  </button>
                )}
                {c.status === 'scheduled' && (
                  <button onClick={() => cancelClass(c)} disabled={busyId === c._id}
                    className="px-3 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold hover:bg-gray-50 whitespace-nowrap">
                    Cancel
                  </button>
                )}
                {(c.status === 'live' || c.status === 'ended') && (
                  <button onClick={() => openAttendance(c)}
                    className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 whitespace-nowrap">
                    Attendance
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Attendance modal */}
      {attendance && (
        <AttendanceModal title={attendance.title} roster={attendance.roster} classInfo={attendance.class} onClose={() => setAttendance(null)} />
      )}
    </div>
  )
}
