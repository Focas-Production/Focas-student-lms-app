import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../api'
import { groupRoomSlots, slotPrimaryClass, trackLabelOf } from '../../utils/roomSlots'
import AttendanceModal from '../../components/AttendanceModal'
import ScheduleCalendar from '../../components/ScheduleCalendar'
import DateField from '../../components/DateField'
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

// Completion state of the chapter/unit a class taught, read off the loaded
// syllabus — drives the quick-mark button on ended cards and the after-End
// prompt. null when the class has no booked chapter or the syllabus isn't in.
function progressFor(syllabus, c) {
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

// Did THIS class finish its booked chapter/unit? The class's own answer
// (LiveClass.outcome, asked when it ends) when it has one; classes that ended
// before answers were kept fall back to the subject-wide syllabus flag. The
// card button, the after-End prompt and the "More" checklist all read this,
// so a chapter finished in an earlier session never looks pre-ticked here.
const sessionDone = (cls, syllabusDoc) =>
  (cls.outcome ? cls.outcome.completed === true : !!syllabusDoc?.completed)

// How long after a class ends the catch-up prompt is still worth showing.
const ENDED_CATCHUP_MS = 2 * 24 * 60 * 60 * 1000

const CheckIcon = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
    <path d="M4.5 10.5l3.5 3.5L15.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// Checklist of everything one ended session finished: the booked chapter/unit
// plus anything else the host got through — a quick class can close out its
// chapter and start the next. Ticking an extra item marks it completed in
// syllabus progress AND ties this class's attendance to it, so students who
// were present get it completed automatically. The booked item just toggles
// its syllabus flag — the class teaches it by definition.
// hidePrimary — leave the booked item out (the after-End prompt shows it on
// its own, above the list).
function CoveredChecklist({ cls, subject, busyKey, onToggle, hidePrimary = false }) {
  const primaryChapterId = String(cls.chapter?.chapterId || '')
  const primaryUnitId = String(cls.unit?.unitId || '')
  const isPrimary = (chId, uId) => String(chId) === primaryChapterId && String(uId || '') === primaryUnitId
  const isExtra = (chId, uId) => (cls.extraItems || []).some((x) =>
    String(x.chapter?.chapterId) === String(chId) && String(x.unit?.unitId || '') === String(uId || ''))

  const row = (ch, u) => {
    if (hidePrimary && isPrimary(ch._id, u?._id)) return null
    const chId = ch._id, uId = u?._id
    const doc = u || ch
    const primary = isPrimary(chId, uId)
    const coveredHere = primary ? sessionDone(cls, doc) : isExtra(chId, uId)
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

  if (!subject) {
    return <p className="text-sm text-gray-400 text-center py-4">Couldn't load this subject's syllabus — try reloading.</p>
  }
  if (!(subject.chapters || []).length) {
    return <p className="text-sm text-gray-400 text-center py-4">This subject has no chapters yet.</p>
  }
  return (
    <div className="space-y-0.5">
      {subject.chapters.map((ch) => (
        <Fragment key={ch._id}>
          {row(ch)}
          {(ch.units || []).map((u) => row(ch, u))}
        </Fragment>
      ))}
    </div>
  )
}

const CHECKLIST_HELP = 'Tick every chapter or unit this session completed. Ticked items are marked done in '
  + 'syllabus progress, and each student who attended enough of the class gets them '
  + 'completed automatically. Unticking undoes both.'

// The "＋ More" dialog on an ended class card.
function CoveredModal({ cls, subject, busyKey, error, onToggle, onClose }) {
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
          <CoveredChecklist cls={cls} subject={subject} busyKey={busyKey} onToggle={onToggle} />
          <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">{CHECKLIST_HELP}</p>
        </div>
      </div>
    </div>
  )
}

// Shown the moment the host ends a class — and once, later, for a class that
// ended without them pressing End (see the catch-up effect). The one thing a
// mentor forgets after a session is saying what it finished, so the booked
// chapter/unit is ONE checkbox row, unticked until they tick it — this
// class's own answer, never the subject-wide flag (which a previous session
// on the same chapter may already have set; that case gets a note). Anything
// extra sits behind "also finished…". Done without a tick means "not
// finished" and is recorded as the answer.
//   progress — progressFor(syllabus, cls): the item's ids + syllabus flag, or null
//   late     — the catch-up variant, for a class that ended on its own
function ClassEndedModal({ cls, subject, progress: p, busyKey, error, late, onSetDone, onToggle, onClose }) {
  const [showMore, setShowMore] = useState(false)
  const hasItem = !!cls.chapter?.chapterId
  const isUnit = !!cls.unit?.unitId
  const name = isUnit ? cls.unit?.name : cls.chapter?.name
  const kind = isUnit ? 'unit' : 'chapter'
  const done = sessionDone(cls, null)
  const alreadyOnSyllabus = !done && !!p?.completed
  const primaryKey = `${cls.chapter?.chapterId || ''}:${cls.unit?.unitId || ''}`
  const saving = busyKey === primaryKey
  const busy = !!busyKey
  const extrasCount = (cls.extraItems || []).length
  const ran = runDuration(cls)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="class-ended-title"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>

        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-lg font-bold ${
            late ? 'bg-amber-100 text-amber-700' : 'bg-teal-100 text-teal-700'}`}>
            {late ? '?' : <CheckIcon className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p id="class-ended-title" className="text-base font-bold text-gray-900">
              {late ? `Did this class finish its ${kind}?` : 'Class ended'}
            </p>
            <p className="text-xs text-gray-600 truncate mt-0.5">{cls.title}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {late
                ? `Ended ${fmtWhen(cls.endedAt)} — you weren't asked at the time.`
                : `${ran ? `Ran ${ran} · ` : ''}ended ${fmtWhen(cls.endedAt)}`}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none -mt-1 disabled:opacity-40">×</button>
        </div>

        <div className="px-5 pb-4 overflow-y-auto">
          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</p>
          )}

          {hasItem ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">
                Did you finish the scheduled {kind}?
              </p>
              <button type="button" role="checkbox" aria-checked={done} disabled={busy}
                onClick={() => onSetDone(!done)}
                className={`w-full text-left rounded-xl border-2 p-3.5 flex items-center gap-3 transition disabled:opacity-60 ${
                  done ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition ${
                  done ? 'bg-teal-600 border-teal-600 text-white' : 'border-gray-300 bg-white'}`}>
                  {done && <CheckIcon />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 truncate">{name}</span>
                  <span className="block text-xs text-gray-500 truncate">
                    {[cls.subject?.name, isUnit ? cls.chapter?.name : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={`text-[11px] font-semibold flex-shrink-0 ${done ? 'text-teal-700' : 'text-gray-400'}`}>
                  {saving ? 'Saving…' : done ? 'Completed' : 'Not finished'}
                </span>
              </button>
              {alreadyOnSyllabus && (
                <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                  ⓘ This {kind} is already marked completed on your syllabus from an earlier session.
                  Tick only if this class finished it too.
                </p>
              )}
              {done && (
                <p className="mt-2 text-[11px] text-teal-700 leading-relaxed">
                  Students who attended enough of this class get it completed automatically.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">No chapter was scheduled for this class. Tick anything it finished below.</p>
          )}

          <div className="mt-4 pt-3 border-t border-gray-100">
            <button onClick={() => setShowMore((v) => !v)} className="text-xs font-semibold text-teal-700 hover:underline">
              {showMore
                ? '− Hide other chapters and units'
                : `＋ Also finished other chapters or units?${extrasCount ? ` (${extrasCount} ticked)` : ''}`}
            </button>
            {showMore && (
              <div className="mt-2 border border-gray-100 rounded-xl p-2">
                <CoveredChecklist cls={cls} subject={subject} busyKey={busyKey} onToggle={onToggle} hidePrimary={hasItem} />
                <p className="text-[11px] text-gray-400 mt-2 px-1 leading-relaxed">{CHECKLIST_HELP}</p>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-500">
            {hasItem && (done ? `${isUnit ? 'Unit' : 'Chapter'} marked completed for this class.` : `Nothing ticked — the ${kind} stays unmarked.`)}
          </p>
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-black disabled:opacity-60 flex-shrink-0">
            Done
          </button>
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
          title={slot.isGroup ? `${primary.status === 'live' ? 'Opens' : 'Starts every track and opens'} ${trackLabelOf(primary)} — switch tracks from inside the room` : undefined}
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

// Book a class from the mentor portal: what it teaches (subject → chapter →
// unit, so attendance-driven chapter completion has its target), who hosts it
// (defaults to the mentor booking it), where and when. The server holds the
// booking rules — track overlaps and same-room host clashes come back as
// descriptive 409s and are shown as-is.
//
// "Both tracks — same time" books the room's two tracks into one slot, each
// teaching its own chapter: one mentor runs both, switching tracks inside the
// room (the same-host rule makes any other pairing a 409 anyway).
// Fresh per-track booking fields. `students` is the allotment: empty keeps the
// class open to every student, any entries restrict seeing/joining to them.
const emptyCurr = () => ({
  subjectId: '', chapterId: '', unitId: '', title: '', titleTouched: false, students: [],
})

function ScheduleClassModal({ syllabus, onClose, onCreated, onBooked }) {
  const [hosts, setHosts] = useState([])
  const [rooms, setRooms] = useState(null)   // raw topology — track labels + the "both tracks" option
  const [allStudents, setAllStudents] = useState(null)  // light roster for the allotment picker
  const [stuQ, setStuQ]     = useState({ first: '', second: '' })  // picker search text per track
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const [form, setForm] = useState({
    first: emptyCurr(),    // what track 1 (or the lone picked track) teaches
    second: emptyCurr(),   // what track 2 teaches — only in "both tracks" mode
    hostUserId: '', trackSel: '',
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    start: `${pad(Math.min(now.getHours() + 1, 22))}:00`, end: `${pad(Math.min(now.getHours() + 3, 23))}:00`,
    description: '',
  })

  useEffect(() => {
    apiFetch('/api/live-classes/manage/hosts')
      .then((d) => setHosts(d.hosts || []))
      .catch(() => {})
    apiFetch('/api/live-classes/manage/students')
      .then((d) => setAllStudents(d.students || []))
      .catch(() => setAllStudents([]))
    apiFetch('/api/live-classes/manage/topology')
      .then((d) => {
        const rs = d.rooms || []
        setRooms(rs)
        const r0 = rs[0]
        setForm((f) => (f.trackSel ? f : { ...f, trackSel: r0?.tracks?.[0] ? `${r0.key}|${r0.tracks[0].key}` : '' }))
      })
      .catch(() => setRooms([]))
  }, [])

  const trackOptions = useMemo(() => {
    const opts = []
    for (const r of rooms || []) {
      for (const tr of r.tracks || []) opts.push({ key: `${r.key}|${tr.key}`, label: `${r.label} · ${tr.label}` })
      if ((r.tracks || []).length > 1) opts.push({ key: `${r.key}|*`, label: `${r.label} · Both tracks — same time` })
    }
    return opts
  }, [rooms])

  const [selRoomKey, selTrackToken] = form.trackSel ? form.trackSel.split('|') : ['', '']
  const bothMode = selTrackToken === '*'
  const selRoom = (rooms || []).find((r) => r.key === selRoomKey)
  const t1 = selRoom?.tracks?.[0]
  const t2 = selRoom?.tracks?.[1]

  // Subject/chapter/unit picks flow into that track's title until the mentor types one.
  const pickCurr = (which, patch) => {
    setForm((f) => {
      const cur = { ...f[which], ...patch }
      const s = (syllabus || []).find((x) => String(x._id) === cur.subjectId)
      const ch = (s?.chapters || []).find((x) => String(x._id) === cur.chapterId)
      const u = (ch?.units || []).find((x) => String(x._id) === cur.unitId)
      if (!cur.titleTouched) {
        cur.title = ch ? `${s.name} — ${ch.name}${u ? ` · ${u.name}` : ''}` : (s ? s.name : '')
      }
      return { ...f, [which]: cur }
    })
  }
  const setCurrTitle = (which, title) =>
    setForm((f) => ({ ...f, [which]: { ...f[which], title, titleTouched: true } }))

  const addStudent = (which, s) => {
    setForm((f) => ({
      ...f,
      [which]: { ...f[which], students: [...f[which].students, { id: s.id, name: s.name || s.phoneNumber }] },
    }))
    setStuQ((v) => ({ ...v, [which]: '' }))
  }
  const removeStudent = (which, id) =>
    setForm((f) => ({
      ...f,
      [which]: { ...f[which], students: f[which].students.filter((x) => String(x.id) !== String(id)) },
    }))

  // Plain render helper (not a nested component — that would remount and drop
  // input focus on every keystroke): one track's subject/chapter/unit + title.
  const currFields = (which) => {
    const cur = form[which]
    const subject = (syllabus || []).find((s) => String(s._id) === cur.subjectId)
    const chapter = (subject?.chapters || []).find((c) => String(c._id) === cur.chapterId)
    return (
      <>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Subject</label>
            <select className={field} value={cur.subjectId} required
              onChange={(e) => pickCurr(which, { subjectId: e.target.value, chapterId: '', unitId: '' })}>
              <option value="">Pick a subject…</option>
              {(syllabus || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Chapter</label>
            <select className={field} value={cur.chapterId} required disabled={!subject}
              onChange={(e) => pickCurr(which, { chapterId: e.target.value, unitId: '' })}>
              <option value="">Pick a chapter…</option>
              {(subject?.chapters || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {(chapter?.units || []).length > 0 && (
          <div>
            <label className={label}>Unit <span className="normal-case font-normal">(optional)</span></label>
            <select className={field} value={cur.unitId}
              onChange={(e) => pickCurr(which, { unitId: e.target.value })}>
              <option value="">Whole chapter</option>
              {(chapter?.units || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={label}>Title</label>
          <input className={field} value={cur.title} placeholder="e.g. Accounting — chapter 2"
            onChange={(e) => setCurrTitle(which, e.target.value)} />
        </div>
        {(() => {
          // Allotment picker: chips of the chosen students plus a filter-as-you-
          // type search over the one-shot roster. Empty allotment = open class.
          const q = stuQ[which].trim().toLowerCase()
          const picked = new Set(cur.students.map((s) => String(s.id)))
          const matches = q
            ? (allStudents || []).filter((s) => !picked.has(String(s.id))
                && (s.name.toLowerCase().includes(q) || s.phoneNumber.includes(q))).slice(0, 8)
            : []
          return (
            <div>
              <label className={label}>
                Students <span className="normal-case font-normal">(optional — leave empty to keep it open to all; only listed students count as allotted)</span>
              </label>
              {cur.students.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {cur.students.map((s) => (
                    <span key={String(s.id)}
                      className="inline-flex items-center gap-1 text-[11px] bg-teal-100 text-teal-800 px-2 py-0.5 rounded-md">
                      {s.name}
                      <button type="button" onClick={() => removeStudent(which, s.id)}
                        className="text-teal-500 hover:text-teal-900 font-bold leading-none">×</button>
                    </span>
                  ))}
                </div>
              )}
              <input className={field} value={stuQ[which]}
                placeholder={allStudents === null ? 'Loading students…' : '🔍 Search name or number to add…'}
                onChange={(e) => setStuQ((v) => ({ ...v, [which]: e.target.value }))} />
              {matches.length > 0 && (
                <div className="mt-1 border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-40 overflow-y-auto shadow-sm bg-white">
                  {matches.map((s) => (
                    <button type="button" key={String(s.id)} onClick={() => addStudent(which, s)}
                      className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-teal-50">
                      {s.name || 'Unnamed'} <span className="text-xs text-gray-400">{s.phoneNumber}</span>
                    </button>
                  ))}
                </div>
              )}
              {q && allStudents !== null && !matches.length && (
                <p className="text-xs text-gray-400 mt-1">No student matches "{stuQ[which].trim()}"</p>
              )}
              {cur.students.length > 0 && (
                <p className="text-[11px] text-amber-600 mt-1">
                  Only these {cur.students.length} student{cur.students.length > 1 ? 's' : ''} will see and join this class.
                </p>
              )}
            </div>
          )
        })()}
      </>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.trackSel) return setError('Pick a room and track')
    if (bothMode && (!t1 || !t2)) return setError('That room has no second track')
    const currs = bothMode ? [form.first, form.second] : [form.first]
    for (const c of currs) {
      if (!c.subjectId || !c.chapterId) return setError('Pick the subject and chapter for every track')
      if (!c.title.trim()) return setError('Give every track a title')
    }
    // The date field can be cleared; without this the Invalid Dates below would
    // surface as a misleading "end must be after start".
    if (!form.date) return setError('Pick a date')
    const scheduledStart = new Date(`${form.date}T${form.start}`)
    const scheduledEnd   = new Date(`${form.date}T${form.end}`)
    if (!(scheduledEnd > scheduledStart)) return setError('End time must be after the start time')

    const book = (trackKey, curr) => apiFetch('/api/live-classes/manage', {
      method: 'POST',
      body: JSON.stringify({
        title: curr.title.trim(),
        description: form.description.trim(),
        scheduledStart: scheduledStart.toISOString(),
        scheduledEnd: scheduledEnd.toISOString(),
        roomKey: selRoomKey, trackKey,
        hostUserId: form.hostUserId || undefined,
        subjectId: curr.subjectId,
        chapterId: curr.chapterId,
        unitId: curr.unitId || undefined,
        // Non-empty → only these students see and can join the class.
        studentIds: curr.students.map((s) => s.id),
      }),
    })

    setSaving(true)
    try {
      if (!bothMode) {
        await book(selTrackToken, form.first)
        onCreated()
        return
      }
      // Two bookings, same slot, same host. If track 1 fails nothing was
      // booked and the plain error below covers it.
      await book(t1.key, form.first)
      try {
        await book(t2.key, form.second)
      } catch (err) {
        // Track 1 IS booked — flip the form to just track 2 so pressing
        // Schedule again can't double-book track 1.
        onBooked?.()
        setForm((f) => ({
          ...f,
          trackSel: `${selRoomKey}|${t2.key}`,
          first: { ...f.second, titleTouched: true },
          second: emptyCurr(),
        }))
        setError(`${selRoom?.label} · ${t1.label} was booked, but ${t2.label} failed: ${err.message} — fix it and press Schedule again to book just ${t2.label}.`)
        return
      }
      onCreated()
    } catch (err) {
      setError(err.message || 'Could not schedule the class')
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:border-teal-400'
  const label = 'block text-[11px] font-bold text-gray-500 uppercase mb-1'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-gray-900">Schedule a live class</p>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Mentor (host)</label>
              <select className={field} value={form.hostUserId}
                onChange={(e) => setForm((f) => ({ ...f, hostUserId: e.target.value }))}>
                <option value="">Me</option>
                {hosts.map((h) => <option key={h.id} value={h.id}>{h.name}{h.role === 'admin' ? ' (admin)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Room · Track</label>
              <select className={field} value={form.trackSel} required
                onChange={(e) => setForm((f) => ({ ...f, trackSel: e.target.value }))}>
                {rooms === null && <option value="">Loading…</option>}
                {trackOptions.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {bothMode ? (
            <>
              <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-3 space-y-3">
                <p className="text-[11px] font-bold text-teal-700 uppercase">{t1?.label || 'Track 1'} teaches</p>
                {currFields('first')}
              </div>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-3">
                <p className="text-[11px] font-bold text-indigo-700 uppercase">{t2?.label || 'Track 2'} teaches</p>
                {currFields('second')}
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Both tracks run in the same slot with the same mentor — start once, then
                switch tracks inside the room.
              </p>
            </>
          ) : (
            currFields('first')
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>Date</label>
              {/* DD/MM/YYYY — a native date input shows the browser's locale order instead */}
              <DateField className={field} value={form.date} required
                onChange={(iso) => setForm((f) => ({ ...f, date: iso }))} />
            </div>
            <div>
              <label className={label}>Starts</label>
              <input type="time" className={field} value={form.start} required
                onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Ends</label>
              <input type="time" className={field} value={form.end} required
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className={label}>Description <span className="normal-case font-normal">(optional)</span></label>
            <input className={field} value={form.description} placeholder="What this session covers"
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Attendance and chapter completion are tracked for this class just like an
            admin-scheduled one — students who attend enough get the chapter/unit marked
            automatically when you end it.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50">
            Close
          </button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:bg-gray-300">
            {saving ? 'Scheduling…' : bothMode ? 'Schedule both tracks' : 'Schedule class'}
          </button>
        </div>
      </form>
    </div>
  )
}

// Mentors run what the admin assigns them — and can now book their own classes
// too (subject, chapter, host and slot). This page is that list plus the
// controls to run a class.
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
  const [covered, setCovered]       = useState(null)   // classId while the "what did this class finish" modal is open
  const [ended, setEnded]           = useState(null)   // { ...class, late } while the "class ended — what did you finish?" prompt is open
  // Classes the prompt has already opened for on this page — so closing it
  // can't re-open it before the answer has round-tripped through the server.
  const promptedRef = useRef(new Set())
  const [coveredBusy, setCoveredBusy] = useState(null) // `${chapterId}:${unitId}` while a tick is in flight
  const [tab, setTab]               = useState('list') // 'list' | 'calendar'
  const [page, setPage]             = useState(1)
  const [pageInfo, setPageInfo]     = useState(null)   // { total, pages } from the server
  const [calTick, setCalTick]       = useState(0)      // bumped when this page changes a class, so the calendar refetches
  const [schedule, setSchedule]     = useState(false)  // schedule-a-class modal open

  const { session, minimized, startOrEnter: enterSession, subCounts, setSubCounts } = useLiveSession()
  const navigate = useNavigate()

  // A class's submissions are a PAGE (who joined, who submitted, who didn't,
  // with the review forms), not a modal over this list. A running class keeps
  // going across the navigation — the room lives in the layout.
  const openSubmissions = (cls) => navigate(`/mentor/submissions/${cls._id}`)

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

  // ?all=1: every active subject, not just the ones this mentor has hosted.
  // The schedule form lists these as bookable (a mentor may pick any subject,
  // assigned or not), and a first-time mentor has hosted nothing yet — the
  // hosted-only default would leave the subject picker empty. The lookups on
  // this page (covered modal, progress ticks) go by id, so the wider list
  // changes nothing there. The Syllabus page keeps the hosted-only checklist.
  const loadSyllabus = useCallback(() => {
    return apiFetch('/api/live-classes/manage/syllabus?all=1')
      .then(d => setSyllabus(d.subjects || []))
      .catch(() => setSyllabus([]))
  }, [])

  useEffect(() => { loadSyllabus() }, [loadSyllabus])

  // This class's answer to "did it finish the scheduled chapter/unit?" — the
  // card button, the after-End prompt and the checklist's scheduled row all
  // come through here. The server marks the syllabus item done the first
  // time a session completes it, and only undoes that if it was this very
  // session's tick (see setClassOutcome).
  const setOutcome = async (cls, completed) => {
    setError('')
    setCoveredBusy(`${cls.chapter?.chapterId || ''}:${cls.unit?.unitId || ''}`)
    try {
      await apiFetch(`/api/live-classes/manage/${cls._id}/outcome`, {
        method: 'POST', body: JSON.stringify({ completed }),
      })
      await Promise.all([load(), loadSyllabus()])
    } catch (err) {
      setError(err.message || 'Could not update')
    } finally {
      setCoveredBusy(null)
    }
  }

  // Tick/untick one item in the "what did this class finish" checklist. The
  // booked item is this class's outcome (same as the card button); an extra
  // item goes through /covered, which also ties this class's attendance to
  // it so students complete it automatically.
  const toggleCovered = async (cls, chapterId, unitId, isPrimary, next) => {
    if (isPrimary) return setOutcome(cls, next)
    setError('')
    setCoveredBusy(`${chapterId}:${unitId || ''}`)
    try {
      await apiFetch(`/api/live-classes/manage/${cls._id}/covered`, {
        method: 'POST',
        body: JSON.stringify({ chapterId, unitId: unitId || undefined, covered: next }),
      })
      await Promise.all([load(), loadSyllabus()])
    } catch (err) {
      setError(err.message || 'Could not update')
    } finally {
      setCoveredBusy(null)
    }
  }

  // Completion state of the chapter/unit a class taught — for the quick-mark
  // button on ended class cards and the after-End prompt.
  const classProgress = (c) => progressFor(syllabus, c)

  // Catch-up: a class that ended without the host pressing End (the server
  // closes an abandoned room) never showed the prompt, so its outcome is
  // still unanswered. Once the list is in, ask about the most recent such
  // class — not over another dialog, and not one already opened on this
  // page. Closing the prompt records the answer, so it isn't asked again.
  useEffect(() => {
    if (!classes || ended || covered) return
    const cutoff = Date.now() - ENDED_CATCHUP_MS
    const due = classes.filter((c) => c.status === 'ended' && c.outcome && !c.outcome.answeredAt && !c.outcome.completed
      && c.chapter?.chapterId && c.subject?.subjectId
      && c.endedAt && new Date(c.endedAt).getTime() > cutoff && !promptedRef.current.has(c._id))
    if (!due.length) return
    const latest = due.reduce((a, c) => (new Date(c.endedAt) > new Date(a.endedAt) ? c : a))
    promptedRef.current.add(latest._id)
    setEnded({ ...latest, late: true })
  }, [classes, ended, covered])

  // After class: one click marks what it taught as completed, plus "More" for
  // anything else the session got through beyond its booking.
  const renderSyllabusButtons = (c, compact = false) => {
    if (c.status !== 'ended') return null
    const size = compact ? 'px-3 py-1.5 text-xs' : 'px-3 py-2 text-sm'
    const p = classProgress(c)
    // Name exactly what gets marked — a bare "Completed" left it unclear
    // whether the class, the unit, or the chapter was done.
    const isUnit = !!c.unit?.unitId
    const name = isUnit ? c.unit?.name : c.chapter?.name
    const kind = isUnit ? 'unit' : 'chapter'
    // This class's own answer — with the syllabus flag as a footnote when an
    // earlier session already completed the item.
    const done = sessionDone(c, p)
    const busy = coveredBusy === `${c.chapter?.chapterId || ''}:${c.unit?.unitId || ''}`
    return (
      <>
        {c.chapter?.chapterId && c.subject?.subjectId && (
          <button onClick={() => setOutcome(c, !done)} disabled={busy}
            title={done
              ? `"${name}" was completed in this class — click to undo`
              : `Mark the ${kind} "${name}" as completed in this class${
                  p?.completed ? ' (already completed on the syllabus from an earlier session)' : ''}`}
            className={`${size} rounded-xl font-semibold whitespace-nowrap border max-w-[180px] sm:max-w-[220px] truncate disabled:opacity-60 ${
              done
                ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100'
                : 'border-teal-300 text-teal-700 hover:bg-teal-50'}`}>
            {busy ? 'Saving…' : done ? `✓ ${name} completed` : `Mark "${name}" done`}
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
      const d = await apiFetch(`/api/live-classes/manage/${cls._id}/end`, { method: 'POST' })
      setCalTick((t) => t + 1)   // the calendar refetches so the slot flips to ended
      await load()
      // Straight into "what did you finish?" — the step a mentor forgets. The
      // prompt is keyed off the class we just ended, so it opens even if the
      // refreshed list paged it away.
      promptedRef.current.add(cls._id)
      if (cls.subject?.subjectId) setEnded({ ...cls, ...(d?.liveClass || {}), status: 'ended', late: false })
    } catch (err) {
      setError(err.message || 'Could not end the class')
    } finally {
      setBusyId(null)
    }
  }

  // Closing the prompt without a tick is an answer too — "not finished" — and
  // is recorded, so the question isn't asked again on the next visit or from
  // another device. A tick already recorded itself.
  const closeEndedPrompt = async () => {
    const c = ended && (classes?.find((x) => x._id === ended._id) || ended)
    setEnded(null)
    if (c?.outcome && !c.outcome.answeredAt && !c.outcome.completed) {
      try {
        await apiFetch(`/api/live-classes/manage/${c._id}/outcome`, {
          method: 'POST', body: JSON.stringify({ completed: false }),
        })
        await load()
      } catch { /* asked again next time — harmless */ }
    }
  }

  // A mentor may cancel any session in their list (they host it, or booked it)
  // while it's still scheduled; once live, End is the way out (server enforces both).
  const canCancel = (c) => c.status === 'scheduled'
  const cancelOwn = async (cls) => {
    if (!confirm('Cancel this class? Students will no longer see it.')) return
    setBusyId(cls._id); setError('')
    try {
      await apiFetch(`/api/live-classes/manage/${cls._id}/cancel`, { method: 'POST' })
      setCalTick((t) => t + 1)
      await load()
    } catch (err) {
      setError(err.message || 'Could not cancel the class')
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
            Sessions assigned by your admin — or booked by you. Start one to go live with your students.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setSchedule(true)}
            className="px-4 h-9 rounded-xl bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700">
            ＋ Schedule class
          </button>
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-semibold bg-white">
            {[['list', 'List'], ['calendar', 'Calendar']].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`px-4 h-9 ${tab === key ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
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
              onSubmissions={(cls) => { close(); openSubmissions(cls) }} />
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
          <p className="text-gray-400 text-sm mb-4">When an admin schedules a class with you as host, it'll show up here — or book one yourself.</p>
          <button onClick={() => setSchedule(true)}
            className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700">
            ＋ Schedule class
          </button>
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
                        {s.isGroup && <span>Start once — every track goes live — then switch tracks inside the room</span>}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    {only && renderSyllabusButtons(only)}
                    {only && canCancel(only) && (
                      <button onClick={() => cancelOwn(only)} disabled={busyId === only._id}
                        title="Cancel this session while it hasn't started"
                        className="px-3 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 whitespace-nowrap">
                        Cancel
                      </button>
                    )}
                    <MentorSlotActions slot={s} busyId={busyId} sessionClassId={session?.classId}
                      subCounts={subCounts} showTracks={!s.isGroup}
                      onStart={startOrEnter} onEnd={endClass} onAttendance={openAttendance}
                      onSubmissions={openSubmissions} />
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
                          {canCancel(c) && (
                            <button onClick={() => cancelOwn(c)} disabled={busyId === c._id}
                              title="Cancel this session while it hasn't started"
                              className="px-3 py-1.5 rounded-xl border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 whitespace-nowrap">
                              Cancel
                            </button>
                          )}
                          <TrackActions cls={c} busyId={busyId} subCount={subCounts[c._id]} compact
                            onEnd={endClass} onAttendance={openAttendance}
                            onSubmissions={openSubmissions} />
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

      {/* Book a new class: subject/chapter, host, room · track and slot times */}
      {schedule && (
        <ScheduleClassModal
          syllabus={syllabus}
          onClose={() => setSchedule(false)}
          onCreated={() => { setSchedule(false); setCalTick((t) => t + 1); load() }}
          // "Both tracks" can land its first booking and fail the second — the
          // modal stays open to retry, but the list behind it must show track 1.
          onBooked={() => { setCalTick((t) => t + 1); load() }}
        />
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

      {/* Class ended — what did you finish? (right after End, or the one-time
          catch-up for a class that ended on its own). Reads the class back
          out of the list when it's there, so ticks show their fresh state. */}
      {ended && (() => {
        const cls = classes?.find((c) => c._id === ended._id) || ended
        const subject = syllabus?.find((s) => String(s._id) === String(cls.subject?.subjectId))
        const p = classProgress(cls)
        return (
          <ClassEndedModal cls={cls} subject={subject} progress={p} busyKey={coveredBusy} error={error} late={!!ended.late}
            onSetDone={(next) => setOutcome(cls, next)}
            onToggle={(chapterId, unitId, isPrimary, next) => toggleCovered(cls, chapterId, unitId, isPrimary, next)}
            onClose={closeEndedPrompt} />
        )
      })()}

      {/* Attendance modal */}
      {attendance && (
        <AttendanceModal title={attendance.title} roster={attendance.roster} classInfo={attendance.class}
          meta={attendance.meta} onToggleRecord={updateAttendanceRecord} onClose={() => setAttendance(null)} />
      )}

    </div>
  )
}
