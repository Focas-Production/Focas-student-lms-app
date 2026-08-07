import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
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

// Mentors host what the admin books for them — they don't schedule. This page is
// their assignment list plus the controls to run a class.
export default function MentorLiveClassesPage() {
  const [classes, setClasses]   = useState(null)
  const [loadError, setLoadError] = useState('')   // why the list is empty, if it failed
  const [busyId, setBusyId]     = useState(null)
  const [error, setError]       = useState('')
  const [session, setSession]   = useState(null)   // { classId, roomKey, token, wsUrl, title, subtitle }
  const [roomTracks, setRoomTracks] = useState([]) // switcher: tracks of the current room only
  const [switching, setSwitching]   = useState(false)
  const [mirrors, setMirrors]       = useState([]) // "roomKey/trackKey" tracks receiving our mirror
  const [syllabus, setSyllabus]     = useState(null) // subjects with chapter/unit completion
  const [attendance, setAttendance] = useState(null)
  const [toast, setToast]           = useState('')   // transient in-room chip (hand raises)
  const toastTimer = useRef(null)
  const audioCtxRef = useRef(null)

  // Soft two-note "ding" for a raised hand, synthesized so there's no audio
  // asset to load. The AudioContext is created lazily on first use — by then
  // the mentor has clicked Start/Enter, so autoplay policy allows it.
  const playDing = () => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') ctx.resume()
      const note = (freq, at) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, at)
        gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45)
        osc.connect(gain).connect(ctx.destination)
        osc.start(at)
        osc.stop(at + 0.5)
      }
      note(880, ctx.currentTime)          // A5
      note(1174.66, ctx.currentTime + 0.12) // D6
    } catch {
      // No audio available (rare) — the toast and badge still show.
    }
  }

  // A late "disconnected" event from a torn-down room must not evict us from the
  // one we just switched into — see leaveFrom().
  const sessionRef = useRef(null)
  useEffect(() => { sessionRef.current = session }, [session])

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

  useEffect(() => { load() }, [load])

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

  // A mentor moves between the tracks of the room they're in, so the switcher is
  // scoped to that room — Track 1 ↔ Track 2, never across to the other room.
  const loadRoomTracks = useCallback(async (roomKey) => {
    if (!roomKey) return setRoomTracks([])
    try {
      const d = await apiFetch(`/api/live-classes/manage/live-tracks?roomKey=${encodeURIComponent(roomKey)}`)
      setRoomTracks(d.tracks || [])
    } catch {
      setRoomTracks([])
    }
  }, [])

  // Track states drift while hosting — the other track's class may start or end.
  useEffect(() => {
    if (!session) return
    const t = setInterval(() => loadRoomTracks(session.roomKey), 20_000)
    return () => clearInterval(t)
  }, [session, loadRoomTracks])

  // Server-pushed notifications, relayed through the LiveKit data channel of
  // whichever room we're connected to. Hand raises can come from ANY track —
  // including one we're not in — so the badge/toast names the track.
  const onHandEvent = useCallback((p) => {
    if (p?.type !== 'hand') return
    // The payload's count is authoritative (same store the 20s poll reads).
    setRoomTracks(ts => ts.map(t =>
      t.roomKey === p.roomKey && t.trackKey === p.trackKey
        ? { ...t, handsRaised: p.count }
        : t,
    ))
    if (p.raised) {
      playDing()
      setToast(`🖐 ${p.student?.name || 'A student'} raised a hand in ${p.roomLabel} · ${p.trackLabel}`)
      clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(''), 6000)
    }
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const sessionFrom = (d, fallbackTitle) => {
    const c = d.liveClass || {}
    return {
      classId: c._id,
      roomKey: c.room?.key || null,
      trackKey: c.track?.key || null,
      token: d.token,
      wsUrl: d.wsUrl,
      title: c.title || fallbackTitle,
      subtitle: [c.room?.label, c.track?.label].filter(Boolean).join(' · '),
    }
  }

  // One-way mirror: broadcast this host's camera/mic into another track while
  // staying in the current one. Forwarding dies with the source connection, so
  // any switch/leave clears the local list too.
  const toggleMirror = async (track) => {
    const key = `${track.roomKey}/${track.trackKey}`
    const label = `${track.roomLabel} · ${track.trackLabel}`
    setError('')
    if (mirrors.includes(key)) {
      try {
        await apiFetch(`/api/live-classes/manage/track/${track.roomKey}/${track.trackKey}/mirror/stop`, { method: 'POST', body: JSON.stringify({}) })
        setMirrors(m => m.filter(k => k !== key))
      } catch (err) {
        setError(err.message || 'Could not stop the mirror')
      }
      return
    }
    if (!window.confirm(
      `Broadcast your camera and mic into ${label}?\n\nThis is one-way: students there will see and hear you live, but you will NOT see or hear them. You stay in your current track.`,
    )) return
    try {
      await apiFetch(`/api/live-classes/manage/track/${track.roomKey}/${track.trackKey}/mirror`, {
        method: 'POST',
        body: JSON.stringify({ fromRoomKey: session?.roomKey, fromTrackKey: session?.trackKey }),
      })
      setMirrors(m => [...m, key])
      await loadRoomTracks(session?.roomKey)   // target may have just gone live
    } catch (err) {
      setError(err.message || 'Could not start the mirror')
    }
  }

  const startOrEnter = async (cls) => {
    setBusyId(cls._id); setError('')
    try {
      // "start" flips it live and returns a host token; if already live it re-issues one.
      const path = cls.status === 'live'
        ? `/api/live-classes/manage/${cls._id}/host-token`
        : `/api/live-classes/manage/${cls._id}/start`
      const d = await apiFetch(path, { method: cls.status === 'live' ? 'GET' : 'POST' })
      const s = sessionFrom(d, cls.title)
      setSession(s)
      await loadRoomTracks(s.roomKey)
    } catch (err) {
      setError(err.message || 'Could not start the class')
    } finally {
      setBusyId(null)
    }
  }

  // Hop to the other track in this room and remount — LiveRoom is keyed on the
  // token, so the old connection is fully dropped. The server enters the class
  // already running there, or starts that track's next booking on the way in.
  const switchTrack = async (track) => {
    if (switching || !track) return
    // One mis-click shouldn't pull the host out of a room mid-class — confirm
    // first, and be explicit that switching also starts a not-yet-live booking.
    const label = `${track.roomLabel} · ${track.trackLabel}`
    const msg = track.state === 'scheduled'
      ? `Switch to ${label}? This will start "${track.title}". Students in your current track stay connected.`
      : `Switch to ${label}? Students in your current track stay connected.`
    if (!window.confirm(msg)) return
    setSwitching(true); setError('')
    try {
      const d = await apiFetch(
        `/api/live-classes/manage/track/${track.roomKey}/${track.trackKey}/open`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      const s = sessionFrom(d, `${track.roomLabel} · ${track.trackLabel}`)
      setSession(s)
      setMirrors([])   // forwarding died with the old connection
      await Promise.all([loadRoomTracks(s.roomKey), load()])
    } catch (err) {
      setError(err.message || 'Could not switch track')
    } finally {
      setSwitching(false)
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

  // Only act on a disconnect from the room we're actually in. Switching tracks
  // unmounts the previous LiveKitRoom, and its onDisconnected can land after the
  // new one is up — that stale event must be ignored, not treated as "left".
  const leaveFrom = (token) => {
    if (sessionRef.current?.token !== token) return
    setSession(null)
    setMirrors([])   // forwarding stops when the source disconnects
    load()
  }

  if (session) {
    return (
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0b0b0f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>Loading class…</div>}>
        <LiveRoom
          token={session.token}
          wsUrl={session.wsUrl}
          canHost
          title={session.title}
          subtitle={session.subtitle}
          tracks={roomTracks}
          activeClassId={session.classId}
          onSwitchTrack={switchTrack}
          switching={switching}
          mirrors={mirrors}
          onToggleMirror={toggleMirror}
          notice={error}
          toast={toast}
          onHandEvent={onHandEvent}
          onLeave={() => leaveFrom(session.token)}
        />
      </Suspense>
    )
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
                    {busyId === c._id ? '…' : c.status === 'live' ? 'Enter' : 'Start'}
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
    </div>
  )
}
