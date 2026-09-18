import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../api'
import ScheduleCalendar from '../../components/ScheduleCalendar'
import { useStudentLiveSession } from '../../components/StudentLiveSessionProvider'

// Only loaded when work is actually submitted — it carries the recorder.
const SubmitWorkPanel = lazy(() => import('../../components/SubmitWorkPanel'))

// Height of the minimized class window (LiveRoom's corner window: 200px tall,
// 16px off the bottom edge). The submit dialog keeps this much clear so the
// window never sits on top of its Submit button.
const CORNER_WINDOW_INSET = 216

function fmtWhen(d) {
  if (!d) return ''
  return new Date(d).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  })
}

// The buttons a student gets for one class — the list cards and every calendar
// surface (live strip, agenda rows, detail modal) render this same component,
// so "can I join this right now" is decided in exactly one place.
//   compact     smaller buttons for calendar rows
//   placeholder show a "Not started" pill for upcoming classes (list cards only —
//               the calendar modal already shows a countdown)
//   inClassId   the class the student is connected to right now (minimized) —
//               its button reads "Back to class" and just expands the window
function StudentClassActions({ cls, joining, inClassId, onJoin, onSubmit, onAskBack, asking, compact = false, placeholder = false }) {
  const live = cls.status === 'live'
  const scheduled = cls.status === 'scheduled'
  const showPlaceholder = placeholder && scheduled && !live
  // Removed from a live class: the door is shut until the mentor opens it, so
  // the card offers the ask instead of a Join button that would only 403.
  const lockedOut = live && cls.removed
  if (!live && !cls.submissionOpen && !showPlaceholder) return null

  const inThisClass = !!inClassId && inClassId === cls._id
  const size = compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'
  const grow = compact ? '' : 'flex-1 sm:flex-none'
  return (
    <>
      {/* Hand work in without rejoining — the class stays here for the whole
          submission window after it ends. */}
      {cls.submissionOpen && (
        <button onClick={() => onSubmit(cls)}
          className={`${grow} ${size} rounded-xl border border-teal-300 text-teal-700 font-semibold hover:bg-teal-50 whitespace-nowrap`}>
          📎 Submit{compact ? '' : ' work'}
        </button>
      )}
      {lockedOut ? (
        <button
          onClick={() => onAskBack(cls)}
          disabled={asking === cls._id}
          title={cls.rejoinStatus === 'pending'
            ? 'Your mentor has been told — they will let you in from inside the class'
            : 'Send your mentor a request to let you back into this class'}
          className={`${grow} ${size} rounded-xl font-semibold whitespace-nowrap ${
            cls.rejoinStatus === 'pending'
              ? 'bg-amber-100 text-amber-700 border border-amber-300'
              : 'bg-amber-500 text-white hover:bg-amber-600'}`}>
          {asking === cls._id ? 'Sending…'
            : cls.rejoinStatus === 'pending' ? '⏳ Waiting for the mentor'
              : '🙋 Ask to be let back in'}
        </button>
      ) : live ? (
        <button onClick={() => onJoin(cls)} disabled={joining === cls._id}
          className={`${grow} ${size} rounded-xl font-semibold whitespace-nowrap disabled:bg-gray-200 disabled:text-gray-400 ${
            inThisClass ? 'bg-teal-600 text-white hover:bg-teal-700' : 'bg-red-600 text-white hover:bg-red-700'}`}>
          {joining === cls._id ? 'Joining…' : inThisClass ? '⤢ Back to class' : 'Join now'}
        </button>
      ) : showPlaceholder ? (
        <span className={`${grow} ${size} text-center rounded-xl bg-gray-100 text-gray-400 font-semibold whitespace-nowrap`}>
          Not started
        </span>
      ) : null}
    </>
  )
}

export default function LiveClassesPage() {
  const [classes, setClasses] = useState(null)
  const [error, setError]     = useState('')
  const [submitFor, setSubmitFor] = useState(null)  // { id, title } while the panel is open
  // 'list' | 'calendar'. ?view=calendar (the link in the WhatsApp class alert)
  // opens straight on the calendar.
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(() => searchParams.get('view') === 'calendar' ? 'calendar' : 'list')
  // The room itself is owned by the layout-level provider, so it survives
  // navigating away while minimized (see StudentLiveSessionProvider).
  const { session, minimized, join: enterClass, joining, notice, clearNotice } = useStudentLiveSession()

  const [asking, setAsking] = useState(null)      // class id whose request is in flight
  const [letIn, setLetIn] = useState('')          // "the mentor let you back in" banner
  // Which classes we last saw the student locked out of, so the moment the
  // mentor opens the door we can say so — they are outside the room, so this
  // poll IS their notification channel.
  const lockedRef = useRef(new Set())

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/api/live-classes')
      const list = d.classes || []
      const wasLocked = lockedRef.current
      const freed = list.find((c) => c.status === 'live' && !c.removed && wasLocked.has(c._id))
      lockedRef.current = new Set(list.filter((c) => c.removed).map((c) => c._id))
      if (freed) {
        playLetInChime()
        setLetIn(`Your mentor let you back into “${freed.title}”. You can join again — keep your camera on.`)
      }
      setClasses(list)
    } catch {
      setClasses([])
    }
  }, [])

  const askBack = async (cls) => {
    setError('')
    setAsking(cls._id)
    try {
      await apiFetch(`/api/live-classes/${cls._id}/rejoin-request`, { method: 'POST', body: '{}' })
      setClasses((cs) => cs.map((c) => c._id === cls._id ? { ...c, rejoinStatus: 'pending' } : c))
    } catch (e) {
      setError(e.message || 'Could not send your request')
    } finally {
      setAsking(null)
    }
  }

  // On mount, and whenever this page becomes visible again — the class ended
  // (or the student left), or they minimized it — since a class may have gone
  // live or ended while the room covered the page.
  const pageVisible = !session || minimized
  useEffect(() => { if (pageVisible) load() }, [load, pageVisible])

  // Refresh every 20s so a class flips to "Join now" shortly after the host
  // starts it. Paused while the room covers the page — nobody can see the list.
  const waitingForMentor = (classes || []).some((c) => c.removed && c.rejoinStatus === 'pending')
  useEffect(() => {
    if (!pageVisible) return undefined
    // Locked out and waiting on an answer: check more often. Nothing pushes to
    // a student who isn't in the room.
    const t = setInterval(load, waitingForMentor ? 8_000 : 20_000)
    return () => clearInterval(t)
  }, [load, pageVisible, waitingForMentor])

  const join = async (cls) => {
    setError('')
    try {
      await enterClass(cls)
    } catch (e) {
      setError(e.message || 'Could not join the class')
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-5 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Tutor Session</h1>
          <p className="text-gray-400 text-sm mt-1">Join your live sessions with tutors. Sessions appear here once scheduled.</p>
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
      {/* The mentor answered a "let me back in" request. */}
      {letIn && (
        <p className="text-sm text-teal-700 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
          <span className="flex-1">✅ {letIn}</span>
          <button onClick={() => setLetIn('')} className="text-teal-400 hover:text-teal-600 text-lg leading-none" title="Dismiss">×</button>
        </p>
      )}
      {/* Why the last class ended, when it wasn't the student's choice. */}
      {notice && (
        <p className="text-sm text-red-500 mb-3 flex items-center gap-2">
          <span>{notice}</span>
          <button onClick={clearNotice} className="text-gray-400 hover:text-gray-600 text-lg leading-none" title="Dismiss">×</button>
        </p>
      )}

      {tab === 'calendar' ? (
        <ScheduleCalendar
          endpoint="/api/live-classes/schedule"
          renderActions={(c, { compact, close }) => (
            <StudentClassActions cls={c} joining={joining} inClassId={session?.classId} compact={compact}
              asking={asking} onAskBack={askBack}
              onJoin={(cls) => { close(); join(cls) }}
              onSubmit={(cls) => { close(); setSubmitFor({ id: cls._id, title: cls.title }) }} />
          )}
        />
      ) : classes === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !classes.length ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">No tutor sessions scheduled</p>
          <p className="text-gray-400 text-sm">When a tutor schedules a session, it'll show up here.</p>
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
                  {/* One bold line: when it runs, then which slot it is */}
                  <p className="text-sm font-bold text-gray-900">
                    {fmtWhen(c.scheduledStart)} · {c.title}
                  </p>
                  {c.chapterName && (
                    <p className="text-xs text-indigo-500 truncate mt-0.5">
                      📖 {c.subjectName ? `${c.subjectName} · ` : ''}{c.chapterName}{c.unitName ? ` · ${c.unitName}` : ''}
                    </p>
                  )}
                  {c.description && <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{c.description}</p>}
                </div>

                <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto">
                  <StudentClassActions cls={c} joining={joining} inClassId={session?.classId} placeholder
                    asking={asking} onAskBack={askBack}
                    onJoin={join}
                    onSubmit={(cls) => setSubmitFor({ id: cls._id, title: cls.title })} />
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
            bottomInset={session && minimized ? CORNER_WINDOW_INSET : 0}
            onClose={() => { setSubmitFor(null); load() }}
          />
        </Suspense>
      )}
    </div>
  )
}


// A short rising pair — "the door opened". Synthesized like the room's own
// chimes so there is no audio asset to load, and only ever fired straight after
// a poll the student's own page ran, so autoplay policy is satisfied.
function playLetInChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const t0 = ctx.currentTime
    ;[[659.25, 0], [987.77, 0.15]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.4)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.42)
    })
    setTimeout(() => { ctx.close().catch(() => {}) }, 1200)
  } catch {
    // Sound is a nicety — the banner still shows.
  }
}
