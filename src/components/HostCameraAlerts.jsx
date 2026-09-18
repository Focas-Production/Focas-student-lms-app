import { useCallback, useEffect, useRef, useState } from 'react'
import { useDataChannel } from '@livekit/components-react'
import { apiFetch } from '../api'
import { NOTIFY_TOPIC } from '../utils/livekitPermissions'

// Things that happen to a host's class WITHOUT the host doing them, and which
// they must not miss with the Participants drawer closed. Must live inside
// <LiveKitRoom>, and is mounted for hosts for the whole session (not just while
// the drawer is open) — that is the point of it.
//
//   a student was removed by the camera rule  → falling two-note "someone went"
//   a removed student asks to come back       → rising knock, and it REPEATS
//                                               every 20 s until answered
//
// The two are deliberately different sounds: one is information, the other is a
// question waiting on the host. The knock only ever plays for the host — the
// message is addressed to their identity through the cross-room relay, so a
// mentor teaching Track 2 still hears Track 1's request.
//
// onPendingRejoins(n) — the count of students waiting on an answer, so the 👥
// button can carry a badge while the drawer is closed.
// onOpenPanel() — the banner's "Open participants" action.
export default function HostCameraAlerts({ classId, onPendingRejoins, onOpenPanel }) {
  const [toast, setToast] = useState('')          // transient: someone was removed
  const [asking, setAsking] = useState([])        // [{ id, name }] still waiting
  const toastTimer = useRef(null)
  const audioRef = useRef(null)
  const nagTimer = useRef(null)

  useEffect(() => () => {
    clearTimeout(toastTimer.current)
    clearInterval(nagTimer.current)
    audioRef.current?.close?.().catch(() => {})
  }, [])

  // Synthesized so there's no audio asset to load or fail. By the time any of
  // this fires the host has clicked Start/Enter, so autoplay policy allows it.
  const play = useCallback((notes) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      if (!audioRef.current) audioRef.current = new Ctx()
      const ctx = audioRef.current
      if (ctx.state === 'suspended') ctx.resume()
      const t0 = ctx.currentTime
      notes.forEach(([freq, at, vol = 0.22]) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, t0 + at)
        gain.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.34)
        osc.connect(gain).connect(ctx.destination)
        osc.start(t0 + at)
        osc.stop(t0 + at + 0.36)
      })
    } catch {
      // Sound is a nicety — the toast and the badge still show.
    }
  }, [])

  // Falling: a student has gone. Rising knock: a student is at the door.
  const playRemoved = useCallback(() => play([[660, 0], [440, 0.16]]), [play])
  const playKnock = useCallback(() => play([[587.33, 0, 0.26], [784, 0.14, 0.26], [1046.5, 0.28, 0.26]]), [play])

  const flash = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 9000)
  }, [])

  // Seed from the server so a host who joins late — or reloads — sees requests
  // that arrived while they were away, rather than only live pushes.
  const syncFromPolicy = useCallback((policy) => {
    if (!policy) return
    const waiting = (policy.removed || [])
      .filter((r) => r.request?.status === 'pending')
      .map((r) => ({ id: r.userId, name: r.name || 'A student' }))
    setAsking(waiting)
  }, [])

  useEffect(() => {
    if (!classId) return undefined
    let alive = true
    apiFetch(`/api/live-classes/manage/${classId}/media`)
      .then((d) => { if (alive) syncFromPolicy(d?.policy) })
      .catch(() => { /* the live pushes still work */ })
    return () => { alive = false }
  }, [classId, syncFromPolicy])

  useEffect(() => { onPendingRejoins?.(asking.length) }, [asking.length, onPendingRejoins])

  // While anyone is waiting, knock again periodically — a host mid-explanation
  // will miss one chime, and a student locked out of the class is stuck until
  // this is answered. Stops the moment the list empties.
  useEffect(() => {
    if (!asking.length) return undefined
    nagTimer.current = setInterval(playKnock, 20_000)
    return () => clearInterval(nagTimer.current)
  }, [asking.length, playKnock])

  useDataChannel(NOTIFY_TOPIC, (msg) => {
    let p
    try { p = JSON.parse(new TextDecoder().decode(msg.payload)) } catch { return }
    if (p.classId && classId && p.classId !== String(classId)) return

    if (p.type === 'camera-removed') {
      const names = (p.students || []).map((x) => x.name || 'A student')
      if (!names.length) return
      playRemoved()
      const blocked = (p.students || []).filter((x) => x.blocked).length
      flash(`📷 ${names.join(', ')} ${names.length === 1 ? 'was' : 'were'} removed — camera stayed off${
        blocked ? `. ${blocked === names.length ? 'They now need' : `${blocked} of them now need`} you to let them back in.` : ''}`)
      return
    }
    if (p.type === 'rejoin-request') {
      syncFromPolicy(p.policy)
      playKnock()
      return
    }
    // Any policy change (an approve, a decline, a readmit from another host
    // window) re-settles the waiting list.
    if (p.type === 'media-policy') syncFromPolicy(p.policy)
  })

  if (!toast && !asking.length) return null

  return (
    // focas-top-banner: on a phone this drops below the title chip (LiveRoom CSS).
    <div className="focas-top-banner" style={{
      position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
      zIndex: 27, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      width: 'min(94vw, 560px)', pointerEvents: 'none',
    }}>
      {asking.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', pointerEvents: 'auto',
          background: 'rgba(120,53,15,0.96)', color: '#fff',
          padding: '8px 10px', borderRadius: 12,
          border: '1px solid rgba(245,158,11,0.7)', boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
        }}>
          <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>🙋</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>
              {asking.length === 1
                ? `${asking[0].name} is asking to come back`
                : `${asking.length} students are asking to come back`}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
              {asking.length === 1
                ? 'They can’t rejoin until you let them in.'
                : asking.map((a) => a.name).join(', ')}
            </div>
          </div>
          {onOpenPanel && (
            <button
              onClick={onOpenPanel}
              style={{
                background: '#0d9488', color: '#fff', border: 'none', borderRadius: 10,
                padding: '8px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >Review</button>
          )}
        </div>
      )}
      {toast && (
        <div style={{
          background: 'rgba(0,0,0,0.85)', color: '#fed7aa', textAlign: 'center',
          fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 10,
          border: '1px solid rgba(251,146,60,0.5)',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
