import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api'
import { useAuth } from '../auth/AuthContext'

const LiveRoom = lazy(() => import('../components/LiveRoom'))

// The page behind a track's permanent link: /live/room1/track1
//
// The URL names a TRACK, never a class, so it never expires — it resolves to
// whichever class holds that track at the moment it's opened. Share it once with a
// batch and it keeps working for every class that track ever runs.
//
// Mentors and admins land here as host (opening the track if it's idle); students
// land here as participants and wait until something goes live.
export default function TrackRoomPage() {
  const { roomKey, trackKey } = useParams()
  const { role } = useAuth()
  const isHost = role === 'mentor' || role === 'admin'

  const [status, setStatus]   = useState(null)   // { room, track, liveClass, next }
  const [session, setSession] = useState(null)   // { classId, token, wsUrl, ... }
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [notFound, setNotFound] = useState(false)
  const [handRaised, setHandRaised] = useState(false)

  const sessionRef = useRef(null)
  useEffect(() => { sessionRef.current = session }, [session])

  const loadStatus = useCallback(async () => {
    try {
      const d = await apiFetch(`/api/live-classes/track/${roomKey}/${trackKey}`)
      setStatus(d)
      setNotFound(false)
    } catch (err) {
      // A bad room/track in the URL is permanent — stop polling and say so.
      if (/no such/i.test(err.message || '')) setNotFound(true)
      else setError(err.message || 'Could not load this track')
    }
  }, [roomKey, trackKey])

  useEffect(() => { loadStatus() }, [loadStatus])

  // Poll while idle so a student sitting on the link drops straight in when the
  // mentor starts. Paused inside the room.
  useEffect(() => {
    if (session || notFound) return
    const t = setInterval(loadStatus, 15_000)
    return () => clearInterval(t)
  }, [session, notFound, loadStatus])

  const label = status ? `${status.room.label} · ${status.track.label}` : ''

  const enter = async () => {
    setBusy(true); setError('')
    try {
      const d = isHost
        // Hosts open the track whatever state it's in — idle tracks get a session.
        ? await apiFetch(`/api/live-classes/manage/track/${roomKey}/${trackKey}/open`,
            { method: 'POST', body: JSON.stringify({}) })
        // Students can only join a class that's already running.
        : await apiFetch(`/api/live-classes/${status.liveClass._id}/join-token`)
      const c = d.liveClass
      setHandRaised(false)   // the server drops any stale hand on (re)join
      setSession({
        classId: c?._id || status?.liveClass?._id || null,
        token: d.token,
        wsUrl: d.wsUrl,
        title: c?.title || label,
        subtitle: [c?.room?.label || c?.roomLabel, c?.track?.label || c?.trackLabel]
          .filter(Boolean).join(' · ') || label,
        // Hosts get the full class (host.userId); students the flat shape.
        hostUserId: c?.hostUserId || (c?.host?.userId ? String(c.host.userId) : ''),
      })
    } catch (err) {
      setError(err.message || 'Could not enter this track')
    } finally {
      setBusy(false)
    }
  }

  // Ignore a disconnect from a room we've already left behind. info.removed:
  // the host removed this student — say so rather than silently dropping them.
  const leaveFrom = (token, info) => {
    if (sessionRef.current?.token !== token) return
    setSession(null)
    setHandRaised(false)
    setError(info?.removed ? 'The host removed you from this class.' : '')
    loadStatus()
  }

  // 🖐 toggle (students only) — the server notifies the host, even when they're
  // currently teaching in the other track of the room.
  const toggleHand = async () => {
    if (!session?.classId) return
    const next = !handRaised
    try {
      await apiFetch(`/api/live-classes/${session.classId}/hand`, {
        method: 'POST', body: JSON.stringify({ raised: next }),
      })
      setHandRaised(next)
    } catch {
      // Best-effort — a failed raise just leaves the button as it was.
    }
  }

  if (session) {
    return (
      <Suspense fallback={<Splash>Loading class…</Splash>}>
        <LiveRoom
          token={session.token}
          wsUrl={session.wsUrl}
          canHost={isHost}
          hostIdentity={session.hostUserId}
          classId={session.classId}
          title={session.title}
          subtitle={session.subtitle}
          onRaiseHand={!isHost && session.classId ? toggleHand : undefined}
          handRaised={handRaised}
          onLeave={(info) => leaveFrom(session.token, info)}
        />
      </Suspense>
    )
  }

  if (notFound) {
    return <Centered title="Track not found"
      body={`There's no "${roomKey} / ${trackKey}" in this system. Check the link.`} />
  }

  if (!status) return <Splash>Loading…</Splash>

  const live = status.liveClass
  // A host may start a booking that's due. Nobody — host included — can conjure a
  // class on an empty track any more; only an admin schedules.
  const canStart = isHost && !live && !!status.next?.due

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
        <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-600 mb-2">{label}</p>

        {live ? (
          <>
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[11px] font-bold uppercase text-red-600">Live now</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-1">{live.title}</h1>
            {live.hostName && <p className="text-sm text-gray-400 mb-5">with {live.hostName}</p>}
          </>
        ) : status.restricted ? (
          // Something is running here, but this student isn't on its list. Keep
          // polling — the admin can add them mid-class and they'll drop in.
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-1">This session is private</h1>
            <p className="text-sm text-gray-400 mb-5">
              The class running on this track is limited to selected students.
              If you've been added, this page will let you in automatically.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-1">
              {canStart ? 'Ready to start' : 'Nothing live right now'}
            </h1>
            <p className="text-sm text-gray-400 mb-5">
              {canStart
                ? `"${status.next.title}" is due — starting puts you live on this track.`
                : status.next
                  ? `Next: ${status.next.title} — ${new Date(status.next.scheduledStart).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
                  : isHost
                    ? 'Nothing is scheduled on this track. An admin books classes into it.'
                    : 'This page updates on its own — keep it open and you\'ll join automatically when the class starts.'}
            </p>
          </>
        )}

        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        {(live || canStart) ? (
          <button onClick={enter} disabled={busy}
            className="w-full px-5 py-3 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400">
            {busy ? 'Connecting…' : live ? 'Join now' : 'Start class'}
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
            <span className="w-4 h-4 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
            {status.restricted ? 'Waiting for access…' : 'Waiting for the class to start…'}
          </div>
        )}
      </div>
    </div>
  )
}

function Splash({ children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0b0b0f', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
    }}>{children}</div>
  )
}

function Centered({ title, body }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-1">{title}</h1>
        <p className="text-sm text-gray-400">{body}</p>
      </div>
    </div>
  )
}
