import { createContext, useContext, useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { apiFetch } from '../api'

// Lazy-loaded so the LiveKit bundle only loads when a class is actually hosted.
const LiveRoom = lazy(() => import('./LiveRoom'))

// Hosting a live class is a LAYOUT-level concern, not a page-level one: with
// the room minimized to a corner window, the mentor navigates to other pages
// (Submissions, Syllabus, …) while the class keeps running. If the room lived
// inside a page, that navigation would unmount it and tear down the LiveKit
// connection — the mentor would silently leave the meeting. So the room
// renders HERE, above the router outlet, and pages talk to it via context.
const LiveSessionContext = createContext(null)

export function useLiveSession() {
  return useContext(LiveSessionContext)
}

export default function LiveSessionProvider({ children }) {
  const [session, setSession]     = useState(null)  // { classId, roomKey, trackKey, token, wsUrl, title, subtitle }
  const [minimized, setMinimized] = useState(false) // room shrunk to a corner window; the app usable behind it
  const [roomTracks, setRoomTracks] = useState([])  // switcher: tracks of the current room only
  const [switching, setSwitching]   = useState(false)
  const [mirrors, setMirrors]       = useState([])  // "roomKey/trackKey" tracks receiving our mirror
  const [subCounts, setSubCounts]   = useState({})  // classId → { total, pending } — shared with the pages
  const [toast, setToast]           = useState('')  // transient chip (hand raises, submissions)
  const [hostError, setHostError]   = useState('')  // switch/mirror failures, surfaced inside the room
  const toastTimer = useRef(null)
  const audioCtxRef = useRef(null)

  // A late "disconnected" event from a torn-down room must not evict us from the
  // one we just switched into — see leaveFrom().
  const sessionRef = useRef(null)
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

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

  const showToast = useCallback((msg) => {
    playDing()
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 6000)
  }, [])

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
    // Students handing work in reach the host over the same relay — including
    // from a track the host isn't currently teaching.
    if (p?.type === 'submission') {
      setSubCounts((c) => ({
        ...c,
        [p.classId]: { total: c[p.classId]?.total ?? p.count, pending: p.count },
      }))
      showToast(`📎 ${p.student?.name || 'A student'} submitted work in ${p.roomLabel} · ${p.trackLabel}`)
      return
    }
    if (p?.type !== 'hand') return
    // The payload's count is authoritative (same store the 20s poll reads).
    setRoomTracks(ts => ts.map(t =>
      t.roomKey === p.roomKey && t.trackKey === p.trackKey
        ? { ...t, handsRaised: p.count }
        : t,
    ))
    if (p.raised) {
      showToast(`🖐 ${p.student?.name || 'A student'} raised a hand in ${p.roomLabel} · ${p.trackLabel}`)
    }
  }, [showToast])

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
    setHostError('')
    if (mirrors.includes(key)) {
      try {
        await apiFetch(`/api/live-classes/manage/track/${track.roomKey}/${track.trackKey}/mirror/stop`, { method: 'POST', body: JSON.stringify({}) })
        setMirrors(m => m.filter(k => k !== key))
      } catch (err) {
        setHostError(err.message || 'Could not stop the mirror')
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
      setHostError(err.message || 'Could not start the mirror')
    }
  }

  // Start a class (or re-enter a live one) and connect to its room. Throws on
  // failure so the calling page can show the error next to its own controls.
  // If we're already connected to this very class, just expand the window —
  // fetching a fresh token would force a pointless reconnect.
  const startOrEnter = useCallback(async (cls) => {
    if (sessionRef.current?.classId === cls._id) { setMinimized(false); return }
    const path = cls.status === 'live'
      ? `/api/live-classes/manage/${cls._id}/host-token`
      : `/api/live-classes/manage/${cls._id}/start`
    const d = await apiFetch(path, { method: cls.status === 'live' ? 'GET' : 'POST' })
    const s = sessionFrom(d, cls.title)
    setHostError('')
    setSession(s)
    setMinimized(false)
    await loadRoomTracks(s.roomKey)
  }, [loadRoomTracks])

  // Hop to the other track in this room and remount — LiveRoom is keyed on the
  // token, so the old connection is fully dropped. The server enters the class
  // already running there, or starts that track's next booking on the way in.
  const switchTrack = async (track) => {
    if (switching || !track) return
    // One mis-click shouldn't pull the host out of a room mid-class — confirm
    // first, and be explicit that switching also starts a not-yet-live booking.
    const label = `${track.roomLabel} · ${track.trackLabel}`
    const msg = track.state === 'scheduled'
      ? `Switch to ${label}? This will start "${track.title}". Your current class stays live and its students stay connected; you can switch back any time.`
      : `Switch to ${label}? Your current class stays live and its students stay connected; you can switch back any time.`
    if (!window.confirm(msg)) return
    setSwitching(true); setHostError('')
    try {
      const d = await apiFetch(
        `/api/live-classes/manage/track/${track.roomKey}/${track.trackKey}/open`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      const s = sessionFrom(d, `${track.roomLabel} · ${track.trackLabel}`)
      setSession(s)
      setMirrors([])   // forwarding died with the old connection
      await loadRoomTracks(s.roomKey)
    } catch (err) {
      setHostError(err.message || 'Could not switch track')
    } finally {
      setSwitching(false)
    }
  }

  const toggleMinimize = useCallback(() => setMinimized((m) => !m), [])

  // Only act on a disconnect from the room we're actually in. Switching tracks
  // unmounts the previous LiveKitRoom, and its onDisconnected can land after the
  // new one is up — that stale event must be ignored, not treated as "left".
  const leaveFrom = (token) => {
    if (sessionRef.current?.token !== token) return
    setSession(null)
    setMinimized(false)
    setMirrors([])   // forwarding stops when the source disconnects
  }

  return (
    <LiveSessionContext.Provider value={{ session, minimized, toggleMinimize, startOrEnter, subCounts, setSubCounts }}>
      {children}

      {/* While the room is minimized its in-room toast overlay is hidden, so
          hand-raise / submission pings surface here — on whatever page the
          mentor is browsing. */}
      {session && minimized && toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] bg-black/80 text-amber-100 text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-400/50 shadow-lg max-w-[90vw] truncate">
          {toast}
        </div>
      )}

      {/* The room element keeps this exact slot whether full-screen or
          minimized, and across every route change — that's what keeps the
          LiveKit connection alive. */}
      {session && (
        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#0b0b0f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>Loading class…</div>}>
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
            notice={hostError}
            toast={toast}
            onHandEvent={onHandEvent}
            minimized={minimized}
            onToggleMinimize={toggleMinimize}
            onLeave={() => leaveFrom(session.token)}
          />
        </Suspense>
      )}
    </LiveSessionContext.Provider>
  )
}
