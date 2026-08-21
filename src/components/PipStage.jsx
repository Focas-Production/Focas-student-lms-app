import { Component, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Track } from 'livekit-client'
import {
  VideoTrack, isTrackReference, useLocalParticipant, useParticipants,
  useRoomContext, useSpeakingParticipants, useTracks,
} from '@livekit/components-react'
import { fmtCountdown } from '../utils/countdown'

// What renders INSIDE the picture-in-picture window (document mode) — the
// Meet-style pop-out: a stage tile, a rail of the other cameras, the room's
// signals (timer, hands, toasts), and a control bar.
//
// Must be mounted inside <LiveKitRoom>: it's a React portal into the PiP
// window's document, and portals keep the room context, so the same LiveKit
// hooks work and every media track is the one already flowing in the main tab
// (a track can be attached to any number of <video> elements).
//
// Stage priority, like Meet: a screen share → whoever is speaking (sticky, so
// it doesn't flip on every pause) → any other remote camera → your own camera.
export default function PipStage({ pipWindow, onClose, ...rest }) {
  return createPortal(
    <PipErrorBoundary onClose={onClose}>
      <PipContent pipWindow={pipWindow} {...rest} />
    </PipErrorBoundary>,
    pipWindow.document.body,
  )
}

// A crash in the pop-out must never reach the room's own boundary (whose reset
// LEAVES the class). Log it, show a line, close the window.
class PipErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    console.error('[pip] crashed — closing the pop-out', error, info)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0b0b0f', color: '#fca5a5',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: 16, fontFamily: 'system-ui, sans-serif', fontSize: 12, textAlign: 'center',
      }}>
        <div>The pop-out hit a problem. The class itself is unaffected.</div>
        <button onClick={this.props.onClose} style={{ ...btnBase, background: '#374151', padding: '6px 14px', borderRadius: 8 }}>
          Close pop-out
        </button>
      </div>
    )
  }
}

const MAX_RAIL = 3

function PipContent({ title, subtitle, handsRaised, canHost, toast, notice, timer, onBackToTab }) {
  const room = useRoomContext()
  const participants = useParticipants()
  const speakers = useSpeakingParticipants()
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled, localParticipant } = useLocalParticipant()
  const tracks = useTracks(
    [
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Camera, withPlaceholder: false },
    ],
    { onlySubscribed: true },
  )
  const [err, setErr] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const errTimer = useRef(null)
  const confirmTimer = useRef(null)
  useEffect(() => () => { clearTimeout(errTimer.current); clearTimeout(confirmTimer.current) }, [])

  const live = tracks.filter((t) => isTrackReference(t) && !t.publication?.isMuted)
  const screen     = live.find((t) => t.source === Track.Source.ScreenShare)
  const cams       = live.filter((t) => t.source === Track.Source.Camera)
  const remoteCams = cams.filter((t) => !t.participant.isLocal)
  const localCam   = cams.find((t) => t.participant.isLocal)

  // Sticky speaker: remember who spoke last so the tile holds between sentences.
  const speakingId = remoteCams.find((t) => speakers.some((p) => p.identity === t.participant.identity))
    ?.participant.identity ?? null
  const [lastSpeaker, setLastSpeaker] = useState(null)
  if (speakingId && speakingId !== lastSpeaker) setLastSpeaker(speakingId)

  const main = screen
    || remoteCams.find((t) => t.participant.identity === lastSpeaker)
    || remoteCams[0]
    || localCam
    || null
  // Rail: you first (so you always see yourself), then the other cameras.
  const rail = [localCam, ...remoteCams].filter((t) => t && t !== main).slice(0, MAX_RAIL)
  const hiddenCount = Math.max(0, cams.filter((t) => t !== main).length - rail.length)

  const flash = (msg) => {
    setErr(msg)
    clearTimeout(errTimer.current)
    errTimer.current = setTimeout(() => setErr(''), 4000)
  }
  const guard = (p) => p.catch((e) => flash(e?.message || 'That didn’t work — try it from the main tab'))
  const toggleMic   = () => guard(localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled))
  const toggleCam   = () => guard(localParticipant.setCameraEnabled(!isCameraEnabled))
  const toggleShare = () => guard(localParticipant.setScreenShareEnabled(!isScreenShareEnabled))

  // Hosts confirm, as on the main Leave button — an empty room ends the class.
  // Inline rather than window.confirm(): native dialogs aren't dependable in a
  // PiP window. room.disconnect() fires LiveKitRoom's onDisconnected, which
  // unmounts the room and closes this window along with it.
  const askLeave = () => {
    if (!canHost) { room.disconnect(); return }
    setConfirmLeave(true)
    clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirmLeave(false), 6000)
  }
  const stay = () => { clearTimeout(confirmTimer.current); setConfirmLeave(false) }
  const leave = () => { clearTimeout(confirmTimer.current); room.disconnect() }

  const backToTab = () => {
    try { window.focus() } catch { /* not allowed — the window still closes */ }
    onBackToTab?.()
  }

  const mainName = main
    ? `${main.participant.name || main.participant.identity}${main.participant.isLocal ? ' (you)' : ''}${main.source === Track.Source.ScreenShare ? ' is presenting' : ''}`
    : ''

  return (
    <div
      data-lk-theme="default"
      style={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        background: '#0b0b0f', color: '#fff',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        userSelect: 'none',
      }}
    >
      {/* Stage */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, background: '#000' }}>
        {main ? (
          <VideoTrack
            key={`${main.participant.identity}/${main.source}`}
            trackRef={main}
            style={{
              width: '100%', height: '100%', display: 'block',
              objectFit: main.source === Track.Source.ScreenShare ? 'contain' : 'cover',
              transform: main.participant.isLocal && main.source === Track.Source.Camera ? 'scaleX(-1)' : undefined,
            }}
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: '#0d9488',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 700,
            }}>
              {(localParticipant.name || localParticipant.identity || '?')[0]?.toUpperCase()}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>No video on stage</div>
          </div>
        )}

        {/* Header overlay: what's running, timer, who's here, hands up */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
          background: 'linear-gradient(rgba(0,0,0,0.72), rgba(0,0,0,0))',
          fontSize: 11, fontWeight: 600,
        }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            🔴 {title}{subtitle ? ` · ${subtitle}` : ''}
          </span>
          {timer?.endsAt && <Countdown endsAt={timer.endsAt} />}
          <span title="In the room" style={chip()}>👥 {participants.length}</span>
          {handsRaised > 0 && (
            <span title="Hands raised" style={chip('#ca8a04')}>🖐 {handsRaised}</span>
          )}
        </div>

        {/* The room's signals follow the mentor into the pop-out: hand raises and
            submissions (toast), host errors (notice), control errors (err). */}
        {(notice || toast || err) && (
          <div style={{
            position: 'absolute', left: 8, right: 8, top: 32,
            display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch',
          }}>
            {notice && <div style={banner('rgba(127,29,29,0.92)', 'rgba(248,113,113,0.5)', '#fff')}>{notice}</div>}
            {toast  && <div style={banner('rgba(0,0,0,0.78)', 'rgba(250,204,21,0.5)', '#fef3c7')}>{toast}</div>}
            {err    && <div style={banner('rgba(127,29,29,0.92)', 'rgba(248,113,113,0.5)', '#fff')}>{err}</div>}
          </div>
        )}

        {mainName && (
          <div style={{
            position: 'absolute', left: 8, bottom: 8,
            maxWidth: rail.length ? `calc(100% - ${rail.length * 92 + 24}px)` : 'calc(100% - 16px)',
            background: 'rgba(0,0,0,0.6)', fontSize: 11, fontWeight: 600,
            padding: '3px 8px', borderRadius: 6,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {mainName}
          </div>
        )}

        {rail.length > 0 && (
          <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 4 }}>
            {rail.map((t) => (
              <div
                key={`${t.participant.identity}/${t.source}`}
                title={`${t.participant.name || t.participant.identity}${t.participant.isLocal ? ' (you)' : ''}`}
                style={{
                  width: 88, height: 58, borderRadius: 8, overflow: 'hidden', background: '#111',
                  border: `1px solid ${speakers.some((p) => p.identity === t.participant.identity && !p.isLocal) ? '#14b8a6' : 'rgba(255,255,255,0.25)'}`,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)', position: 'relative',
                }}
              >
                <VideoTrack
                  trackRef={t}
                  style={{
                    width: '100%', height: '100%', display: 'block', objectFit: 'cover',
                    transform: t.participant.isLocal ? 'scaleX(-1)' : undefined,
                  }}
                />
                {hiddenCount > 0 && t === rail[rail.length - 1] && (
                  <div style={{
                    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700,
                  }}>+{hiddenCount}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {timer?.timesUp && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}>
            <div style={{ fontSize: 40, lineHeight: 1 }}>⏰</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Time's up!</div>
          </div>
        )}
      </div>

      {/* Control bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '8px 10px', background: '#16161c', flexShrink: 0, minHeight: 52,
      }}>
        {confirmLeave ? (
          <>
            <span style={{ fontSize: 12, fontWeight: 600, marginRight: 4 }}>Leave the class?</span>
            <button onClick={stay} style={{ ...btnBase, background: 'rgba(255,255,255,0.14)', padding: '7px 14px', borderRadius: 999 }}>Stay</button>
            <button onClick={leave} style={{ ...btnBase, background: '#dc2626', padding: '7px 14px', borderRadius: 999 }}>Leave</button>
          </>
        ) : (
          <>
            <Ctl on={isMicrophoneEnabled} onClick={toggleMic} label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}>
              {isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
            </Ctl>
            <Ctl on={isCameraEnabled} onClick={toggleCam} label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}>
              {isCameraEnabled ? <CamIcon /> : <CamOffIcon />}
            </Ctl>
            <Ctl on={!isScreenShareEnabled} active={isScreenShareEnabled} onClick={toggleShare} label={isScreenShareEnabled ? 'Stop presenting' : 'Present your screen'}>
              <ShareIcon />
            </Ctl>
            <Ctl on onClick={backToTab} label="Back to the class tab">
              <BackIcon />
            </Ctl>
            <button
              onClick={askLeave}
              title="Leave the class"
              aria-label="Leave the class"
              style={{ ...btnBase, height: 36, padding: '0 16px', borderRadius: 999, background: '#dc2626', marginLeft: 4 }}
            >
              <LeaveIcon />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// The room countdown, mirrored. The deadline comes from the main tab's
// ClassTimer (which also fires the chime); this only ticks the display.
function Countdown({ endsAt }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, endsAt - now)
  const urgent = left <= 10_000
  return (
    <span
      title="Room timer"
      style={{
        ...chip(urgent ? 'rgba(153,27,27,0.95)' : 'rgba(0,0,0,0.55)'),
        fontVariantNumeric: 'tabular-nums',
        border: `1px solid ${urgent ? '#f87171' : 'rgba(255,255,255,0.22)'}`,
      }}
    >
      ⏱ {fmtCountdown(left)}
    </span>
  )
}

const btnBase = {
  border: 'none', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const chip = (bg = 'rgba(0,0,0,0.55)') => ({
  background: bg, color: '#fff', fontSize: 10, fontWeight: 700,
  padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
})

const banner = (bg, border, color) => ({
  background: bg, border: `1px solid ${border}`, color,
  fontSize: 11, fontWeight: 600, padding: '5px 8px', borderRadius: 6,
  textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
})

// Round control. `on` = normal (grey) look, otherwise the red "off" look, as in
// Meet. `active` = the teal "running" look (screen share).
function Ctl({ on, active, onClick, label, children }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        ...btnBase, width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: active ? '#0d9488' : on ? 'rgba(255,255,255,0.14)' : '#dc2626',
      }}
    >
      {children}
    </button>
  )
}

const svg = { width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24' }
const MicIcon = () => (
  <svg {...svg}><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" /><path d="M19 11a7 7 0 0 1-14 0M12 18v3" /></svg>
)
const MicOffIcon = () => (
  <svg {...svg}><path d="M9 6a3 3 0 0 1 6 0v6M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.7 3M12 18v3M3 3l18 18" /></svg>
)
const CamIcon = () => (
  <svg {...svg}><rect x="3" y="7" width="13" height="10" rx="2" /><path d="M16 11l5-3v8l-5-3z" /></svg>
)
const CamOffIcon = () => (
  <svg {...svg}><path d="M3 3l18 18M10 7h4a2 2 0 0 1 2 2v2l5-3v8l-2-1.2M16 16v-1M5 7H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h9" /></svg>
)
const ShareIcon = () => (
  <svg {...svg}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M12 13V8M9 11l3-3 3 3" /></svg>
)
const BackIcon = () => (
  <svg {...svg}><path d="M15 3h6v6M21 3l-8 8" /><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /></svg>
)
const LeaveIcon = () => (
  <svg {...svg} style={{ transform: 'rotate(135deg)' }}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z" /></svg>
)
