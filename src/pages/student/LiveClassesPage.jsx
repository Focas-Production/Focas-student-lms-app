import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../api'
import ScheduleCalendar from '../../components/ScheduleCalendar'
import { useStudentLiveSession } from '../../components/StudentLiveSessionProvider'
import { wasAsked } from '../../lib/classFeedback'
import { wasReviewSeen, markReviewSeen, REVIEW_SEEN_EVENT } from '../../lib/workReviewSeen'
import { playAsk } from '../../utils/chime'
import { isHallSession, sessionTypeLabel } from '../../utils/sessionTypes'

// Only loaded when work is actually submitted — it carries the recorder.
const SubmitWorkPanel = lazy(() => import('../../components/SubmitWorkPanel'))

// A class that ended within this long opens the rating dialog by itself when
// the student lands here (once per class per device); older ones just wait in
// the "Rate your recent classes" strip until the server's window closes.
const AUTO_ASK_MS = 24 * 60 * 60 * 1000

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
        cls.myWork?.status === 'changes_requested' ? (
          <button onClick={() => onSubmit(cls)} title="Your mentor asked you to redo this — send the corrected work"
            className={`${grow} ${size} rounded-xl bg-teal-600 text-white font-semibold hover:bg-teal-700 whitespace-nowrap`}>
            Send again
          </button>
        ) : (
          <button onClick={() => onSubmit(cls)}
            className={`${grow} ${size} rounded-xl border border-teal-300 text-teal-700 font-semibold hover:bg-teal-50 whitespace-nowrap`}>
            📎 Submit{compact ? '' : ' work'}
          </button>
        )
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
  const { session, minimized, join: enterClass, joining, notice, clearNotice,
    openFeedback, feedbackOpen, feedbackVersion } = useStudentLiveSession()
  // Ended classes this student joined and hasn't rated or skipped yet.
  const [toRate, setToRate] = useState([])
  const [showAllToRate, setShowAllToRate] = useState(false)

  const [asking, setAsking] = useState(null)      // class id whose request is in flight
  const [letIn, setLetIn] = useState('')          // "the mentor let you back in" banner
  // Review notices dismissed this visit ("classId:at"); localStorage keeps them
  // dismissed across visits (lib/workReviewSeen).
  const [dismissed, setDismissed] = useState(() => new Set())
  const [redoOpen, setRedoOpen] = useState(false)
  // A notice closed somewhere else in this tab (the room's pop-up) counts as
  // dismissed here too — keys must match reviewKey() below.
  useEffect(() => {
    const onSeen = (e) => {
      const { classId, at } = e.detail || {}
      if (classId) setDismissed((prev) => new Set(prev).add(outcomeKey(classId, at)))
    }
    window.addEventListener(REVIEW_SEEN_EVENT, onSeen)
    return () => window.removeEventListener(REVIEW_SEEN_EVENT, onSeen)
  }, [])
  const [reviewedOpen, setReviewedOpen] = useState(false)
  // Redo requests already on screen, so a NEW one arriving on a poll can ring.
  // null until the first load — what's there on arrival doesn't ring.
  const redoKeysRef = useRef(null)
  // Which classes we last saw the student locked out of, so the moment the
  // mentor opens the door we can say so — they are outside the room, so this
  // poll IS their notification channel.
  const lockedRef = useRef(new Set())
  // Kept in refs so load() stays stable (the poll interval depends on it).
  const sessionRef = useRef(session)
  useEffect(() => { sessionRef.current = session }, [session])
  const enterRef = useRef(enterClass)
  useEffect(() => { enterRef.current = enterClass }, [enterClass])

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/api/live-classes')
      const list = d.classes || []
      const wasLocked = lockedRef.current
      const freed = list.find((c) => c.status === 'live' && !c.removed && wasLocked.has(c._id))
      lockedRef.current = new Set(list.filter((c) => c.removed).map((c) => c._id))
      setClasses(list)
      const redoKeys = list.filter((c) => c.myWork?.status === 'changes_requested').map((c) => `${c._id}:${c.myWork.at}`)
      // Ring for a NEW request — unless the student is in a class, where the
      // room's own notice (WorkReviewNotice) has already rung for it.
      if (redoKeysRef.current && !sessionRef.current && redoKeys.some((k) => !redoKeysRef.current.has(k))) playAsk()
      redoKeysRef.current = new Set(redoKeys)
      if (freed) {
        // Let back in → straight into the room, no second click. Skipped when
        // they're already sitting in some other class (minimized) — joining
        // would drop them out of it — so they get the banner + Join now instead.
        if (!sessionRef.current) {
          try {
            await enterRef.current(freed)
            playLetInChime()
            setLetIn(`Your mentor let you back into “${freed.title}” — you're in the class now. Keep your camera on.`)
            return
          } catch {
            // Fall through to the manual path below.
          }
        }
        playLetInChime()
        setLetIn(`Your mentor let you back into “${freed.title}”. You can join again — keep your camera on.`)
      }
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

  // Classes waiting for a rating: on load, whenever the dialog closes, and when
  // a class in the list ends (a student who left early gets asked then). Not
  // polled — the class list's own poll is what notices a class ending.
  const endedKey = (classes || []).filter((c) => c.status === 'ended').map((c) => c._id).join(',')
  useEffect(() => {
    if (!pageVisible) return undefined
    let alive = true
    apiFetch('/api/live-classes/feedback/pending')
      .then((d) => alive && setToRate(d.classes || []))
      .catch(() => {})
    return () => { alive = false }
  }, [pageVisible, feedbackVersion, endedKey])

  // Ask once, by itself, about a class that ended in the last day.
  useEffect(() => {
    if (session || feedbackOpen) return
    const fresh = toRate.find((c) => c.endedAt && Date.now() - new Date(c.endedAt).getTime() < AUTO_ASK_MS && !wasAsked(c._id))
    if (fresh) openFeedback(fresh)
  }, [toRate, session, feedbackOpen, openFeedback])

  // Review outcomes the student should act on / hear about. Only classes they
  // can still submit to get a "Send again" — after the window there's nothing
  // to send, and the server refuses redo requests then anyway.
  const reviewKey = (c) => outcomeKey(c._id, c.myWork?.at)
  const redoList = (classes || []).filter((c) => c.myWork?.status === 'changes_requested' && c.submissionOpen)
  // "NEW" = a redo request with a date this device hasn't opened yet (requests
  // saved before the date existed are never flagged — nothing to key them on).
  const isNewOutcome = (c) => !!c.myWork?.at && !dismissed.has(reviewKey(c)) && !wasReviewSeen(c._id, c.myWork.at)
  const newRedo = redoList.filter(isNewOutcome).length
  const reviewedNew = (classes || []).filter((c) => c.myWork?.status === 'reviewed' && c.myWork.at
    && !dismissed.has(reviewKey(c)) && !wasReviewSeen(c._id, c.myWork.at))
  const dismissReview = (c) => {
    markReviewSeen(c._id, c.myWork?.at)
    setDismissed((prev) => new Set(prev).add(reviewKey(c)))
  }
  const dismissAllReviewed = () => {
    reviewedNew.forEach((c) => markReviewSeen(c._id, c.myWork?.at))
    setDismissed((prev) => {
      const next = new Set(prev)
      reviewedNew.forEach((c) => next.add(reviewKey(c)))
      return next
    })
  }
  const scoreOf = (w) => (w?.marks != null ? ` · ${w.marks}${w.totalMarks != null ? ` / ${w.totalMarks}` : ''}` : '')
  const openSubmit = (c) => {
    if (c.myWork?.at) dismissReview(c)
    setSubmitFor({ id: c._id, title: c.title })
  }

  // Ticks once a minute so "in 25 min" / "68h left" stay true while the page is open.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // One section per state, so live / upcoming / ended are never mixed. A
  // "scheduled" class whose planned end has passed was never started — it gets
  // its own quiet section instead of posing as upcoming.
  const groups = { live: [], upcoming: [], ended: [], notStarted: [] }
  for (const c of classes || []) {
    if (c.status === 'live') groups.live.push(c)
    else if (c.status === 'ended') groups.ended.push(c)
    else if (c.status === 'scheduled') {
      const end = new Date(c.scheduledEnd || c.scheduledStart).getTime()
      if (Number.isFinite(end) && end < now) groups.notStarted.push(c)
      else groups.upcoming.push(c)
    }
  }
  groups.upcoming.sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart))
  // Ended: anything the mentor sent back first (it needs doing), then newest.
  const redoFirst = (c) => (c.myWork?.status === 'changes_requested' ? 0 : 1)
  groups.ended.sort((a, b) => (redoFirst(a) - redoFirst(b)) || (new Date(b.endedAt || 0) - new Date(a.endedAt || 0)))
  groups.notStarted.sort((a, b) => new Date(b.scheduledStart) - new Date(a.scheduledStart))

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

      {/* Mentor sent work back — one slim line (the cards below carry the
          note and a "Send again" button); opens into a short list on click.
          Stays until the student sends new work. */}
      {redoList.length > 0 && (
        <div role="alert" className="mb-5 bg-white border border-gray-100 border-l-4 border-l-amber-400 rounded-xl shadow-sm">
          <button type="button" onClick={() => setRedoOpen((v) => !v)} aria-expanded={redoOpen}
            className="w-full flex items-center gap-2 px-3 py-2 text-left">
            <span className="text-sm font-semibold text-gray-900 min-w-0 truncate">
              <span className="hidden sm:inline">Your mentor asked you to redo {redoList.length === 1 ? 'your work' : `work for ${redoList.length} classes`}</span>
              <span className="sm:hidden">Redo asked · {redoList.length} {redoList.length === 1 ? 'class' : 'classes'}</span>
            </span>
            {newRedo > 0 && (
              <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{newRedo} new</span>
            )}
            <span className="flex-1" />
            <span className="text-xs font-semibold text-teal-700 whitespace-nowrap">{redoOpen ? 'Hide ▴' : 'Show ▾'}</span>
          </button>
          {redoOpen && (
            <ul className="border-t border-gray-100 divide-y divide-gray-100">
              {redoList.map((c) => (
                <li key={c._id} className="flex items-center gap-2 px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-900 truncate">{c.title}</p>
                    {c.myWork.note && (
                      <p className="text-[11px] text-gray-600 truncate" title={c.myWork.note}>
                        {c.myWork.reviewerName || 'Mentor'}: “{c.myWork.note}”{c.myWork.at ? ` · ${fmtWhen(c.myWork.at)}` : ''}
                      </p>
                    )}
                  </div>
                  <button onClick={() => openSubmit(c)}
                    className="px-2.5 py-1 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 whitespace-nowrap">
                    Send again
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Newly finished reviews — shown once per device, then the card's
          "Reviewed" label carries it. One card for one review; several fold
          into a single line (a student back after a week may have many). */}
      {reviewedNew.length === 1 && (() => {
        const c = reviewedNew[0]
        return (
          <div role="status" className="mb-3 bg-white border border-gray-100 border-l-4 border-l-teal-500 rounded-xl shadow-sm px-3 py-2.5 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">
                ✓ {c.myWork.reviewerName || 'Your mentor'} reviewed your work for “{c.title}”{scoreOf(c.myWork)}
              </p>
              {c.myWork.note && <p className="text-xs text-gray-600 mt-0.5 line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">“{c.myWork.note}”</p>}
            </div>
            {c.submissionOpen && (
              <button onClick={() => openSubmit(c)}
                className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 whitespace-nowrap">
                See feedback
              </button>
            )}
            <button onClick={() => dismissReview(c)} className="text-gray-300 hover:text-gray-600 text-lg leading-none" title="Dismiss" aria-label="Dismiss">×</button>
          </div>
        )
      })()}
      {reviewedNew.length > 1 && (
        <div role="status" className="mb-3 bg-white border border-gray-100 border-l-4 border-l-teal-500 rounded-xl shadow-sm">
          <div className="flex items-center gap-2 px-3 py-2">
            <button type="button" onClick={() => setReviewedOpen((v) => !v)} aria-expanded={reviewedOpen}
              className="flex-1 min-w-0 flex items-center gap-2 text-left">
              <span className="text-sm font-semibold text-gray-900 truncate">✓ {reviewedNew.length} of your submissions were reviewed</span>
              <span className="flex-1" />
              <span className="text-xs font-semibold text-teal-700 whitespace-nowrap">{reviewedOpen ? 'Hide ▴' : 'Show ▾'}</span>
            </button>
            <button onClick={dismissAllReviewed} className="text-gray-300 hover:text-gray-600 text-lg leading-none"
              title="Mark all as seen" aria-label="Mark all as seen">×</button>
          </div>
          {reviewedOpen && (
            <ul className="border-t border-gray-100 divide-y divide-gray-100">
              {reviewedNew.map((c) => (
                <li key={c._id} className="flex items-center gap-2 px-3 py-1.5">
                  <p className="min-w-0 flex-1 text-xs text-gray-800 truncate" title={c.title}>
                    {c.title}<span className="font-semibold">{scoreOf(c.myWork)}</span>
                  </p>
                  {c.submissionOpen && (
                    <button onClick={() => openSubmit(c)}
                      className="px-2.5 py-1 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 whitespace-nowrap">
                      See feedback
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Ended classes still waiting for a rating. */}
      {toRate.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-3 sm:p-4">
          <p className="text-sm font-bold text-amber-800">⭐ Rate your recent classes</p>
          <p className="text-xs text-amber-700/80 mb-2">Takes a few seconds — it helps us improve every class.</p>
          <div className="space-y-2">
            {(showAllToRate ? toRate : toRate.slice(0, 5)).map((c) => (
              <div key={c._id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">{c.title}</p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {fmtWhen(c.scheduledStart)}{c.hostName ? ` · with ${c.hostName}` : ''}
                  </p>
                </div>
                <button onClick={() => openFeedback(c)} disabled={!!session}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 whitespace-nowrap disabled:opacity-50">
                  Rate
                </button>
              </div>
            ))}
            {toRate.length > 5 && (
              <button type="button" onClick={() => setShowAllToRate((v) => !v)}
                className="text-xs font-semibold text-amber-700 hover:text-amber-900 hover:underline">
                {showAllToRate ? 'Show less' : `Show ${toRate.length - 5} more`}
              </button>
            )}
          </div>
        </div>
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
        <div className="space-y-6">
          {(() => {
            const card = (c, kind) => (
              <ClassCard key={c._id} c={c} kind={kind} now={now}
                actions={(
                  <StudentClassActions cls={c} joining={joining} inClassId={session?.classId}
                    placeholder={kind === 'upcoming'}
                    asking={asking} onAskBack={askBack}
                    onJoin={join}
                    onSubmit={openSubmit} />
                )} />
            )
            return (
              <>
                {groups.live.length > 0 && (
                  <Section tone="live" title="Live now" count={groups.live.length}
                    hint="Happening right now — press Join now to attend.">
                    {groups.live.map((c) => card(c, 'live'))}
                  </Section>
                )}
                <Section tone="upcoming" title="Upcoming" count={groups.upcoming.length}
                  hint={groups.upcoming.length ? 'Your next sessions, soonest first. Join opens when the mentor starts the class.' : null}>
                  {groups.upcoming.length
                    ? <FoldList items={groups.upcoming} first={8} noun="upcoming sessions" render={(c) => card(c, 'upcoming')} />
                    : <p className="text-sm text-gray-400 bg-white rounded-2xl px-4 py-3">No upcoming sessions yet. New ones show up here when your mentor schedules them.</p>}
                </Section>
                {groups.ended.length > 0 && (
                  <Section tone="ended" title="Ended recently" count={groups.ended.length}
                    hint="These are over. You can still hand in work until the time shown on each.">
                    <FoldList items={groups.ended} first={5} noun="ended sessions" render={(c) => card(c, 'ended')} />
                  </Section>
                )}
                {groups.notStarted.length > 0 && (
                  <Section tone="missed" title="Didn't start" count={groups.notStarted.length}
                    hint="The planned time has passed and the mentor hasn't started these. If they start one, it moves to Live now.">
                    <FoldList items={groups.notStarted} first={3} noun="sessions" render={(c) => card(c, 'missed')} />
                  </Section>
                )}
              </>
            )
          })()}
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


// One review outcome = class + its timestamp (as a number, so an ISO string and
// a Date for the same instant match).
const outcomeKey = (classId, at) => `${classId}:${at ? new Date(at).getTime() : 0}`

// ── Tutor Session list pieces ──

// Colour budget for this page — one meaning each, nothing decorative:
//   red   = live right now          amber = needs the student's action
//   teal  = buttons (brand)         gray  = everything else
const SECTION_TONE = {
  live:     { dot: 'bg-red-500 animate-pulse' },
  upcoming: { dot: 'bg-gray-400' },
  ended:    { dot: 'bg-gray-300' },
  missed:   { dot: 'bg-gray-200' },
}

function Section({ tone, title, count, hint, children }) {
  const t = SECTION_TONE[tone]
  return (
    <section aria-label={title}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2.5 h-2.5 rounded-full ${t.dot}`} aria-hidden="true" />
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        <span className="text-xs font-semibold text-gray-400">{count}</span>
      </div>
      {hint && <p className="text-xs text-gray-400 mb-2">{hint}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  )
}

// Long groups (30 ended classes in a busy week) show the first few and fold
// the rest behind one button, so the next section is never pages away.
function FoldList({ items, first, noun, render }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, first)
  const hidden = items.length - shown.length
  return (
    <>
      {shown.map(render)}
      {items.length > first && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}
          className="w-full text-center text-xs font-semibold text-teal-700 bg-white border border-gray-100 rounded-xl py-2.5 hover:bg-gray-50">
          {all ? 'Show less ▴' : `Show all ${items.length} ${noun} (${hidden} more) ▾`}
        </button>
      )}
    </>
  )
}

const timeOf = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
function dayOf(d, now) {
  const x = new Date(d), today = new Date(now)
  const startOf = (v) => new Date(v.getFullYear(), v.getMonth(), v.getDate()).getTime()
  const diff = Math.round((startOf(x) - startOf(today)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return x.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
// "45 min" / "2h 10m" / "3 days"
function span(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  return `${Math.round(h / 24)} days`
}

// The time line under a card's title — says in words where the class stands.
function TimeLine({ c, kind, now }) {
  const start = c.scheduledStart ? new Date(c.scheduledStart).getTime() : null
  const plannedEnd = c.scheduledEnd ? new Date(c.scheduledEnd).getTime() : null
  if (kind === 'live') {
    const since = c.startedAt ? new Date(c.startedAt).getTime() : start
    return (
      <p className="text-xs text-gray-600">
        Started {timeOf(since)}{plannedEnd ? ` · planned till ${timeOf(plannedEnd)}` : ''}
        <span className="text-gray-400"> · running {span(now - since)}</span>
      </p>
    )
  }
  if (kind === 'upcoming') {
    const soon = start - now
    return (
      <p className="text-xs text-gray-600">
        <span className="font-semibold text-gray-800">{dayOf(start, now)}, {timeOf(start)}{plannedEnd ? ` – ${timeOf(plannedEnd)}` : ''}</span>
        {soon > 0
          ? <span className="text-gray-400"> · starts in {span(soon)}</span>
          : <span className="text-gray-500"> · waiting for the mentor to start</span>}
      </p>
    )
  }
  if (kind === 'ended') {
    const closes = c.submissionClosesAt ? new Date(c.submissionClosesAt).getTime() : null
    const left = closes ? closes - now : null
    return (
      <div className="text-xs text-gray-500">
        <p className="text-gray-400">Held {dayOf(c.startedAt || start, now)}, {timeOf(c.startedAt || start)}{c.endedAt ? ` – ${timeOf(c.endedAt)}` : ''}</p>
        {closes && left > 0 && (
          <p className={left <= 6 * 3600000 ? 'text-amber-700 font-semibold' : 'text-gray-500'}>
            Submit work by {dayOf(closes, now)}, {timeOf(closes)} · {span(left)} left
          </p>
        )}
      </div>
    )
  }
  return <p className="text-xs text-gray-400">Was planned for {dayOf(start, now)}, {timeOf(start)}</p>
}

const CARD_EDGE = {
  live: 'border border-red-200',
  upcoming: 'border border-gray-100',
  ended: 'border border-gray-100',
  missed: 'border border-gray-100 opacity-70',
}

function ClassCard({ c, kind, now, actions }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 ${CARD_EDGE[kind]}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {kind === 'live' && <span className="text-[10px] font-bold text-red-600">● LIVE</span>}
          <span className="text-[11px] text-gray-400">
            {[c.roomLabel && `${c.roomLabel} · ${c.trackLabel}`, isHallSession(c) && sessionTypeLabel(c), c.hostName && `with ${c.hostName}`]
              .filter(Boolean).join(' · ')}
          </span>
          <WorkChip work={c.myWork} />
        </div>
        <p className={`text-sm font-semibold [overflow-wrap:anywhere] ${kind === 'missed' ? 'text-gray-500' : 'text-gray-900'}`}>{c.title}</p>
        <TimeLine c={c} kind={kind} now={now} />
        {c.chapterName && c.chapterName !== c.title && !c.title?.includes(c.chapterName) && (
          <p className="text-xs text-gray-500 break-words mt-0.5">
            {c.subjectName ? `${c.subjectName} · ` : ''}{c.chapterName}
          </p>
        )}
        {c.chapterName && c.unitName && (
          <p className="text-xs text-gray-500 break-words mt-0.5">↳ {c.unitName}</p>
        )}
        {c.description && <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{c.description}</p>}
        {c.myWork?.status === 'changes_requested' && c.myWork.note && (
          <p className="text-xs text-gray-700 border-l-2 border-amber-400 pl-2 mt-1.5 line-clamp-2 [overflow-wrap:anywhere]" title={c.myWork.note}>
            <span className="font-semibold">{c.myWork.reviewerName || 'Mentor'}:</span> “{c.myWork.note}”
          </p>
        )}
      </div>
      {actions && <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto empty:hidden">{actions}</div>}
    </div>
  )
}

// Where the student's hand-in for a class stands, on its card.
function WorkChip({ work }) {
  if (!work) return null
  if (work.status === 'changes_requested') {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Redo asked</span>
  }
  if (work.status === 'reviewed') {
    return (
      <span className="text-[11px] text-gray-500">
        · ✓ Reviewed{work.marks != null ? ` · ${work.marks}${work.totalMarks != null ? `/${work.totalMarks}` : ''}` : ''}
      </span>
    )
  }
  return <span className="text-[11px] text-gray-500">· Submitted, waiting for review</span>
}

// A short rising pair — "the door opened". Synthesized like the room's own
// chimes so there is no audio asset to load, and only ever fired straight after
// a poll the student's own page ran, so autoplay policy is satisfied.
function playLetInChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    // A context can start suspended; the student clicked "Ask to be let back
    // in" on this page, so resuming is allowed.
    ctx.resume?.().catch(() => {})
    const t0 = ctx.currentTime
    // Rising three-note "you're in" — distinct from the room's other chimes.
    ;[[523.25, 0], [659.25, 0.16], [987.77, 0.32]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.52)
    })
    setTimeout(() => { ctx.close().catch(() => {}) }, 1500)
  } catch {
    // Sound is a nicety — the banner still shows.
  }
}
