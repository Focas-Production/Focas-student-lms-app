import { createContext, useContext, useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { apiFetch } from '../api'

// Lazy-loaded so the ~1.4 MB LiveKit bundle is only fetched when a student
// actually joins a class, not on every page visit.
const LiveRoom = lazy(() => import('./LiveRoom'))

// The student's live class is a LAYOUT-level concern, exactly like the mentor's
// (see LiveSessionProvider.jsx): with the room minimized to a corner window the
// student uses the page behind it — most of all the Live Classes page's own
// "Submit work" dialog, which scrolls properly on a phone where the in-room
// overlay is cramped — and may wander to other pages. If the room lived inside
// LiveClassesPage, leaving that page would unmount it and drop the student out
// of the class. So the room renders HERE, above the router outlet, and the page
// talks to it through context.
const StudentLiveSessionContext = createContext(null)

export function useStudentLiveSession() {
  return useContext(StudentLiveSessionContext)
}

export default function StudentLiveSessionProvider({ children }) {
  const [session, setSession]       = useState(null)  // { classId, token, wsUrl, title, subtitle, hostUserId }
  const [minimized, setMinimized]   = useState(false) // room shrunk to a corner window; the app usable behind it
  const [joining, setJoining]       = useState(null)  // class id being joined
  const [handRaised, setHandRaised] = useState(false)
  const [notice, setNotice]         = useState('')    // why the last session ended, when it wasn't the student's choice

  // A late "disconnected" event from a torn-down room must not evict us from
  // the one we just joined — see leaveFrom().
  const sessionRef = useRef(null)
  useEffect(() => { sessionRef.current = session }, [session])

  // Join a live class and connect to its room. Throws on failure so the calling
  // page can show the error next to its own controls. Already in this very
  // class (minimized) → just expand the window; a fresh token would force a
  // pointless reconnect.
  const join = useCallback(async (cls) => {
    if (sessionRef.current?.classId === cls._id) { setMinimized(false); return }
    setJoining(cls._id)
    setNotice('')
    try {
      const d = await apiFetch(`/api/live-classes/${cls._id}/join-token`)
      setHandRaised(false)   // the server drops any stale hand on (re)join
      setSession({
        classId: cls._id,
        token: d.token,
        wsUrl: d.wsUrl,
        title: d.liveClass?.title || cls.title,
        subtitle: [d.liveClass?.roomLabel, d.liveClass?.trackLabel].filter(Boolean).join(' · '),
        hostUserId: d.liveClass?.hostUserId || '',
      })
      setMinimized(false)
    } finally {
      setJoining(null)
    }
  }, [])

  // 🖐 toggle — the server notifies the host, even when they're currently
  // teaching in the other track of the room.
  const toggleHand = useCallback(async () => {
    const s = sessionRef.current
    if (!s) return
    const next = !handRaised
    try {
      await apiFetch(`/api/live-classes/${s.classId}/hand`, {
        method: 'POST', body: JSON.stringify({ raised: next }),
      })
      setHandRaised(next)
    } catch {
      // Best-effort — a failed raise just leaves the button as it was.
    }
  }, [handRaised])

  const toggleMinimize = useCallback(() => setMinimized((m) => !m), [])
  const clearNotice = useCallback(() => setNotice(''), [])

  // Only act on a disconnect from the room we're actually in. Joining another
  // class remounts LiveKitRoom (it's keyed on the token), and the old room's
  // onDisconnected can land after the new one is up — that stale event must be
  // ignored, not treated as "left". info.removed: the host removed this
  // student — say so on the page, don't just vanish.
  const leaveFrom = (token, info) => {
    if (sessionRef.current?.token !== token) return
    setSession(null)
    setMinimized(false)
    setHandRaised(false)
    setNotice(info?.removed ? 'The host removed you from this class.' : '')
  }

  return (
    <StudentLiveSessionContext.Provider value={{ session, minimized, toggleMinimize, join, joining, notice, clearNotice }}>
      {children}

      {/* The room element keeps this exact slot whether full-screen or
          minimized, and across every route change — that's what keeps the
          LiveKit connection alive. */}
      {session && (
        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#0b0b0f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>Loading class…</div>}>
          <LiveRoom
            token={session.token}
            wsUrl={session.wsUrl}
            canHost={false}
            hostIdentity={session.hostUserId}
            title={session.title}
            subtitle={session.subtitle}
            onRaiseHand={toggleHand}
            handRaised={handRaised}
            submitClass={{ id: session.classId, title: session.title }}
            minimized={minimized}
            onToggleMinimize={toggleMinimize}
            onLeave={(info) => leaveFrom(session.token, info)}
          />
        </Suspense>
      )}
    </StudentLiveSessionContext.Provider>
  )
}
