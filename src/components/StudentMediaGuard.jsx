import { useCallback, useEffect, useRef, useState } from 'react'
import { useDataChannel, useLocalParticipant, useLocalParticipantPermissions } from '@livekit/components-react'
import { NOTIFY_TOPIC, SOURCE_LABEL, canPublishSource } from '../utils/livekitPermissions'

// The student's side of the host's Zoom-style media controls. Must live inside
// <LiveKitRoom>. Three jobs:
//
//   1. Explain. LiveKit already did the muting/unpublishing server-side; the
//      server also sends a data message saying who did it and whether it's a
//      soft mute (you may turn it back on) or a lock (you may not). Without
//      this the student just sees their mic die.
//   2. Show the lock. While a source is revoked LiveKit's control bar hides
//      that button entirely — a persistent banner says why it's gone.
//   3. "Ask to unmute". The host can't switch a student's mic on remotely
//      (self-hosted LiveKit refuses it, and it'd be wrong anyway) — they ask,
//      and the student turns it on with one tap here.
//
// Belt and braces: if a revoked source is somehow still on locally (a race
// with the permission update), switch it off ourselves.
export default function StudentMediaGuard({ classId }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
  const perms = useLocalParticipantPermissions()
  const micLocked = !canPublishSource(perms, 'mic')
  const camLocked = !canPublishSource(perms, 'camera')

  const [notice, setNotice] = useState('')
  const [ask, setAsk] = useState(null)   // { source, by }
  const noticeTimer = useRef(null)
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  const flash = useCallback((msg) => {
    setNotice(msg)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 8000)
  }, [])

  const switchOff = useCallback((source) => {
    const p = source === 'mic'
      ? localParticipant.setMicrophoneEnabled(false)
      : localParticipant.setCameraEnabled(false)
    p.catch(() => { /* already off, or the server beat us to it */ })
  }, [localParticipant])

  useEffect(() => { if (micLocked && isMicrophoneEnabled) switchOff('mic') }, [micLocked, isMicrophoneEnabled, switchOff])
  useEffect(() => { if (camLocked && isCameraEnabled) switchOff('camera') }, [camLocked, isCameraEnabled, switchOff])
  // A lock landing while an "ask" is still showing makes the prompt moot.
  const visibleAsk = ask && !(ask.source === 'mic' ? micLocked : camLocked) ? ask : null

  useDataChannel(NOTIFY_TOPIC, (msg) => {
    let p
    try { p = JSON.parse(new TextDecoder().decode(msg.payload)) } catch { return }
    if (p?.type !== 'media') return
    if (p.classId && classId && p.classId !== String(classId)) return
    const who = p.by || 'The host'
    const what = SOURCE_LABEL[p.source] || 'microphone'
    switch (p.action) {
      case 'muted':
        switchOff(p.source)
        flash(`${who} turned off your ${what}${p.all ? ' (everyone was muted)' : ''}. You can turn it back on when you need it.`)
        break
      case 'locked':
        switchOff(p.source)
        flash(`${who} turned off your ${what}. You can't turn it on until the host allows it.`)
        break
      case 'unlocked':
        flash(`${who} allowed you to use your ${what} again.`)
        break
      case 'ask':
        setAsk({ source: p.source === 'camera' ? 'camera' : 'mic', by: who })
        break
      default:
        // 'removed' — the disconnect that follows carries the reason.
        break
    }
  })

  const accept = async () => {
    const a = visibleAsk
    setAsk(null)
    if (!a) return
    try {
      if (a.source === 'mic') await localParticipant.setMicrophoneEnabled(true)
      else await localParticipant.setCameraEnabled(true)
    } catch (e) {
      flash(e?.message || `Could not turn on your ${SOURCE_LABEL[a.source]}`)
    }
  }

  const lockText = micLocked && camLocked
    ? 'Your microphone and camera are off — the host has disabled them'
    : micLocked ? 'Your microphone is off — the host has disabled it'
      : camLocked ? 'Your camera is off — the host has disabled it' : ''

  return (
    <>
      {/* Just above LiveKit's control bar, centred, clear of the side widgets. */}
      {(lockText || notice) && (
        <div style={{
          position: 'absolute', left: '50%', bottom: 72, transform: 'translateX(-50%)',
          zIndex: 25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          maxWidth: 'min(92vw, 520px)', pointerEvents: 'none',
        }}>
          {notice && (
            <div style={{
              background: 'rgba(0,0,0,0.82)', color: '#fef3c7', textAlign: 'center',
              fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 10,
              border: '1px solid rgba(250,204,21,0.5)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {notice}
            </div>
          )}
          {lockText && (
            <div style={{
              background: 'rgba(127,29,29,0.92)', color: '#fff', textAlign: 'center',
              fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999,
              border: '1px solid rgba(248,113,113,0.55)',
            }}>
              🔒 {lockText}
            </div>
          )}
        </div>
      )}

      {visibleAsk && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Host request"
          style={{
            position: 'absolute', inset: 0, zIndex: 44,
            background: 'rgba(0,0,0,0.55)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div style={{
            background: '#16161c', color: '#fff', borderRadius: 16, padding: 20,
            width: '100%', maxWidth: 360, border: '1px solid rgba(255,255,255,0.14)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.6)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 8 }}>{visibleAsk.source === 'mic' ? '🎙' : '📷'}</div>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>
              {visibleAsk.by} is asking you to {visibleAsk.source === 'mic' ? 'unmute' : 'turn on your camera'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 16 }}>
              Only you can turn your {SOURCE_LABEL[visibleAsk.source]} on — the host can't do it for you.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setAsk(null)}
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none',
                  borderRadius: 10, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >Not now</button>
              <button
                onClick={accept}
                autoFocus
                style={{
                  flex: 1, background: '#0d9488', color: '#fff', border: 'none',
                  borderRadius: 10, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >{visibleAsk.source === 'mic' ? 'Unmute' : 'Turn on camera'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
