import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { LiveKitRoom, useDataChannel, useLocalParticipant, useRemoteParticipants } from '@livekit/components-react'
import { DisconnectReason, ParticipantKind, VideoPresets } from 'livekit-client'
import '@livekit/components-styles'
import ErrorBoundary from './ErrorBoundary'
import ClassStage from './ClassStage'
import PipStage from './PipStage'
import HostParticipantsPanel from './HostParticipantsPanel'
import StudentMediaGuard from './StudentMediaGuard'
import { usePictureInPicture, pickStageVideo } from '../hooks/usePictureInPicture'
import { fmtCountdown } from '../utils/countdown'
import { apiFetch } from '../api'

// Styles for ClassStage's focus layout (see components/ClassStage.jsx): the
// share's cell and the students' side grid. Minimized (corner window): no room
// for the control bar or chat — expand to use them. Mic/camera keep whatever
// state they had.
const LIVE_LAYOUT_CSS = `
.focas-focus-main { display: grid; min-width: 0; min-height: 0; }
.focas-side-grid {
  display: grid; gap: var(--lk-grid-gap); align-content: start;
  min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden;
}
.focas-side-grid > * { aspect-ratio: 16 / 10; min-height: 0; }
.focas-focus > .lk-carousel { height: 100%; }
/* Each tile sits in a wrapper (ClassStage's HandTile) so a raised hand can be
   laid over it; the wrapper is the grid/carousel item and the tile fills it. */
.focas-tile { position: relative; display: grid; min-width: 0; min-height: 0; }
.focas-tile > .lk-participant-tile { width: 100%; height: 100%; min-height: 0; }
/* A raised hand marks the tile without covering the video: a thin amber frame
   plus one small icon in the corner (hover it for the label). The names live
   in the bottom bar's participants button. */
.focas-tile[data-hand="up"] > .lk-participant-tile { box-shadow: inset 0 0 0 2px #ca8a04; }
.focas-hand-badge {
  position: absolute; top: 0.4rem; left: 0.4rem; z-index: 2;
  width: 24px; height: 24px; display: grid; place-items: center;
  background: #ca8a04; color: #fff; font-size: 13px; line-height: 1;
  border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,0.35);
  animation: focas-hand-in 0.25s ease-out;
}
@keyframes focas-hand-in { from { transform: scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
.focas-pip .lk-control-bar, .focas-pip .focas-control-row, .focas-pip .lk-chat { display: none; }
/* Bottom bar: LiveKit's control bar and our extra buttons share one row, so
   they read as one toolbar. Under 760px LiveKit drops its button labels for
   icons; ours follow suit so the row still fits a phone without wrapping. */
.focas-control-row {
  display: flex; align-items: center; justify-content: center; flex-wrap: wrap;
  border-top: 1px solid var(--lk-border-color);
  flex: none;
}
.focas-control-row .lk-control-bar { border-top: 0; }
/* LiveKit sizes the stage as "everything but one control-bar height", so a
   bottom row that wraps to two lines — a full toolbar plus a raised-hand badge
   on the track chip is enough — pushes its second line below the screen, and
   the host "loses" Minimize, Pop out, the tracks and the timer. Let the stage
   flex instead: the row takes the height it needs, the stage gives it up. */
.focas-live .lk-grid-layout-wrapper,
.focas-live .lk-focus-layout-wrapper { height: auto; flex: 1 1 0; min-height: 0; }
.focas-extra-controls {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.75rem 0.75rem 0.75rem 0; margin-left: -0.25rem;
}
@media (max-width: 760px) {
  .focas-extra-controls .focas-ctl-label { display: none; }
}
/* Host labels (Minimize, Pop out, Timer) go icon-only earlier: with the track
   switcher in the same row, a laptop-width bar would otherwise wrap. */
@media (max-width: 1400px) {
  .focas-extra-controls .focas-ctl-label-wide { display: none; }
}
`

// Host preference: pop out automatically when switching tabs (Meet-style).
const AUTO_PIP_KEY = 'focas.livePip.auto'
const readAutoPip = () => { try { return localStorage.getItem(AUTO_PIP_KEY) !== '0' } catch { return true } }
// Why Auto can't fire right now — shown when the host switches it on in that state.
const AUTO_NEEDS_MEDIA = 'Auto pop-out can’t fire while your microphone is off — Chrome only floats a tab that is using it. '
  + 'Turn on the mic and the class pops out by itself when you switch tabs.'
const AUTO_NEEDS_HTTPS = 'Auto pop-out only works on an https page (a Chrome rule) — it will on the live site, but not on this address. '
  + '"Pop out" works here too.'

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
//   minimized / onToggleMinimize — picture-in-picture mode: the room shrinks to
//     a corner window (connection kept alive) so the page behind becomes usable,
//     e.g. for reviewing submissions mid-class. The parent owns the state and
//     MUST keep this component mounted across the toggle — unmounting would
//     tear down the LiveKit connection.
//
// Hosts also get "Pop out" — true picture-in-picture (Meet-style): the stage
// plus mic/camera/share/leave controls float in a small always-on-top window
// that survives switching tabs and apps. Started and stopped by the host only;
// closing the floating window stops it too. With "Auto" on (default, persisted
// per browser) Chrome pops it out by itself when the host switches tabs and
// closes it when they return. See hooks/usePictureInPicture.js.
//
// Optional student-only props:
//   onRaiseHand, handRaised — the 🖐 toggle; the server relays it to the host
//   submitClass — { id, title } enables the 📎 submit panel inside the room
//
// classId (optional, both roles) enables the ⏱ room countdown: the host sets a
// deadline, everyone in THIS room/track sees it tick, and a chime + "Time's up"
// fires for all of them when it ends.
//
// The same class id (or activeClassId for hosts) also switches on the
// Zoom-style media controls: hosts get a 👥 Participants drawer (mute / stop
// video / ask to unmute / lock / remove — see HostParticipantsPanel), and
// students get the matching prompts and explanations (StudentMediaGuard).
//
// onLeave(info?) — `info.removed` is true when the host removed this
// participant, so the page can say so instead of silently dropping them.
//
// hostIdentity (students) — the host's LiveKit identity (their user id), so the
// room can show "Waiting for the mentor" while they're out: a class stays live
// until the host presses End, even with nobody in the room.
export default function LiveRoom(props) {
  return (
    <ErrorBoundary onReset={props.onLeave}>
      <LiveRoomInner {...props} />
    </ErrorBoundary>
  )
}

function LiveRoomInner({
  token, wsUrl, title, subtitle, onLeave, canHost, hostIdentity,
  tracks, activeClassId, onSwitchTrack, switching, mirrors, onToggleMirror, notice,
  onHandEvent, toast, onRaiseHand, handRaised, submitClass, classId,
  minimized, onToggleMinimize,
}) {
  // Which class this room is showing — hosts already pass activeClassId and
  // students submitClass, so the timer works even where classId isn't wired.
  const timerClassId = classId || activeClassId || submitClass?.id || null
  // Video quality is asymmetric on purpose: the host fills everyone's stage, so
  // they capture and publish high-res; students only ever render as small tiles,
  // so they're capped at 360p — that cap is what keeps the server inside its
  // monthly bandwidth allowance. adaptiveStream + dynacast make each viewer pull
  // only the simulcast layer their tile size actually needs.
  const roomOptions = useMemo(() => ({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: {
      resolution: canHost ? VideoPresets.h1080.resolution : VideoPresets.h360.resolution,
    },
    publishDefaults: {
      simulcast: true,
      videoEncoding: canHost
        ? { maxBitrate: 2_500_000, maxFramerate: 30 }
        : VideoPresets.h360.encoding,
    },
  }), [canHost])
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submittedCount, setSubmittedCount] = useState(0)
  // Host's participants drawer (mute / lock / remove students).
  const [participantsOpen, setParticipantsOpen] = useState(false)

  // Pop-out (picture-in-picture). The shell ref is only for the video-mode
  // fallback, which floats the biggest <video> currently on stage.
  const shellRef = useRef(null)
  const getStageVideo = useCallback(() => pickStageVideo(shellRef.current), [])
  const [autoPip, setAutoPip] = useState(readAutoPip)
  // Chrome only auto-pops-out a tab whose media session is active, which for
  // us means the host's mic is live (see LocalMediaProbe) — with it off, Auto
  // is armed but can't fire. We track that to say so in the UI rather than let
  // it look broken.
  const [capturing, setCapturing] = useState(false)
  // Bumped each time the keep-alive player (LocalMediaProbe) starts playing, so
  // the auto-PiP handler is (re)registered after Chrome's media session exists.
  const [playerEpoch, setPlayerEpoch] = useState(0)
  const onPlayerPlaying = useCallback(() => setPlayerEpoch((n) => n + 1), [])
  const [autoHint, setAutoHint] = useState('')
  const autoHintTimer = useRef(null)
  useEffect(() => () => clearTimeout(autoHintTimer.current), [])
  const pip = usePictureInPicture({ getStageVideo, autoEnabled: !!canHost && autoPip, rearmKey: playerEpoch })
  // Why Auto can't fire right now, if it can't: 'https' | 'media' | null.
  const autoBlockedBy = !autoPip ? null : pip.autoNeedsHttps ? 'https' : !capturing ? 'media' : null
  // Handed up by LocalMediaProbe so the hint can switch the mic on directly.
  const enableMicRef = useRef(null)
  const onMicControl = useCallback((fn) => { enableMicRef.current = fn }, [])
  const turnOnMic = () => {
    setAutoHint('')
    enableMicRef.current?.().catch((e) => setAutoHint(e?.message || 'Could not turn on the microphone'))
  }
  const toggleAutoPip = () => {
    const next = !autoPip
    setAutoPip(next)
    try { localStorage.setItem(AUTO_PIP_KEY, next ? '1' : '0') } catch { /* private mode */ }
    clearTimeout(autoHintTimer.current)
    const reason = next ? (pip.autoNeedsHttps ? AUTO_NEEDS_HTTPS : !capturing ? AUTO_NEEDS_MEDIA : '') : ''
    setAutoHint(reason)
    if (reason) autoHintTimer.current = setTimeout(() => setAutoHint(''), 12_000)
  }
  // Diagnostics: a tab switch that Auto can't act on is logged, so "it didn't
  // pop out" can be explained from the console.
  useEffect(() => {
    if (!canHost || !autoPip) return undefined
    const onVis = () => {
      if (document.visibilityState !== 'hidden' || pip.active) return
      if (autoBlockedBy === 'https') console.info('[pip] tab hidden — auto pop-out skipped: page is not https (Chrome only auto-floats https pages)')
      else if (autoBlockedBy === 'media') console.info('[pip] tab hidden — auto pop-out skipped: microphone is off (Chrome requires an active mic capture)')
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [canHost, autoPip, autoBlockedBy, pip.active])
  const activeTrack = (tracks || []).find((t) => t.classId && t.classId === activeClassId)
  const handsRaised = activeTrack?.handsRaised || 0
  // Who has a hand up in THIS room, oldest first — the server's list, pushed on
  // every raise / lower / leave. Drives the tile badges, the persistent chip
  // and the participants panel, so the mentor never depends on the 6-second toast.
  const hands = activeTrack?.hands || []
  // The room timer's state, mirrored into the pop-out (ClassTimer owns it).
  const [timerState, setTimerState] = useState(null)

  // Pop out + Auto as one joined pair in the bottom bar, in LiveKit's button
  // style; the active/blocked states override its background.
  const pipButton = canHost && (
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        className="lk-button"
        onClick={pip.toggle}
        disabled={pip.busy}
        aria-pressed={!!pip.active}
        title={pip.active
          ? 'Stop picture-in-picture'
          : pip.supported
            ? 'Pop out — float the class in a small always-on-top window that stays visible while you switch tabs or apps'
            : 'Picture-in-picture needs Chrome or Edge on a computer'}
        style={{
          backgroundColor: pip.active ? '#0d9488' : undefined,
          color: pip.active ? '#fff' : undefined,
          borderRadius: pip.autoSupported ? 'var(--lk-border-radius) 0 0 var(--lk-border-radius)' : undefined,
          opacity: pip.supported ? 1 : 0.6,
        }}
      >
        <span aria-hidden="true">▣</span>
        <span className="focas-ctl-label focas-ctl-label-wide">{pip.busy ? '…' : pip.active ? 'Pop-out on' : 'Pop out'}</span>
      </button>
      {pip.autoSupported && (
        <button
          type="button"
          className="lk-button"
          onClick={toggleAutoPip}
          aria-pressed={!!autoPip}
          title={!autoPip
            ? 'Auto pop-out is OFF. Click to have the class float by itself whenever you switch to another tab (https site, with your mic or camera on).'
            : autoBlockedBy === 'https'
              ? 'Auto pop-out is ON but Chrome only auto-floats https pages — it will work on the live site, not on this address. Use "Pop out" here. Click to turn Auto off.'
              : autoBlockedBy === 'media'
                ? 'Auto pop-out is ON but cannot fire right now: Chrome only floats a tab that is using the microphone, and yours is off. Turn it on, or use "Pop out". Click to turn Auto off.'
                : 'Auto pop-out is ON: the class floats by itself when you switch to another tab and goes back when you return. '
                  + 'The first time, Chrome may ask you to allow it; if it never floats, allow "Automatic picture-in-picture" in the site settings (🔒 in the address bar). Click to turn off.'}
          style={{
            backgroundColor: !autoPip ? undefined : autoBlockedBy ? '#b45309' : '#0d9488',
            color: autoPip ? '#fff' : '#5eead4',
            borderRadius: '0 var(--lk-border-radius) var(--lk-border-radius) 0',
            borderLeft: '1px solid rgba(255,255,255,0.12)',
            fontSize: '0.85em', fontWeight: 700,
          }}
        >Auto{!autoPip ? '' : autoBlockedBy === 'https' ? ' · https only' : autoBlockedBy === 'media' ? ' · mic off' : ' ✓'}</button>
      )}
    </span>
  )

  // While minimized the in-room notice stack is hidden, so a pop-out message
  // (e.g. "evicted by another PiP") surfaces on the page instead.
  const pipHintPortal = minimized && (pip.error || autoHint) && createPortal(
    <div
      onClick={() => { pip.clearError(); setAutoHint('') }}
      title="Dismiss"
      style={{
        position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 70,
        background: 'rgba(127,29,29,0.95)', color: '#fff', cursor: 'pointer',
        fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
        border: '1px solid rgba(248,113,113,0.5)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        maxWidth: '90vw',
      }}
    >
      ▣ {pip.error || autoHint}
    </div>,
    document.body,
  )
  // Hosts get an "are you sure" on LiveKit's Leave button — one mis-click drops
  // them out of the session (the class itself stays live until they press End).
  // Caught in the capture phase so we can veto the click before LiveKit disconnects.
  const guardLeave = (e) => {
    if (!canHost) return
    const leaveBtn = e.target.closest?.('.lk-disconnect-button')
    if (leaveBtn && !window.confirm('Leave this class session? The class stays live until you press End, so you can come back any time. Students who stay connected will wait for you.')) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // Minimized: a floating corner window above everything (including modals), so
  // the class stays watchable while the mentor works the page behind it. The
  // SAME element tree renders in both modes — only styles change — so LiveKit
  // never reconnects on toggle.
  const shellStyle = minimized
    ? {
        position: 'fixed', right: 16, bottom: 16, zIndex: 60,
        width: 'min(320px, calc(100vw - 24px))', height: 200,
        background: '#0b0b0f', borderRadius: 14, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.18)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      }
    : { position: 'fixed', inset: 0, zIndex: 50, background: '#0b0b0f' }

  // Student controls — raise a hand, hand work in without leaving the class.
  // They sit in the bottom control bar beside Chat and Leave (ClassStage lays
  // them out), NOT floating over the stage: the top-right corner is where every
  // tile keeps its expand/focus toggle, and the shared screen's was unreachable
  // underneath them. LiveKit's own button class keeps them looking native; the
  // active states (work submitted, hand up) override its background.
  const studentControls = (onRaiseHand || submitClass) ? (
    <>
      {submitClass && (
        <button
          type="button"
          className="lk-button"
          onClick={() => setSubmitOpen(true)}
          title="Submit a voice note, video, PDF or photo of your work to your mentor"
          aria-label={submittedCount ? `Submitted ${submittedCount} — open submissions` : 'Submit work'}
          style={submittedCount ? { backgroundColor: '#0d9488', color: '#fff' } : undefined}
        >
          <span aria-hidden="true">📎</span>
          <span className="focas-ctl-label">{submittedCount ? `Submitted ${submittedCount}` : 'Submit work'}</span>
        </button>
      )}
      {onRaiseHand && (
        <button
          type="button"
          className="lk-button"
          onClick={onRaiseHand}
          aria-pressed={!!handRaised}
          title={handRaised ? 'Lower your hand' : 'Raise your hand — the mentor gets notified'}
          aria-label={handRaised ? 'Lower your hand' : 'Raise your hand'}
          style={handRaised ? { backgroundColor: '#ca8a04', color: '#fff' } : undefined}
        >
          <span aria-hidden="true">🖐</span>
          <span className="focas-ctl-label">{handRaised ? 'Hand raised' : 'Raise hand'}</span>
        </button>
      )}
    </>
  ) : null

  // Host controls — everything that used to float over the stage: Pop out /
  // Auto, the participants drawer, and the track switcher. Same bar, same look.
  const hostControls = canHost ? (
    <>
      {pipButton}
      {timerClassId && (
        <ParticipantsButton open={participantsOpen} hands={hands} onClick={() => setParticipantsOpen((v) => !v)} />
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
    </>
  ) : null

  // Everything in the bar after LiveKit's own buttons. The timer is mounted
  // here even while minimized (the row is only CSS-hidden) so the countdown
  // keeps ticking and the chime still fires.
  const barControls = (studentControls || hostControls || onToggleMinimize || timerClassId) ? (
    <>
      {studentControls}
      {onToggleMinimize && (
        <button
          type="button"
          className="lk-button"
          onClick={onToggleMinimize}
          title="Minimize — the class keeps running in a small window while you use the page behind it (e.g. review submissions)"
          aria-label="Minimize the class to a small window"
        >
          <span aria-hidden="true">⧉</span>
          <span className="focas-ctl-label focas-ctl-label-wide">Minimize</span>
        </button>
      )}
      {hostControls}
      {timerClassId && (
        <ClassTimer classId={timerClassId} canHost={!!canHost} minimized={!!minimized} onStateChange={setTimerState} />
      )}
    </>
  ) : null

  return (
    <div ref={shellRef} className={minimized ? 'focas-live focas-pip' : 'focas-live'} style={shellStyle} onClickCapture={guardLeave}>
      <style>{LIVE_LAYOUT_CSS}</style>
      {pipHintPortal}
      <LiveKitRoom
        // Keyed on the token so switching tracks tears the old connection down and
        // reconnects cleanly — LiveKitRoom won't re-handshake a live room in place.
        key={token}
        token={token}
        serverUrl={wsUrl}
        options={roomOptions}
        connect
        // Everyone joins muted; they turn their own camera/mic on from the control bar.
        video={false}
        audio={false}
        // A host removing this participant is the one disconnect worth naming.
        onDisconnected={(reason) => onLeave?.(reason === DisconnectReason.PARTICIPANT_REMOVED ? { removed: true } : undefined)}
        data-lk-theme="default"
        style={{ height: minimized ? '100%' : '100dvh' }}
      >
        {/* Compact header while minimized: title + expand. Everything else
            (switcher, toasts, notices) lives on the page behind the window. */}
        {minimized && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
            background: 'linear-gradient(rgba(0,0,0,0.72), rgba(0,0,0,0))',
          }}>
            <span style={{
              flex: 1, color: '#fff', fontSize: 11, fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              🔴 {title}{subtitle ? ` · ${subtitle}` : ''}
            </span>
            {canHost && (
              <button
                onClick={pip.toggle}
                disabled={pip.busy}
                title={pip.active ? 'Stop picture-in-picture' : 'Pop out to a floating window'}
                style={{
                  background: pip.active ? '#0d9488' : 'rgba(0,0,0,0.55)', color: '#fff',
                  border: `1px solid ${pip.active ? '#14b8a6' : 'rgba(255,255,255,0.25)'}`,
                  fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                  cursor: 'pointer', flexShrink: 0,
                }}
              >▣</button>
            )}
            <button
              onClick={onToggleMinimize}
              title="Back to full screen"
              style={{
                background: 'rgba(0,0,0,0.55)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.25)',
                fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                cursor: 'pointer', flexShrink: 0,
              }}
            >⤢</button>
          </div>
        )}

        {/* The only thing left over the stage: a non-interactive title label.
            Every button lives in the bottom bar (barControls) so nothing
            covers the tiles' own expand/focus controls. */}
        {!minimized && title && (
          <div style={{
            position: 'absolute', top: 8, left: 8, zIndex: 20, maxWidth: '55vw',
            background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 12, fontWeight: 600,
            padding: '4px 10px', borderRadius: 8, pointerEvents: 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            🔴 {title}{subtitle ? ` · ${subtitle}` : ''}
          </div>
        )}

        {/* The class stays live while the mentor is out of the room — say so,
            rather than leaving students staring at an empty stage. */}
        {!minimized && !canHost && hostIdentity && <WaitingForHost hostIdentity={hostIdentity} />}

        {/* Errors and toasts have to surface in here — the page behind the room
            is not visible while in a class. Stacked so both can show at once.
            (While minimized the page IS visible and shows them itself.)
            Top-right is free now that every control sits in the bottom bar. */}
        {!minimized && (notice || toast || pip.error || autoHint) && (
          <div style={{
            position: 'absolute', top: 8, right: 8, zIndex: 21,
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4,
            maxWidth: '52vw',
          }}>
            {autoHint && (
              <div
                style={{
                  background: 'rgba(120,53,15,0.94)', color: '#fff',
                  fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 8,
                  border: '1px solid rgba(245,158,11,0.6)', maxWidth: 380,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <span style={{ flex: 1 }}>▣ {autoHint}</span>
                {autoHint === AUTO_NEEDS_MEDIA && (
                  <button
                    onClick={turnOnMic}
                    style={{
                      background: '#0d9488', color: '#fff', border: '1px solid #14b8a6',
                      fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 6,
                      cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >🎙 Turn on mic</button>
                )}
                <button
                  onClick={() => setAutoHint('')}
                  title="Dismiss"
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 14, cursor: 'pointer', padding: 0, lineHeight: 1 }}
                >×</button>
              </div>
            )}
            {pip.error && (
              <div
                onClick={pip.clearError}
                title="Dismiss"
                style={{
                  background: 'rgba(127,29,29,0.92)', color: '#fff', cursor: 'pointer',
                  fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 8,
                  border: '1px solid rgba(248,113,113,0.5)',
                }}
              >
                ▣ {pip.error}
              </div>
            )}
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

        {submitClass && submitOpen && (
          <SubmitOverlay
            classId={submitClass.id}
            classTitle={submitClass.title}
            onClose={() => setSubmitOpen(false)}
            onCountChange={setSubmittedCount}
          />
        )}

        {onHandEvent && <NotifyListener onEvent={onHandEvent} />}

        {/* Zoom-style media controls: the host's drawer, or the student's
            prompts/explanations. Both need room context, hence in here. */}
        {!canHost && <StudentMediaGuard classId={timerClassId} />}
        {canHost && timerClassId && participantsOpen && !minimized && (
          <HostParticipantsPanel classId={timerClassId} hands={hands} onClose={() => setParticipantsOpen(false)} />
        )}

        {canHost && (
          <LocalMediaProbe
            onChange={setCapturing}
            onMicControl={onMicControl}
            onPlaying={onPlayerPlaying}
            keepAlive={autoPip && pip.autoSupported && !pip.autoNeedsHttps}
          />
        )}

        {/* The floating pop-out window's contents. Inside <LiveKitRoom> so it
            shares the room; keyed remount on a track switch just re-portals
            into the same window. */}
        {pip.pipWindow && (
          <PipStage
            pipWindow={pip.pipWindow}
            title={title}
            subtitle={subtitle}
            handsRaised={handsRaised}
            canHost={!!canHost}
            toast={toast}
            notice={notice}
            timer={timerState}
            onBackToTab={() => pip.close('back to tab')}
            onClose={() => pip.close('pop-out error')}
          />
        )}

        {/* The stage plus the bottom bar; every in-class control we add lives
            in that bar (barControls above), never floating over the tiles. */}
        <ClassStage compact={!!minimized} extraControls={barControls} hands={canHost ? hands : []} />
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

// ───────────────────── class timer (Meet-style countdown) ─────────────────────

// Three rising beeps via WebAudio — no audio asset to load or block on, and the
// student clicked to join the room, so autoplay policy lets it through.
function playTimesUpChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const t0 = ctx.currentTime
    ;[[880, 0], [880, 0.3], [1318.5, 0.6]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.28)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.3)
    })
    setTimeout(() => { ctx.close().catch(() => {}) }, 1500)
  } catch {
    // Sound is a nicety — never break the room over it.
  }
}

// The room countdown. The host sets a deadline; the server stores it on the
// class and pushes start/cancel to THIS room only (one class = one room/track),
// so parallel tracks never hear it. Every client ticks locally against the
// deadline and fires the chime + "Time's up" itself — including this component
// while the host has the window minimized, which is why the parent keeps it
// mounted and only the visuals hide.
//
// The server always sends RELATIVE remaining time (endsInMs), converted to a
// local deadline on receipt — a device clock that's minutes off must not shift
// the countdown.
//
// onStateChange({ endsAt, timesUp }) mirrors the state to the parent so the
// pop-out window can show the same countdown without a second subscription.
function ClassTimer({ classId, canHost, minimized, onStateChange }) {
  const [endsAt, setEndsAt]     = useState(null)   // local epoch ms, null = no timer
  const [remaining, setRemaining] = useState(0)
  const [timesUp, setTimesUp]   = useState(false)
  useEffect(() => { onStateChange?.({ endsAt, timesUp }) }, [endsAt, timesUp, onStateChange])
  useEffect(() => () => onStateChange?.(null), [onStateChange])
  const [panelOpen, setPanelOpen] = useState(false)
  const [minutes, setMinutes]   = useState('5')
  const [seconds, setSeconds]   = useState('0')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const firedRef   = useRef(false)
  const timesUpRef = useRef(null)

  // Sync on join — a student (or a host switching back into this track) who
  // arrives mid-countdown starts ticking immediately.
  useEffect(() => {
    let alive = true
    const base = canHost ? `/api/live-classes/manage/${classId}` : `/api/live-classes/${classId}`
    apiFetch(`${base}/timer`)
      .then((d) => {
        if (!alive || !d?.timer) return
        firedRef.current = false
        setEndsAt(Date.now() + d.timer.endsInMs)
      })
      .catch(() => {})   // no timer state is a fine state
    return () => {
      alive = false
      clearTimeout(timesUpRef.current)
    }
  }, [classId, canHost])

  useDataChannel(NOTIFY_TOPIC, (msg) => {
    let p
    try { p = JSON.parse(new TextDecoder().decode(msg.payload)) } catch { return }
    if (p?.type !== 'timer' || (p.classId && p.classId !== String(classId))) return
    clearTimeout(timesUpRef.current)
    firedRef.current = false
    setTimesUp(false)
    setEndsAt(p.action === 'start' ? Date.now() + p.endsInMs : null)
  })

  // The tick. 250ms keeps the display honest without meaningful cost; at zero
  // it fires the chime exactly once and shows the overlay for a few seconds.
  useEffect(() => {
    if (!endsAt) return undefined
    const tick = () => {
      const left = endsAt - Date.now()
      if (left > 0) { setRemaining(left); return }
      setRemaining(0)
      if (!firedRef.current) {
        firedRef.current = true
        setEndsAt(null)
        setTimesUp(true)
        playTimesUpChime()
        timesUpRef.current = setTimeout(() => setTimesUp(false), 8000)
      }
    }
    tick()
    const t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [endsAt])

  const start = async () => {
    const total = (parseInt(minutes, 10) || 0) * 60 + (parseInt(seconds, 10) || 0)
    if (total < 5) { setError('Set at least 5 seconds'); return }
    setBusy(true); setError('')
    try {
      const d = await apiFetch(`/api/live-classes/manage/${classId}/timer`, {
        method: 'POST', body: JSON.stringify({ seconds: total }),
      })
      firedRef.current = false
      setTimesUp(false)
      setEndsAt(Date.now() + d.timer.endsInMs)
      setPanelOpen(false)
    } catch (e) {
      setError(e.message || 'Could not start the timer')
    } finally { setBusy(false) }
  }

  const cancelTimer = async () => {
    setEndsAt(null)   // stop locally right away; the push confirms for everyone
    try {
      await apiFetch(`/api/live-classes/manage/${classId}/timer`, { method: 'DELETE' })
    } catch { /* worst case the push never goes out and clients run to zero */ }
  }

  if (minimized) return null   // keep hooks ticking; no room for chrome in the pip

  const active = !!endsAt
  const urgent = active && remaining <= 10_000

  const chipStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: urgent ? 'rgba(153,27,27,0.92)' : 'var(--lk-control-bg)',
    color: '#fff',
    border: `1px solid ${urgent ? '#f87171' : 'rgba(255,255,255,0.22)'}`,
    fontSize: 14, fontWeight: 700, padding: '0.5rem 0.875rem', borderRadius: 999,
    whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
  }

  return (
    <>
      {/* Lives in the bottom control bar (rendered through ClassStage's
          extraControls); the set-up panel pops UP over the stage from here. */}
      {(active || canHost) && (
        <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
          {active ? (
            <div style={chipStyle} className={urgent ? 'animate-pulse' : undefined}>
              <span>⏱ {fmtCountdown(remaining)}</span>
              {canHost && (
                <button
                  type="button"
                  onClick={cancelTimer}
                  title="Cancel the timer"
                  aria-label="Cancel the timer"
                  style={{
                    background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
                    fontSize: 15, lineHeight: 1, cursor: 'pointer', padding: '0 0 0 2px',
                  }}
                >×</button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="lk-button"
              onClick={() => { setPanelOpen((v) => !v); setError('') }}
              aria-pressed={panelOpen}
              title="Set a countdown everyone in this room can see — a chime sounds when it ends"
              style={panelOpen ? { backgroundColor: '#0d9488', color: '#fff' } : undefined}
            >
              <span aria-hidden="true">⏱</span>
              <span className="focas-ctl-label focas-ctl-label-wide">Timer</span>
            </button>
          )}

          {panelOpen && !active && canHost && (
            <div style={{
              position: 'absolute', bottom: 'calc(100% + 10px)', right: 0, zIndex: 30,
              background: 'rgba(17,17,22,0.97)', border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 12, padding: 12, width: 220,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}>
              <p style={{ color: '#9ca3af', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 8px' }}>
                Timer for this room
              </p>
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {[1, 2, 5, 10].map((m) => (
                  <button key={m}
                    onClick={() => { setMinutes(String(m)); setSeconds('0'); setError('') }}
                    style={{
                      flex: 1,
                      background: minutes === String(m) && seconds === '0' ? '#0d9488' : 'rgba(255,255,255,0.08)',
                      color: '#fff', border: 'none', borderRadius: 7,
                      fontSize: 11, fontWeight: 700, padding: '6px 0', cursor: 'pointer',
                    }}
                  >{m}m</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <input
                  type="number" min="0" max="180" value={minutes} disabled={busy}
                  onChange={(e) => setMinutes(e.target.value)}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.08)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.15)', borderRadius: 7,
                    fontSize: 13, padding: '6px 8px', outline: 'none',
                  }}
                />
                <span style={{ color: '#9ca3af', fontSize: 11 }}>min</span>
                <input
                  type="number" min="0" max="59" value={seconds} disabled={busy}
                  onChange={(e) => setSeconds(e.target.value)}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.08)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.15)', borderRadius: 7,
                    fontSize: 13, padding: '6px 8px', outline: 'none',
                  }}
                />
                <span style={{ color: '#9ca3af', fontSize: 11 }}>sec</span>
              </div>
              <button onClick={start} disabled={busy}
                style={{
                  width: '100%', background: busy ? '#374151' : '#0d9488', color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  padding: '8px 0', cursor: busy ? 'default' : 'pointer',
                }}
              >{busy ? 'Starting…' : '▶ Start timer'}</button>
              {error && <p style={{ color: '#f87171', fontSize: 11, margin: '8px 0 0' }}>{error}</p>}
            </div>
          )}
        </span>
      )}

      {/* Everyone in the room gets this the moment their countdown hits zero.
          Portaled to the body, fixed over the whole room, so it covers the
          stage regardless of the bar's stacking — and sits above the
          full-screen shell (50) and the submit overlay; click anywhere to
          dismiss early. */}
      {timesUp && createPortal(
        <div
          onClick={() => { clearTimeout(timesUpRef.current); setTimesUp(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 56,
            background: 'rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 64, lineHeight: 1 }}>⏰</div>
          <div style={{ color: '#fff', fontSize: 28, fontWeight: 800 }}>Time's up!</div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>tap to dismiss</div>
        </div>,
        document.body,
      )}
    </>
  )
}

// Reports whether the host's microphone is live — what decides if Chrome's
// auto pop-out can fire — and, while `keepAlive`, keeps Chrome's media session
// for this tab active. Must live inside <LiveKitRoom> for room context.
//
// Why the keep-alive: Chrome only surfaces a page's "enterpictureinpicture"
// handler to its auto-PiP logic while the page has an ACTIVE MEDIA PLAYER —
// an element that is playing and carries audio (content/browser/media/
// session/media_session_controller.cc: IsMediaSessionNeeded), and, as
// measured, a video track too: an audio-only MediaStream element is not
// registered as a player at all. LiveKit publishes the host's mic straight to
// the room without playing it anywhere, so a mentor alone (or with muted
// students) has no such player and Chrome never fires, even with mic and
// camera on. So: the host's own mic track + a 2×2 canvas video track, played
// in a hidden, MUTED element — nothing is heard, nothing visible. Verified
// end-to-end against Chrome 145 with every other combination failing.
function LocalMediaProbe({ onChange, onMicControl, onPlaying, keepAlive }) {
  const { microphoneTrack, localParticipant } = useLocalParticipant()
  const micStreamTrack = microphoneTrack?.track?.mediaStreamTrack || null
  const on = !!micStreamTrack
  useEffect(() => { onChange(on) }, [on, onChange])
  useEffect(() => () => onChange(false), [onChange])
  useEffect(() => {
    onMicControl?.(() => localParticipant.setMicrophoneEnabled(true))
    return () => onMicControl?.(null)
  }, [localParticipant, onMicControl])

  const elRef = useRef(null)
  useEffect(() => {
    const el = elRef.current
    if (!el || !micStreamTrack || !keepAlive || typeof HTMLCanvasElement === 'undefined') return undefined
    // Video track from a tiny canvas, repainted so frames keep flowing (a
    // canvas stream only emits on paint). ~0 CPU at 2×2 px, 2 fps.
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    const ctx = canvas.getContext('2d')
    let videoTrack = null
    try { videoTrack = canvas.captureStream(2).getVideoTracks()[0] || null } catch { /* no canvas capture */ }
    let tick = 0
    const paint = () => { ctx.fillStyle = (tick++ & 1) ? '#000' : '#111'; ctx.fillRect(0, 0, 2, 2) }
    paint()
    const timer = setInterval(paint, 500)
    el.srcObject = new MediaStream(videoTrack ? [micStreamTrack, videoTrack] : [micStreamTrack])
    el.play().catch(() => { /* autoplay policy — the host clicked to join, so this is allowed */ })
    return () => {
      clearInterval(timer)
      el.pause()
      el.srcObject = null
      videoTrack?.stop()
    }
  }, [micStreamTrack, keepAlive])

  if (!keepAlive) return null
  return (
    <video
      ref={elRef}
      muted
      playsInline
      autoPlay
      onPlaying={onPlaying}
      aria-hidden="true"
      tabIndex={-1}
      style={{ position: 'fixed', left: 0, bottom: 0, width: 2, height: 2, opacity: 0, pointerEvents: 'none' }}
    />
  )
}

// Students in a class whose host has stepped out (a class stays live until the
// host presses End) get told so. Identity = user id, which the join-token
// response carries as hostUserId. A short delay covers the participant list
// syncing right after connect, so it never flashes on a normal join.
function WaitingForHost({ hostIdentity }) {
  const remote = useRemoteParticipants()
  const hostHere = remote.some((p) => p.identity === hostIdentity)
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 3000)
    return () => clearTimeout(t)
  }, [])
  if (!settled || hostHere) return null
  return (
    <div role="status" style={{
      position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)', zIndex: 21,
      background: 'rgba(0,0,0,0.7)', color: '#fde68a', fontSize: 13, fontWeight: 600,
      padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(250,204,21,0.45)',
      whiteSpace: 'nowrap', maxWidth: '90vw', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      ⏳ Waiting for the mentor to join…
    </div>
  )
}

// 👥 toggle for the host's participants drawer, with a live student count.
// Inside <LiveKitRoom> so it can read the room.
// hands: who has a hand up right now. Their names ride on this button — in
// the bottom bar, where nothing covers a video tile — and the panel it opens
// lists them first. Two names inline, the rest as "+N"; the tooltip has all.
function ParticipantsButton({ open, hands = [], onClick }) {
  const { localParticipant } = useLocalParticipant()
  const remote = useRemoteParticipants()
  const count = remote.filter((p) => p.kind === ParticipantKind.STANDARD && p.identity !== localParticipant?.identity).length
  const names = hands.map((h) => h.name || 'A student')
  const inline = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '')
  const handsTitle = names.length ? `Hand up: ${names.join(', ')}. ` : ''
  return (
    <button
      type="button"
      className="lk-button"
      onClick={onClick}
      title={handsTitle + (open ? 'Close the participants panel' : 'Participants — mute, stop video, ask to unmute, lock or remove students')}
      aria-label={`Participants: ${count}${names.length ? `, hand up: ${names.join(', ')}` : ''}`}
      aria-pressed={open}
      style={open ? { backgroundColor: '#0d9488', color: '#fff' } : undefined}
    >
      <span aria-hidden="true">👥</span>{count}
      {names.length > 0 && (
        <span style={{
          background: '#ca8a04', color: '#fff', fontSize: 10, fontWeight: 700,
          padding: '1px 7px', borderRadius: 999, marginLeft: 4,
          maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          🖐 {inline}
        </span>
      )}
    </button>
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

// Host-only switcher for hopping between the tracks of this room. Every track
// is shown, not just the busy ones — a host can open a free track too, and
// hiding them would make switching look unavailable. Sits in the bottom
// control bar (via ClassStage's extraControls), styled like LiveKit's buttons.
// The room is in the title label, so the chips carry the track name only.
const STATE_DOT = {
  live:      '#f87171',   // running now
  scheduled: '#facc15',   // booked and due — entering starts it
  idle:      '#6b7280',   // nothing scheduled to enter
  busy:      '#9ca3af',   // someone else's class; not enterable
}

function TrackSwitcher({ tracks, activeClassId, onSwitchTrack, switching, mirrors = [], onToggleMirror }) {
  if (tracks.length < 2) return null

  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
      {tracks.map((t) => {
        const active = !!t.classId && t.classId === activeClassId
        const blocked = t.state === 'busy' || t.state === 'idle'
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
            {/* The current track stays enabled (so it isn't dimmed) but inert. */}
            <button
              type="button"
              className="lk-button"
              onClick={() => !active && !blocked && !switching && onSwitchTrack(t)}
              disabled={blocked || !!switching}
              aria-current={active ? 'true' : undefined}
              title={`${t.roomLabel} · ${t.trackLabel}${hint ? ` — ${hint}` : ''}`}
              style={{
                backgroundColor: active ? '#0d9488' : undefined,
                color: active ? '#fff' : blocked ? 'rgba(255,255,255,0.45)' : undefined,
                borderRadius: canMirror ? 'var(--lk-border-radius) 0 0 var(--lk-border-radius)' : undefined,
                opacity: switching && !active ? 0.5 : 1,
                cursor: active ? 'default' : undefined,
              }}
            >
              {!active && (
                <span aria-hidden="true" style={{ color: STATE_DOT[t.state] || '#9ca3af', fontSize: 10 }}>●</span>
              )}
              {t.trackLabel}
              {/* Students with a hand up in this track — live via data push,
                  refreshed by the 20s poll. */}
              {t.handsRaised > 0 && (
                <span
                  title={(t.hands || []).length ? `Hand up: ${t.hands.map((h) => h.name).join(', ')}` : undefined}
                  style={{
                    background: '#ca8a04', color: '#fff',
                    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                  }}
                >
                  🖐 {t.handsRaised}
                </span>
              )}
            </button>
            {/* One-way mirror toggle: broadcast into this track without leaving
                the current one. Solid teal while the mirror is running. */}
            {canMirror && (
              <button
                type="button"
                className="lk-button"
                onClick={() => !switching && onToggleMirror(t)}
                disabled={!!switching}
                aria-pressed={mirrorOn}
                title={mirrorOn
                  ? `Stop broadcasting into ${t.roomLabel} · ${t.trackLabel}`
                  : `Broadcast your camera & mic into ${t.roomLabel} · ${t.trackLabel} (one-way — you won't see or hear them)`}
                style={{
                  backgroundColor: mirrorOn ? '#0d9488' : undefined,
                  color: mirrorOn ? '#fff' : '#5eead4',
                  borderRadius: '0 var(--lk-border-radius) var(--lk-border-radius) 0',
                  borderLeft: '1px solid rgba(255,255,255,0.12)',
                  paddingLeft: '0.6rem', paddingRight: '0.6rem',
                }}
              >📡</button>
            )}
          </span>
        )
      })}
    </span>
  )
}
