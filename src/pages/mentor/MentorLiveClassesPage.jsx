import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { apiFetch } from '../../api'
import { groupRoomSlots, slotPrimaryClass, trackLabelOf } from '../../utils/roomSlots'
import AttendanceModal from '../../components/AttendanceModal'
import SubmissionsModal from '../../components/SubmissionsModal'
import ScheduleCalendar from '../../components/ScheduleCalendar'
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

// Checklist of everything one ended session finished: the booked chapter/unit
// plus anything else the host got through — a quick class can close out its
// chapter and start the next. Ticking an extra item marks it completed in
// syllabus progress AND ties this class's attendance to it, so students who
// were present get it completed automatically. The booked item just toggles
// its syllabus flag — the class teaches it by definition.
function CoveredModal({ cls, subject, busyKey, error, onToggle, onClose }) {
  const primaryChapterId = String(cls.chapter?.chapterId || '')
  const primaryUnitId = String(cls.unit?.unitId || '')
  const isPrimary = (chId, uId) => String(chId) === primaryChapterId && String(uId || '') === primaryUnitId
  const isExtra = (chId, uId) => (cls.extraItems || []).some((x) =>
    String(x.chapter?.chapterId) === String(chId) && String(x.unit?.unitId || '') === String(uId || ''))

  const row = (ch, u) => {
    const chId = ch._id, uId = u?._id
    const doc = u || ch
    const primary = isPrimary(chId, uId)
    const coveredHere = primary ? !!doc.completed : isExtra(chId, uId)
    const key = `${chId}:${uId || ''}`
    return (
      <label key={key}
        className={`flex items-center gap-2.5 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-gray-50 ${u ? 'ml-6' : ''}`}>
        <input type="checkbox" checked={coveredHere} disabled={!!busyKey}
          onChange={() => onToggle(chId, uId || null, primary, !coveredHere)}
          className="w-4 h-4 accent-teal-600 flex-shrink-0" />
        <span className={`text-sm min-w-0 truncate ${u ? 'text-gray-600' : 'font-semibold text-gray-800'}`}>{doc.name}</span>
        {primary && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 uppercase flex-shrink-0">scheduled</span>
        )}
        {!coveredHere && doc.completed && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 flex-shrink-0"
            title="Already marked completed (in another session)">✓ done</span>
        )}
        {busyKey === key && <span className="text-xs text-gray-400 flex-shrink-0">…</span>}
      </label>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900">What did this class finish?</p>
            <p className="text-xs text-gray-400 truncate">{cls.subject?.name || cls.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="p-4 overflow-y-auto">
          {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
          {!subject ? (
            <p className="text-sm text-gray-400 text-center py-4">Couldn't load this subject's syllabus — try reloading.</p>
          ) : !(subject.chapters || []).length ? (
            <p className="text-sm text-gray-400 text-center py-4">This subject has no chapters yet.</p>
          ) : (
            <div className="space-y-0.5">
              {subject.chapters.map((ch) => (
                <Fragment key={ch._id}>
                  {row(ch)}
                  {(ch.units || []).map((u) => row(ch, u))}
                </Fragment>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
            Tick every chapter or unit this session completed. Ticked items are marked done in
            syllabus progress, and each student who attended enough of the class gets them
            completed automatically. Unticking undoes both.
          </p>
        </div>
      </div>
    </div>
  )
}

const StatusPill = ({ status }) => (
  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${STATUS_STYLE[status] || ''}`}>
    {status === 'live' ? '● live' : status}
  </span>
)

// What one class teaches — the booked chapter/unit, plus anything extra it finished.
function ClassMeta({ c }) {
  return (
    <>
      {c.chapter?.name && (
        <p className="text-xs text-indigo-500 truncate mt-0.5">
          📖 {c.subject?.name ? `${c.subject.name} · ` : ''}{c.chapter.name}{c.unit?.name ? ` · ${c.unit.name}` : ''}
        </p>
      )}
      {c.extraItems?.length > 0 && (
        <p className="text-xs text-teal-600 truncate mt-0.5"
          title={c.extraItems.map((x) => x.unit?.name ? `${x.chapter?.name} · ${x.unit.name}` : x.chapter?.name).join(', ')}>
          ✓ also finished: {c.extraItems.map((x) => x.unit?.name || x.chapter?.name).filter(Boolean).join(', ')}
        </p>
      )}
    </>
  )
}

// End / Attendance / Submissions for one track's class — only once it's live or over.
function TrackActions({ cls, busyId, subCount, compact = false, onEnd, onAttendance, onSubmissions }) {
  if (cls.status !== 'live' && cls.status !== 'ended') return null
  const size = compact ? 'px-3 py-1.5 text-xs' : 'px-3 py-2 text-sm'
  return (
    <>
      {cls.status === 'live' && (
        <button onClick={() => onEnd(cls)} disabled={busyId === cls._id}
          className={`${size} rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50 whitespace-nowrap`}>
          End
        </button>
      )}
      <button onClick={() => onAttendance(cls)}
        className={`${size} rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 whitespace-nowrap`}>
        Attendance
      </button>
      <button onClick={() => onSubmissions(cls)}
        title="Student work handed in for this class"
        className={`${size} rounded-xl border font-semibold whitespace-nowrap ${
          subCount?.pending
            ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
            : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
        Submissions
        {subCount?.total > 0 && (
          <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            subCount.pending ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
            {subCount.pending || subCount.total}
          </span>
        )}
      </button>
    </>
  )
}

// The controls for one room slot (see utils/roomSlots.js). A mentor hosts a
// ROOM: one Start / Enter / Return button gets them in — Track 1 first, or
// whichever track is already live — and they switch tracks from inside. The
// per-track controls (End, Attendance, Submissions) follow, unless the caller
// lays those out itself. The list cards and every calendar surface (live
// strip, agenda rows, detail modal) render this same component.
//   compact     small buttons, the room button only (calendar rows)
//   showTracks  false → the caller renders the per-track controls
function MentorSlotActions({ slot, busyId, sessionClassId, subCounts = {}, compact = false, showTracks = true,
  onStart, onEnd, onAttendance, onSubmissions }) {
  const primary = slotPrimaryClass(slot, sessionClassId)
  const ran = slot.classes.filter((c) => c.status === 'live' || c.status === 'ended')
  const tracksHere = showTracks && !compact && ran.length > 0
  const liveSingle = compact && !slot.isGroup && slot.status === 'live'
  if (!primary && !tracksHere && !liveSingle) return null

  const busy = !!primary && busyId === primary._id
  const size = compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
  const trackProps = { busyId, compact, onEnd, onAttendance, onSubmissions }
  return (
    <>
      {primary && (
        <button onClick={() => onStart(primary)} disabled={busy}
          title={slot.isGroup ? `Opens ${trackLabelOf(primary)} — switch tracks from inside the room` : undefined}
          className={`${size} rounded-xl bg-teal-600 text-white font-semibold hover:bg-teal-700 disabled:bg-gray-300 whitespace-nowrap`}>
          {busy ? '…' : primary._id === sessionClassId ? 'Return' : primary.status === 'live' ? 'Enter' : 'Start'}
        </button>
      )}
      {liveSingle && (
        <button onClick={() => onEnd(slot.classes[0])} disabled={busy}
          className="px-3 py-1.5 text-xs rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50 whitespace-nowrap">
          End
        </button>
      )}
      {tracksHere && !slot.isGroup && (
        <TrackActions cls={slot.classes[0]} subCount={subCounts[slot.classes[0]._id]} {...trackProps} />
      )}
      {tracksHere && slot.isGroup && (
        <div className="w-full space-y-1.5 pt-1">
          {ran.map((c) => (
            <div key={c._id} className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-gray-600 min-w-[64px]">{trackLabelOf(c)}</span>
              <TrackActions cls={c} subCount={subCounts[c._id]} {...trackProps} compact />
            </div>
          ))}
        </div>
      )}
    </>
  )
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
  const [covered, setCovered]       = useState(null)   // classId while the "what did this class finish" modal is open
  const [coveredBusy, setCoveredBusy] = useState(null) // `${chapterId}:${unitId}` while a tick is in flight
  const [tab, setTab]               = useState('list') // 'list' | 'calendar'
  const [page, setPage]             = useState(1)
  const [pageInfo, setPageInfo]     = useState(null)   // { total, pages } from the server
  const [calTick, setCalTick]       = useState(0)      // bumped when this page changes a class, so the calendar refetches

  const { session, minimized, startOrEnter: enterSession, subCounts, setSubCounts } = useLiveSession()

  // One card per room slot: the tracks of a room in the same period collapse
  // into a single entry with one Start button (see utils/roomSlots.js).
  const slots = useMemo(() => (classes ? groupRoomSlots(classes) : null), [classes])

  const load = useCallback(async () => {
    try {
      // Paginated + attention-first order: live → upcoming (soonest first) →
      // past (most recent first). The server sorts; this page just renders.
      const d = await apiFetch(`/api/live-classes/manage?page=${page}&limit=10`)
      setClasses(d.classes || [])
      setPageInfo({ total: d.total || 0, pages: d.pages || 1 })
      setLoadError('')
    } catch (err) {
      // Never swallow this — an auth or network failure looked identical to
      // "nothing assigned", which is exactly the wrong thing to tell a mentor.
      setClasses([])
      setLoadError(err.message || 'Could not load your classes')
    }
  }, [page])

  // A delete/cancel can empty the last page under us — step back, don't strand
  // the mentor on a blank page.
  useEffect(() => {
    if (classes && !classes.length && !loadError && page > 1) setPage((p) => p - 1)
  }, [classes, loadError, page])

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

  // Tick/untick one item in the "what did this class finish" checklist. The
  // booked item only toggles its syllabus flag (same endpoint as the quick-mark
  // button); an extra item goes through /covered, which also ties this class's
  // attendance to it so students complete it automatically.
  const toggleCovered = async (cls, chapterId, unitId, isPrimary, next) => {
    setError('')
    setCoveredBusy(`${chapterId}:${unitId || ''}`)
    try {
      if (isPrimary) {
        await apiFetch(`/api/live-classes/manage/syllabus/${cls.subject.subjectId}/progress`, {
          method: 'POST',
          body: JSON.stringify({ chapterId, unitId: unitId || undefined, completed: next }),
        })
      } else {
        await apiFetch(`/api/live-classes/manage/${cls._id}/covered`, {
          method: 'POST',
          body: JSON.stringify({ chapterId, unitId: unitId || undefined, covered: next }),
        })
      }
      await Promise.all([load(), loadSyllabus()])
    } catch (err) {
      setError(err.message || 'Could not update')
    } finally {
      setCoveredBusy(null)
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

  // After class: one click marks what it taught as completed, plus "More" for
  // anything else the session got through beyond its booking.
  const renderSyllabusButtons = (c, compact = false) => {
    if (c.status !== 'ended') return null
    const size = compact ? 'px-3 py-1.5 text-xs' : 'px-3 py-2 text-sm'
    const p = classProgress(c)
    // Name exactly what gets marked — a bare "Completed" left it unclear
    // whether the class, the unit, or the chapter was done.
    const name = p ? (p.isUnit ? c.unit?.name : c.chapter?.name) : ''
    const kind = p?.isUnit ? 'unit' : 'chapter'
    return (
      <>
        {p && (
          <button onClick={() => toggleProgress(p.subjectId, p.chapterId, p.unitId, !p.completed)}
            title={p.completed
              ? `The ${kind} "${name}" is marked completed — click to unmark`
              : `Mark the ${kind} "${name}" as completed`}
            className={`${size} rounded-xl font-semibold whitespace-nowrap border max-w-[180px] sm:max-w-[220px] truncate ${
              p.completed
                ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100'
                : 'border-teal-300 text-teal-700 hover:bg-teal-50'}`}>
            {p.completed ? `✓ ${name} completed` : `Mark "${name}" done`}
          </button>
        )}
        {c.subject?.subjectId && (
          <button onClick={() => setCovered(c._id)}
            title="Finished more than scheduled? Mark extra chapters or units this session completed"
            className={`${size} rounded-xl border border-teal-300 text-teal-700 font-semibold hover:bg-teal-50 whitespace-nowrap`}>
            ＋ More
          </button>
        )}
      </>
    )
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
    setBusyId(cls._id); setError('')
    try {
      await apiFetch(`/api/live-classes/manage/${cls._id}/end`, { method: 'POST' })
      setCalTick((t) => t + 1)   // the calendar refetches so the slot flips to ended
      await load()
    } catch (err) {
      setError(err.message || 'Could not end the class')
    } finally {
      setBusyId(null)
    }
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

  // Override a student's auto verdicts (present / per-item completion) and
  // patch the open modal's roster in place with what the server settled on.
  // patch may carry chapterId/unitId to target one of the class's taught items
  // (default: the booked one); the server hands back every record for the
  // student since a Present change can flip other items' completion too.
  const updateAttendanceRecord = async (userId, patch) => {
    try {
      const d = await apiFetch(`/api/live-classes/manage/${attendance.id}/attendance/${userId}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      })
      const rec = d.record
      const recs = d.records || [rec]
      setAttendance((a) => {
        if (!a) return a
        const metaItems = a.meta?.items || []
        const forItem = (it) => recs.find((r) =>
          String(r.chapter?.chapterId || '') === String(it?.chapterId || '')
          && String(r.unit?.unitId || '') === String(it?.unitId || ''))
        const primary = forItem(metaItems[0]) || rec
        return {
          ...a,
          roster: a.roster.map((p) => String(p.userId) === String(userId)
            ? {
                ...p,
                record: {
                  ...p.record,
                  present: rec.present, presentSource: rec.presentSource,
                  chapterCompleted: primary.chapterCompleted, chapterSource: primary.chapterSource,
                  items: metaItems.map((it) => {
                    const r = forItem(it)
                    return r ? { completed: r.chapterCompleted, source: r.chapterSource } : { completed: false, source: 'auto' }
                  }),
                  markedByName: rec.markedBy?.name || p.record?.markedByName || '',
                },
              }
            : p),
        }
      })
    } catch (err) {
      setError(err.message || 'Could not update attendance')
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Tutor Session</h1>
          <p className="text-gray-400 text-sm">
            Sessions your admin has assigned to you. Start one to go live with your students.
          </p>
        </div>
        <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-semibold bg-white">
          {[['list', 'List'], ['calendar', 'Calendar']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 h-9 ${tab === key ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {tab === 'calendar' ? (
        <ScheduleCalendar
          endpoint="/api/live-classes/manage/schedule"
          // Starting a class changes the session token; minimizing brings this
          // page back mid-class; ending bumps calTick — each should refetch.
          refreshKey={`${session?.token || ''}|${minimized ? 1 : 0}|${calTick}`}
          // The detail modal closes before any action runs: the room, the
          // attendance/submissions modals and the page's error banner all
          // render outside the calendar, and must not be hidden behind it.
          groupRooms
          renderActions={(slot, { compact, close }) => (
            <MentorSlotActions slot={slot} busyId={busyId} sessionClassId={session?.classId}
              subCounts={subCounts} compact={compact}
              onStart={(cls) => { close(); startOrEnter(cls) }}
              onEnd={(cls) => { close(); endClass(cls) }}
              onAttendance={(cls) => { close(); openAttendance(cls) }}
              onSubmissions={(cls) => { close(); setSubmissions({ id: cls._id, title: cls.title }) }} />
          )}
        />
      ) : classes === null ? (
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
        <><div className="space-y-3">
          {slots.map((s) => {
            const only = s.isGroup ? null : s.classes[0]   // a lone class keeps the classic card
            return (
              <div key={s._id} className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <StatusPill status={s.status} />
                      {s.roomLabel && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                          {s.roomLabel} · {s.trackLabel}
                        </span>
                      )}
                    </div>
                    {/* One bold line: when it runs, then which slot it is */}
                    <p className="text-sm font-bold text-gray-900">
                      {fmtWhen(s.scheduledStart)} · {s.title}
                    </p>
                    {only && <ClassMeta c={only} />}
                    {((only && runDuration(only)) || s.isGroup) && (
                      <p className="text-xs text-gray-500 mt-1">
                        {only && runDuration(only) && <span>ran {runDuration(only)}</span>}
                        {s.isGroup && <span>Start once, then switch tracks inside the room</span>}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    {only && renderSyllabusButtons(only)}
                    <MentorSlotActions slot={s} busyId={busyId} sessionClassId={session?.classId}
                      subCounts={subCounts} showTracks={!s.isGroup}
                      onStart={startOrEnter} onEnd={endClass} onAttendance={openAttendance}
                      onSubmissions={(cls) => setSubmissions({ id: cls._id, title: cls.title })} />
                  </div>
                </div>

                {/* The room's tracks: what each teaches, and its own after-class controls */}
                {s.isGroup && (
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-2.5">
                    {s.classes.map((c) => (
                      <div key={c._id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                            {trackLabelOf(c)}
                            <StatusPill status={c.status} />
                          </p>
                          <ClassMeta c={c} />
                          {runDuration(c) && <p className="text-xs text-gray-400 mt-0.5">ran {runDuration(c)}</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {renderSyllabusButtons(c, true)}
                          <TrackActions cls={c} busyId={busyId} subCount={subCounts[c._id]} compact
                            onEnd={endClass} onAttendance={openAttendance}
                            onSubmissions={(cls) => setSubmissions({ id: cls._id, title: cls.title })} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {pageInfo?.pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white">
              ‹ Prev
            </button>
            <span className="text-xs text-gray-500 font-semibold">
              Page {page} of {pageInfo.pages} · {pageInfo.total} slots
            </span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= pageInfo.pages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white">
              Next ›
            </button>
          </div>
        )}</>
      )}

      {/* Everything an ended session finished — booked item plus extras */}
      {covered && (() => {
        const cls = classes?.find((c) => c._id === covered)
        if (!cls) return null
        const subject = syllabus?.find((s) => String(s._id) === String(cls.subject?.subjectId))
        return (
          <CoveredModal cls={cls} subject={subject} busyKey={coveredBusy} error={error}
            onToggle={(chapterId, unitId, isPrimary, next) => toggleCovered(cls, chapterId, unitId, isPrimary, next)}
            onClose={() => setCovered(null)} />
        )
      })()}

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
