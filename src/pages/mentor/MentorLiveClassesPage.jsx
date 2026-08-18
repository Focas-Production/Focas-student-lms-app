import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../../api'
import AttendanceModal from '../../components/AttendanceModal'
import SubmissionsModal from '../../components/SubmissionsModal'
import { useLiveSession } from '../../components/LiveSessionProvider'

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

// Mentors host what the admin books for them — they don't schedule. This page is
// their assignment list plus the controls to run a class.
//
// The room itself is NOT rendered here: it lives in LiveSessionProvider at the
// layout level, so a minimized class survives navigating to other mentor pages.
// This page starts/enters sessions through the context and reflects their state.
export default function MentorLiveClassesPage() {
  const [classes, setClasses]   = useState(null)
  const [loadError, setLoadError] = useState('')   // why the list is empty, if it failed
  const [busyId, setBusyId]     = useState(null)
  const [error, setError]       = useState('')
  const [syllabus, setSyllabus]     = useState(null) // subjects with chapter/unit completion
  const [attendance, setAttendance] = useState(null)
  const [submissions, setSubmissions] = useState(null) // { id, title } while the modal is open

  const { session, minimized, startOrEnter: enterSession, subCounts, setSubCounts } = useLiveSession()

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/api/live-classes/manage')
      setClasses(d.classes || [])
      setLoadError('')
    } catch (err) {
      // Never swallow this — an auth or network failure looked identical to
      // "nothing assigned", which is exactly the wrong thing to tell a mentor.
      setClasses([])
      setLoadError(err.message || 'Could not load your classes')
    }
  }, [])

  // Reload whenever the hosted session changes (started / switched track / left)
  // — this also covers first mount, and keeps the list current behind the room.
  useEffect(() => { load() }, [load, session?.token])

  // Minimizing brings this page back into view mid-class: statuses and
  // submission badges have usually moved since it was last looked at.
  useEffect(() => { if (minimized) load() }, [minimized, load])

  // Submission badges for every visible class in one request, rather than one
  // per card. Failing silently is right here — a missing badge is a cosmetic
  // loss, and an error banner over the class list would be misleading.
  const loadSubCounts = useCallback(async (list) => {
    const ids = (list || []).map((c) => c._id)
    if (!ids.length) return
    try {
      const d = await apiFetch(`/api/live-classes/manage/submission-counts?ids=${ids.join(',')}`)
      setSubCounts(d.counts || {})
    } catch { /* badge-only data */ }
  }, [setSubCounts])

  useEffect(() => { if (classes?.length) loadSubCounts(classes) }, [classes, loadSubCounts])

  const loadSyllabus = useCallback(() => {
    return apiFetch('/api/live-classes/manage/syllabus')
      .then(d => setSyllabus(d.subjects || []))
      .catch(() => setSyllabus([]))
  }, [])

  useEffect(() => { loadSyllabus() }, [loadSyllabus])

  // Toggle a chapter/unit's completed state. Server cascades chapter ↔ units.
  const toggleProgress = async (subjectId, chapterId, unitId, completed) => {
    setError('')
    try {
      await apiFetch(`/api/live-classes/manage/syllabus/${subjectId}/progress`, {
        method: 'POST',
        body: JSON.stringify({ chapterId, unitId: unitId || undefined, completed }),
      })
      await loadSyllabus()
    } catch (err) {
      setError(err.message || 'Could not update progress')
    }
  }

  // Completion state of the chapter/unit a class taught — for the quick-mark
  // button on ended class cards.
  const classProgress = (c) => {
    if (!c.chapter?.chapterId || !syllabus) return null
    const s = syllabus.find(x => String(x._id) === String(c.subject?.subjectId))
    const ch = s?.chapters?.find(x => String(x._id) === String(c.chapter.chapterId))
    if (!ch) return null
    if (c.unit?.unitId) {
      const u = (ch.units || []).find(x => String(x._id) === String(c.unit.unitId))
      return u ? { completed: u.completed, isUnit: true, subjectId: s._id, chapterId: ch._id, unitId: u._id } : null
    }
    return { completed: ch.completed, isUnit: false, subjectId: s._id, chapterId: ch._id, unitId: null }
  }

  const startOrEnter = async (cls) => {
    setBusyId(cls._id); setError('')
    try {
      await enterSession(cls)
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

  const openAttendance = async (cls) => {
    setAttendance({ id: cls._id, title: cls.title, roster: null, class: null, meta: null })
    try {
      const d = await apiFetch(`/api/live-classes/manage/${cls._id}/attendance`)
      setAttendance({ id: cls._id, title: cls.title, roster: d.roster || [], class: d.class || null, meta: d.attendance || null })
    } catch {
      setAttendance({ id: cls._id, title: cls.title, roster: [], class: null, meta: null })
    }
  }

  // Override a student's auto verdict (present / chapter completed) and patch the
  // open modal's roster in place with what the server settled on.
  const updateAttendanceRecord = async (userId, patch) => {
    try {
      const d = await apiFetch(`/api/live-classes/manage/${attendance.id}/attendance/${userId}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      })
      const rec = d.record
      setAttendance((a) => a && ({
        ...a,
        roster: a.roster.map((p) => String(p.userId) === String(userId)
          ? { ...p, record: { ...p.record, present: rec.present, presentSource: rec.presentSource, chapterCompleted: rec.chapterCompleted, chapterSource: rec.chapterSource, markedByName: rec.markedBy?.name || '' } }
          : p),
      }))
    } catch (err) {
      setError(err.message || 'Could not update attendance')
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Live Classes</h1>
      <p className="text-gray-400 text-sm mb-6">
        Classes your admin has assigned to you. Start one to go live with your students.
      </p>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {classes === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : loadError ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">Couldn't load your classes</p>
          <p className="text-red-500 text-sm mb-4">{loadError}</p>
          <button onClick={load}
            className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50">
            Try again
          </button>
        </div>
      ) : !classes.length ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">No classes assigned to you yet</p>
          <p className="text-gray-400 text-sm">When an admin schedules a class with you as host, it'll show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {classes.map((c) => (
            <div key={c._id} className="bg-white rounded-2xl shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${STATUS_STYLE[c.status] || ''}`}>
                    {c.status === 'live' ? '● live' : c.status}
                  </span>
                  {c.room?.label && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                      {c.room.label} · {c.track?.label}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-gray-900 truncate">{c.title}</p>
                {c.chapter?.name && (
                  <p className="text-xs text-indigo-500 truncate mt-0.5">
                    📖 {c.subject?.name ? `${c.subject.name} · ` : ''}{c.chapter.name}{c.unit?.name ? ` · ${c.unit.name}` : ''}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {fmtWhen(c.scheduledStart)}
                  {runDuration(c) && <span className="text-gray-500"> · ran {runDuration(c)}</span>}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                {/* After class: one click marks what it taught as completed */}
                {c.status === 'ended' && (() => {
                  const p = classProgress(c)
                  if (!p) return null
                  // Name exactly what gets marked — a bare "Completed" left it
                  // unclear whether the class, the unit, or the chapter was done.
                  const name = p.isUnit ? c.unit?.name : c.chapter?.name
                  const kind = p.isUnit ? 'unit' : 'chapter'
                  return (
                    <button onClick={() => toggleProgress(p.subjectId, p.chapterId, p.unitId, !p.completed)}
                      title={p.completed
                        ? `The ${kind} "${name}" is marked completed — click to unmark`
                        : `Mark the ${kind} "${name}" as completed`}
                      className={`px-3 py-2 rounded-xl text-sm font-semibold whitespace-nowrap border max-w-[180px] sm:max-w-[220px] truncate ${
                        p.completed
                          ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100'
                          : 'border-teal-300 text-teal-700 hover:bg-teal-50'}`}>
                      {p.completed ? `✓ ${name} completed` : `Mark "${name}" done`}
                    </button>
                  )
                })()}
                {(c.status === 'scheduled' || c.status === 'live') && (
                  <button onClick={() => startOrEnter(c)} disabled={busyId === c._id}
                    className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:bg-gray-300 whitespace-nowrap">
                    {busyId === c._id ? '…' : session?.classId === c._id ? 'Return' : c.status === 'live' ? 'Enter' : 'Start'}
                  </button>
                )}
                {c.status === 'live' && (
                  <button onClick={() => endClass(c)} disabled={busyId === c._id}
                    className="px-3 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 whitespace-nowrap">
                    End
                  </button>
                )}
                {(c.status === 'live' || c.status === 'ended') && (
                  <button onClick={() => openAttendance(c)}
                    className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 whitespace-nowrap">
                    Attendance
                  </button>
                )}
                {(c.status === 'live' || c.status === 'ended') && (
                  <button onClick={() => setSubmissions({ id: c._id, title: c.title })}
                    title="Student work handed in for this class"
                    className={`px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap ${
                      subCounts[c._id]?.pending
                        ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    Submissions
                    {subCounts[c._id]?.total > 0 && (
                      <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        subCounts[c._id].pending ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
                        {subCounts[c._id].pending || subCounts[c._id].total}
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Attendance modal */}
      {attendance && (
        <AttendanceModal title={attendance.title} roster={attendance.roster} classInfo={attendance.class}
          meta={attendance.meta} onToggleRecord={updateAttendanceRecord} onClose={() => setAttendance(null)} />
      )}

      {/* Student work handed in for this class */}
      {submissions && (
        <SubmissionsModal
          classId={submissions.id}
          title={submissions.title}
          apiFetch={apiFetch}
          accent="teal"
          onCountsChange={(counts) => setSubCounts((c) => ({ ...c, [submissions.id]: counts }))}
          onClose={() => setSubmissions(null)}
        />
      )}
    </div>
  )
}
