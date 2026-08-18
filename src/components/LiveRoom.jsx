import { useCallback, useRef, useState, lazy, Suspense } from 'react'
import { LiveKitRoom, VideoConference, useDataChannel, useLocalParticipant } from '@livekit/components-react'
import '@livekit/components-styles'
import ErrorBoundary from './ErrorBoundary'

// Only pulled in when a student actually opens the submit panel — it carries the
// recorder, and the class stage shouldn't pay for it on every join.
const SubmitWorkPanel = lazy(() => import('./SubmitWorkPanel'))

// Topic of server-pushed data messages (hand raises etc.) — must match the
// server's NOTIFY_TOPIC in services/livekitService.js.
const NOTIFY_TOPIC = 'focas-notify'

// The live class room. Uses LiveKit's prebuilt <VideoConference>, which is fully
// responsive (phone / tablet / laptop / desktop): the control bar collapses to
// icons on narrow screens, chat becomes a full-screen overlay on mobile, and the
// stage switches between grid and screen-share focus automatically. It also
// renders room audio and handles connection/reconnection states internally.
//
// Optional host-only props enable the track switcher:
//   tracks        — [{ roomLabel, trackLabel, classId, title, handsRaised }]
//   activeClassId — which of them we're currently connected to
//   onSwitchTrack(classId), switching
//   onHandEvent   — server-pushed notifications (a hand raised in any track)
//   toast         — transient info chip (e.g. "X raised a hand in Track 2")
//
// Optional student-only props:
//   onRaiseHand, handRaised — the 🖐 toggle; the server relays it to the host
//   submitClass — { id, title } enables the 📎 submit panel inside the room
export default function LiveRoom(props) {
  return (
    <ErrorBoundary onReset={props.onLeave}>
      <LiveRoomInner {...props} />
    </ErrorBoundary>
  )
}

function LiveRoomInner({
  token, wsUrl, title, subtitle, onLeave, canHost,
  tracks, activeClassId, onSwitchTrack, switching, mirrors, onToggleMirror, notice,
  onHandEvent, toast, onRaiseHand, handRaised, submitClass,
}) {
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submittedCount, setSubmittedCount] = useState(0)
  // Hosts get an "are you sure" on LiveKit's Leave button — one mis-click would
  // drop the session, and an empty room ends the class shortly after. Caught in
  // the capture phase so we can veto the click before LiveKit disconnects.
  const guardLeave = (e) => {
    if (!canHost) return
    const leaveBtn = e.target.closest?.('.lk-disconnect-button')
    if (leaveBtn && !window.confirm('Leave this class session? If nobody stays in the room, the class will end for everyone.')) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#0b0b0f' }} onClickCapture={guardLeave}>
      <LiveKitRoom
        // Keyed on the token so switching tracks tears the old connection down and
        // reconnects cleanly — LiveKitRoom won't re-handshake a live room in place.
        key={token}
        token={token}
        serverUrl={wsUrl}
        connect
        // Everyone joins muted; they turn their own camera/mic on from the control bar.
        video={false}
        audio={false}
        onDisconnected={onLeave}
        data-lk-theme="default"
        style={{ height: '100dvh' }}
      >
        {title && (
          <div style={{
            position: 'absolute', top: 8, left: 8, zIndex: 20,
            background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 12, fontWeight: 600,
            padding: '4px 10px', borderRadius: 8, pointerEvents: 'none',
            maxWidth: '55vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            🔴 {title}{subtitle ? ` · ${subtitle}` : ''}
          </div>
        )}

        {onSwitchTrack && (
          <TrackSwitcher
            tracks={tracks || []}
            activeClassId={activeClassId}
            onSwitchTrack={onSwitchTrack}
            switching={switching}
            mirrors={mirrors || []}
            onToggleMirror={onToggleMirror}
          />
        )}

        {/* Errors and toasts have to surface in here — the page behind the room
            is not visible while in a class. Stacked so both can show at once. */}
        {(notice || toast) && (
          <div style={{
            position: 'absolute', top: 44, right: 8, zIndex: 21,
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4,
            maxWidth: '52vw',
          }}>
            {notice && (
              <div style={{
                background: 'rgba(127,29,29,0.92)', color: '#fff',
                fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 8,
                border: '1px solid rgba(248,113,113,0.5)',
              }}>
                {notice}
              </div>
            )}
            {toast && (
              <div style={{
                background: 'rgba(0,0,0,0.75)', color: '#fef3c7',
                fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 8,
                border: '1px solid rgba(250,204,21,0.5)',
              }}>
                {toast}
              </div>
            )}
          </div>
        )}

        {/* Student controls, stacked top-right so they never overlap each other:
            raise a hand, and hand work in without leaving the class. */}
        {(onRaiseHand || submitClass) && (
          <div style={{
            position: 'absolute', top: 8, right: 8, zIndex: 20,
            display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end',
            maxWidth: '70vw',
          }}>
            {submitClass && (
              <button
                onClick={() => setSubmitOpen(true)}
                title="Submit a voice note, video, PDF or photo of your work to your mentor"
                style={{
                  background: submittedCount ? '#0d9488' : 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  border: `1px solid ${submittedCount ? '#14b8a6' : 'rgba(255,255,255,0.18)'}`,
                  fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                📎 {submittedCount ? `Submitted ${submittedCount}` : 'Submit work'}
              </button>
            )}
            {onRaiseHand && (
              <button
                onClick={onRaiseHand}
                title={handRaised ? 'Lower your hand' : 'Raise your hand — the mentor gets notified'}
                style={{
                  background: handRaised ? '#ca8a04' : 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  border: `1px solid ${handRaised ? '#facc15' : 'rgba(255,255,255,0.18)'}`,
                  fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                🖐 {handRaised ? 'Hand raised' : 'Raise hand'}
              </button>
            )}
          </div>
        )}

        {submitClass && submitOpen && (
          <SubmitOverlay
            classId={submitClass.id}
            classTitle={submitClass.title}
            onClose={() => setSubmitOpen(false)}
            onCountChange={setSubmittedCount}
          />
        )}

        {onHandEvent && <NotifyListener onEvent={onHandEvent} />}

        <VideoConference />
      </LiveKitRoom>
    </div>
  )
}

// The submit panel, mounted over the class stage. Must live inside <LiveKitRoom>
// because it brokers the camera/mic handoff through useLocalParticipant: a phone
// gives its camera to one consumer at a time, so LiveKit has to let go before the
// recorder can take it, and gets it back when the recording ends. Whatever the
// student had switched on is restored — never switched on for them.
function SubmitOverlay({ classId, classTitle, onClose, onCountChange }) {
  const { localParticipant } = useLocalParticipant()
  // What was on before we borrowed the devices, so restore is faithful.
  const priorRef = useRef({ camera: false, mic: false })

  const release = useCallback(async ({ camera, mic }) => {
    if (!localParticipant) return false
    priorRef.current = {
      camera: !!localParticipant.isCameraEnabled,
      mic: !!localParticipant.isMicrophoneEnabled,
    }
    const jobs = []
    if (camera && priorRef.current.camera) jobs.push(localParticipant.setCameraEnabled(false))
    if (mic && priorRef.current.mic) jobs.push(localParticipant.setMicrophoneEnabled(false))
    if (!jobs.length) return false
    // A device that refuses to stop shouldn't block the recording attempt.
    await Promise.allSettled(jobs)
    return true
  }, [localParticipant])

  const restore = useCallback(async () => {
    if (!localParticipant) return
    const prior = priorRef.current
    const jobs = []
    if (prior.camera) jobs.push(localParticipant.setCameraEnabled(true))
    if (prior.mic) jobs.push(localParticipant.setMicrophoneEnabled(true))
    priorRef.current = { camera: false, mic: false }
    await Promise.allSettled(jobs)
  }, [localParticipant])

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 40,
        background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 12,
      }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: 480, maxHeight: '92dvh', display: 'flex', borderRadius: 16, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <Suspense fallback={<div style={{ background: '#fff', padding: 24, width: '100%', textAlign: 'center', fontSize: 13, color: '#6b7280' }}>Loading…</div>}>
          <SubmitWorkPanel
            embedded
            classId={classId}
            classTitle={classTitle}
            onClose={onClose}
            onCountChange={onCountChange}
            cameraControls={{ release, restore }}
          />
        </Suspense>
      </div>
    </div>
  )
}

// Receives server-pushed data messages (topic "focas-notify") and hands the
// decoded payload to the page. Must live inside <LiveKitRoom> for room context.
function NotifyListener({ onEvent }) {
  useDataChannel(NOTIFY_TOPIC, (msg) => {
    try {
      onEvent(JSON.parse(new TextDecoder().decode(msg.payload)))
    } catch {
      // Not JSON / not ours — ignore.
    }
  })
  return null
}

// Host-only overlay for hopping between tracks. Every track in the topology is
// shown, not just the busy ones — a host can open a free track too, and hiding
// them would make switching look unavailable. Sits top-right, clear of the title
// chip and the bottom control bar.
const STATE_DOT = {
  live:      '#f87171',   // running now
  scheduled: '#facc15',   // booked and due — entering starts it
  idle:      '#6b7280',   // nothing scheduled to enter
  busy:      '#9ca3af',   // someone else's class; not enterable
}

function TrackSwitcher({ tracks, activeClassId, onSwitchTrack, switching, mirrors = [], onToggleMirror }) {
  if (tracks.length < 2) return null

  return (
    <div style={{
      position: 'absolute', top: 8, right: 8, zIndex: 20,
      display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4,
      maxWidth: '52vw',
    }}>
      {tracks.map((t) => {
        const active = !!t.classId && t.classId === activeClassId
        const blocked = t.state === 'busy' || t.state === 'idle'
        const disabled = active || blocked || !!switching
        const hint = active ? 'You are here'
          : t.state === 'busy' ? `Hosted by ${t.hostName || 'another host'}`
          : t.state === 'idle' ? 'Nothing scheduled here'
          : t.state === 'scheduled' ? `${t.title} — entering will start it`
          : t.title || ''
        const mirrorOn = mirrors.includes(`${t.roomKey}/${t.trackKey}`)
        // Mirroring targets a track the host may enter that isn't the current one;
        // an idle track has no class to receive the broadcast.
        const canMirror = !!onToggleMirror && !active && t.state !== 'busy' && t.state !== 'idle'
        return (
          <span key={`${t.roomKey}/${t.trackKey}`} style={{ display: 'inline-flex' }}>
            <button
              onClick={() => !disabled && onSwitchTrack(t)}
              disabled={disabled}
              title={`${t.roomLabel} · ${t.trackLabel}${hint ? ` — ${hint}` : ''}`}
              style={{
                background: active ? '#0d9488' : 'rgba(0,0,0,0.55)',
                color: blocked ? 'rgba(255,255,255,0.45)' : '#fff',
                border: `1px solid ${active ? '#14b8a6' : 'rgba(255,255,255,0.18)'}`,
                fontSize: 11, fontWeight: 600, padding: '5px 10px',
                borderRadius: canMirror ? '8px 0 0 8px' : 8,
                cursor: disabled ? 'default' : 'pointer',
                opacity: switching && !active ? 0.5 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {!active && (
                <span style={{ color: STATE_DOT[t.state] || '#9ca3af', marginRight: 5 }}>●</span>
              )}
              {t.roomLabel} · {t.trackLabel}
              {/* Students with a hand up in this track — live via data push,
                  refreshed by the 20s poll. */}
              {t.handsRaised > 0 && (
                <span style={{
                  marginLeft: 6, background: '#ca8a04', color: '#fff',
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                }}>
                  🖐 {t.handsRaised}
                </span>
              )}
            </button>
            {/* One-way mirror toggle: broadcast into this track without leaving
                the current one. Solid teal while the mirror is running. */}
            {canMirror && (
              <button
                onClick={() => !switching && onToggleMirror(t)}
                disabled={!!switching}
                title={mirrorOn
                  ? `Stop broadcasting into ${t.roomLabel} · ${t.trackLabel}`
                  : `Broadcast your camera & mic into ${t.roomLabel} · ${t.trackLabel} (one-way — you won't see or hear them)`}
                style={{
                  background: mirrorOn ? '#0d9488' : 'rgba(0,0,0,0.55)',
                  color: mirrorOn ? '#fff' : '#5eead4',
                  border: `1px solid ${mirrorOn ? '#14b8a6' : 'rgba(255,255,255,0.18)'}`,
                  borderLeft: 'none',
                  fontSize: 11, fontWeight: 700, padding: '5px 8px', borderRadius: '0 8px 8px 0',
                  cursor: switching ? 'default' : 'pointer', whiteSpace: 'nowrap',
                }}
              >📡</button>
            )}
          </span>
        )
      })}
    </div>
  )
}
