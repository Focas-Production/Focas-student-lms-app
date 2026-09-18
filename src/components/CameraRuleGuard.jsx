import { useCallback, useEffect, useRef, useState } from 'react'
import { useDataChannel, useLocalParticipant, useLocalParticipantPermissions } from '@livekit/components-react'
import { apiFetch } from '../api'
import { NOTIFY_TOPIC, canPublishSource } from '../utils/livekitPermissions'

// The student's side of the host's "camera must be on" rule. Must live inside
// <LiveKitRoom>.
//
// The server decides everything — whether the rule is on, whether this student
// is excused, when their time is up and when they're out (see
// server/services/cameraRuleService.js). This component only makes the decision
// visible and gives them the one-tap way to comply, so nobody is ever removed
// by a rule they never saw:
//
//   • a countdown banner the moment their camera is off, with the host's name
//     for the rule and a "Turn on camera" button
//   • in the last 30 seconds it grows into a centred card — at that point being
//     removed is seconds away and a corner banner is not enough. It is NOT a
//     modal: the dim passes clicks through and stops above the control bar, so
//     the mic, chat, Leave and — above all — Raise hand stay usable. Telling a
//     student to ask for help while blocking the button that asks would be a
//     trap, so the card carries its own Raise hand AND Unmute buttons: with
//     seconds left, saying "my camera's broken, please excuse me" out loud is
//     faster than a hand the mentor may not look at. Unmute respects the host's
//     mic lock — the rule never hands back a mic the host took away.
//   • a quiet chip while their camera IS on, so "why do I have to?" has an
//     answer, and another when the host has excused them
//
// The countdown ticks locally from a deadline the server pushed as a RELATIVE
// number of ms — a student's device clock being minutes off must not shorten
// their time. A refresh mid-countdown re-syncs through GET /camera-rule.
//
// onRemovalNotice({ message, blocked }) — handed up so LiveRoom can tell the
// page WHY the student was dropped (the disconnect itself carries only
// PARTICIPANT_REMOVED, which would read as "the host threw me out") and whether
// they now need the mentor to let them back in.
export default function CameraRuleGuard({ classId, onRemovalNotice, onRaiseHand, handRaised }) {
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant()
  const perms = useLocalParticipantPermissions()
  // A camera the host has locked can't be turned on at all — the server never
  // enforces the rule on that student, and we must not nag them about it.
  const camLocked = !canPublishSource(perms, 'camera')
  // Likewise the mic: if the host has muted everyone and locked it, the card
  // says so instead of offering a button that can't work.
  const micLocked = !canPublishSource(perms, 'mic')

  const [enabled, setEnabled] = useState(false)
  const [graceSeconds, setGraceSeconds] = useState(0)
  const [excused, setExcused] = useState(false)
  const [deadline, setDeadline] = useState(null)   // local epoch ms, null = not on the clock
  const [left, setLeft] = useState(0)              // ms remaining, ticked locally
  const [notice, setNotice] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [micBusy, setMicBusy] = useState(false)
  const noticeTimer = useRef(null)
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  // The server always sends a RELATIVE remaining time, so the deadline and the
  // first displayed value are set together, here in the handler that receives
  // it. Nothing reads the clock while rendering, and the countdown can never
  // flash a stale value from an earlier one.
  const startCountdown = useCallback((endsInMs) => {
    setDeadline(Date.now() + Math.max(0, endsInMs || 0))
    setLeft(Math.max(0, endsInMs || 0))
  }, [])

  const flash = useCallback((msg) => {
    setNotice(msg)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 8000)
  }, [])

  // Join-time sync: a student who refreshes mid-countdown keeps the time they
  // had left, not a fresh window.
  useEffect(() => {
    if (!classId) return undefined
    let alive = true
    apiFetch(`/api/live-classes/${classId}/camera-rule`)
      .then((d) => {
        if (!alive || !d) return
        setEnabled(!!d.rule?.enabled)
        setGraceSeconds(d.rule?.graceSeconds || 0)
        setExcused(!!d.me?.exempt)
        if (d.me?.endsInMs > 0) startCountdown(d.me.endsInMs)
        else setDeadline(null)
      })
      .catch(() => { /* no rule state is a fine state */ })
    return () => { alive = false }
  }, [classId, startCountdown])

  useDataChannel(NOTIFY_TOPIC, (msg) => {
    let p
    try { p = JSON.parse(new TextDecoder().decode(msg.payload)) } catch { return }
    if (p?.type !== 'camera-rule') return
    if (p.classId && classId && p.classId !== String(classId)) return
    if (p.graceSeconds) setGraceSeconds(p.graceSeconds)
    switch (p.action) {
      case 'warn':
        setEnabled(true)
        setExcused(false)
        startCountdown(p.endsInMs)
        break
      case 'cleared':
        // Camera on (or excused) — the server dropped the countdown.
        setDeadline(null)
        break
      case 'off':
        setEnabled(false)
        setDeadline(null)
        flash(`${p.by || 'The host'} turned off the camera requirement.`)
        break
      case 'excused':
        setExcused(true)
        setDeadline(null)
        flash(`${p.by || 'The host'} excused you from having your camera on.`)
        break
      case 'unexcused':
        setExcused(false)
        flash(`${p.by || 'The host'} asks you to turn your camera back on.`)
        break
      case 'removed':
        onRemovalNotice?.({
          blocked: !!p.blocked,
          message: p.blocked
            ? 'You were removed because your camera stayed off, and you have used up your chances. Ask the mentor to let you back in.'
            : `You were removed because your camera stayed off for ${fmtMins(p.graceSeconds)}. You can rejoin with your camera on.`,
        })
        break
      default:
        break
    }
  })

  // On the clock only while the camera is actually off. We keep the deadline
  // until the server says "cleared": a student who turns the camera on and
  // straight back off is still running the ORIGINAL countdown server-side, and
  // showing them a fresh one would be a lie.
  const counting = enabled && !excused && !camLocked && !!deadline && !isCameraEnabled

  // Only the ticking happens here — startCountdown already set the first value.
  useEffect(() => {
    if (!counting) return undefined
    const id = setInterval(() => setLeft(Math.max(0, deadline - Date.now())), 500)
    return () => clearInterval(id)
  }, [counting, deadline])

  const turnOn = async () => {
    setErr('')
    setBusy(true)
    try {
      await localParticipant.setCameraEnabled(true)
    } catch (e) {
      // Overwhelmingly this is the browser's permission prompt being blocked or
      // dismissed — say what to do about it rather than echoing a DOMException.
      setErr(/permission|notallowed/i.test(e?.name + e?.message)
        ? 'Your browser is blocking the camera. Allow camera access for this site (the icon at the end of the address bar), then try again.'
        : e?.message || 'Could not turn on your camera')
    } finally {
      setBusy(false)
    }
  }

  // Speak up instead of (or as well as) raising a hand. A toggle, so the
  // student can mute again once they've been heard without hunting for the bar.
  const toggleMic = async () => {
    setErr('')
    setMicBusy(true)
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
    } catch (e) {
      setErr(/permission|notallowed/i.test(e?.name + e?.message)
        ? 'Your browser is blocking the microphone. Allow microphone access for this site (the icon at the end of the address bar), then try again.'
        : e?.message || 'Could not turn on your microphone')
    } finally {
      setMicBusy(false)
    }
  }

  // The last stretch is a takeover: at this point removal is seconds away.
  const critical = counting && left <= 30_000
  const chip = !counting && (
    excused ? { text: '📷 The mentor has excused you from having your camera on', tone: 'calm' }
      : enabled && !camLocked && isCameraEnabled
        ? {
            text: `📷 Camera required in this class${graceSeconds ? ` — turn it off and you have ${fmtMins(graceSeconds)}` : ''}`,
            // A phone gets the short form: the long one wrapped to two lines
            // and sat over the mentor's face for the whole class.
            short: '📷 Camera required',
            tone: 'calm',
          }
        : null
  )

  return (
    <>
      {/* Top-centre: clear of the title chip (top-left), the toasts (top-right)
          and the media guard's own banners (above the control bar). */}
      <style>{CARD_CSS}</style>
      {(chip || notice || (counting && !critical) || (err && !critical)) && (
        <div className="focas-top-banner" style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          zIndex: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          width: 'min(94vw, 560px)',
          // Nothing here may steal a click from the room behind it; the banner
          // itself re-enables pointer events for its own button.
          pointerEvents: 'none',
        }}>
          {counting && !critical && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              background: 'rgba(127,29,29,0.95)', color: '#fff',
              padding: '8px 10px', borderRadius: 12, pointerEvents: 'auto',
              border: '1px solid rgba(248,113,113,0.6)', boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
            }}>
              <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>📷</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>Turn on your camera</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
                  You'll be removed from the class in <strong>{fmtClock(left)}</strong>
                </div>
              </div>
              <button onClick={turnOn} disabled={busy} style={ctaBtn}>
                {busy ? '…' : 'Turn on camera'}
              </button>
            </div>
          )}
          {chip && (
            <div style={{
              background: 'rgba(0,0,0,0.72)', color: '#e2e8f0', fontSize: 11, fontWeight: 600,
              padding: '5px 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.18)',
            }}>
              <span className="focas-chip-long">{chip.text}</span>
              <span className="focas-chip-short">{chip.short || chip.text}</span>
            </div>
          )}
          {notice && (
            <div style={{
              background: 'rgba(0,0,0,0.82)', color: '#fef3c7', textAlign: 'center',
              fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 10,
              border: '1px solid rgba(250,204,21,0.5)',
            }}>
              {notice}
            </div>
          )}
          {/* The banner's own error (the card shows its own copy). */}
          {err && !critical && (
            <div
              onClick={() => setErr('')}
              title="Dismiss"
              style={{
                background: 'rgba(127,29,29,0.95)', color: '#fff', cursor: 'pointer', pointerEvents: 'auto',
                fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 8,
                border: '1px solid rgba(248,113,113,0.5)',
              }}
            >
              {err}
            </div>
          )}
        </div>
      )}

      {critical && (
        <div
          role="alert"
          aria-label="Camera required"
          className="focas-cam-overlay"
          style={{
            // Stops above the control bar and never captures a click: the
            // student must be able to raise a hand, unmute, chat or leave while
            // this is up. aria-modal would be a lie for the same reason.
            // --focas-bar-h is the bar's live height (LiveRoom), so this
            // clears it however many lines it wraps to, in any orientation.
            position: 'absolute', top: 0, left: 0, right: 0,
            bottom: `var(--focas-bar-h, ${CONTROL_BAR_FALLBACK}px)`,
            zIndex: 45, pointerEvents: 'none',
            background: 'rgba(0,0,0,0.55)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 12,
          }}
        >
          <div className="focas-cam-card" style={{
            background: '#16161c', color: '#fff', borderRadius: 16, padding: 22,
            width: '100%', maxWidth: 380, textAlign: 'center', pointerEvents: 'auto',
            border: '1px solid rgba(248,113,113,0.5)', boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
          }}>
            <div className="focas-cam-icon" style={{ fontSize: 38, lineHeight: 1, marginBottom: 8 }} aria-hidden="true">📷</div>
            <div className="focas-cam-title" style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Turn on your camera</div>
            <div className="focas-cam-clock" style={{
              fontSize: 30, fontWeight: 800, letterSpacing: 1,
              color: left <= 10_000 ? '#fca5a5' : '#fde68a', margin: '6px 0 10px',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {left > 0 ? fmtClock(left) : 'Removing…'}
            </div>
            <div className="focas-cam-text" style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 16 }}>
              {left > 0
                ? 'Your mentor requires cameras on in this class. You will be removed from the room when this reaches zero.'
                : 'Taking you out of the room. Turn your camera on and rejoin.'}
              {' '}If you can't use your camera right now, {micLocked
                ? 'raise your hand and ask the mentor to excuse you.'
                : 'unmute and ask the mentor to excuse you, or raise your hand.'}
            </div>
            {err && (
              <div style={{
                background: 'rgba(127,29,29,0.9)', color: '#fff', fontSize: 11, fontWeight: 600,
                padding: '7px 10px', borderRadius: 8, marginBottom: 12, textAlign: 'left',
                border: '1px solid rgba(248,113,113,0.5)',
              }}>
                {err}
              </div>
            )}
            <button onClick={turnOn} disabled={busy || left <= 0} autoFocus style={{ ...ctaBtn, width: '100%', padding: '12px 0', fontSize: 14 }}>
              {busy ? 'Starting…' : 'Turn on camera'}
            </button>
            {/* The text above tells them to speak up or raise their hand — so
                both buttons are right here, not only in the bar behind this card. */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={toggleMic}
                disabled={micLocked || micBusy}
                title={micLocked
                  ? 'The mentor has turned student microphones off — raise your hand instead'
                  : isMicrophoneEnabled ? 'Mute your microphone' : 'Turn on your microphone and tell the mentor why'}
                style={{
                  ...secondaryBtn,
                  background: micLocked ? 'rgba(255,255,255,0.05)'
                    : isMicrophoneEnabled ? 'rgba(13,148,136,0.9)' : 'rgba(255,255,255,0.1)',
                  color: micLocked ? 'rgba(255,255,255,0.45)' : '#fff',
                  cursor: micLocked ? 'not-allowed' : 'pointer',
                }}
              >
                {micBusy ? '…'
                  : micLocked ? '🔒 Mic off by mentor'
                    : isMicrophoneEnabled ? '🎙 Mic on — talk now' : '🎙 Unmute to talk'}
              </button>
              {onRaiseHand && (
                <button
                  onClick={() => { if (!handRaised) onRaiseHand() }}
                  disabled={handRaised}
                  style={{
                    ...secondaryBtn,
                    background: handRaised ? 'rgba(202,138,4,0.9)' : 'rgba(255,255,255,0.1)',
                    cursor: handRaised ? 'default' : 'pointer',
                  }}
                >
                  {handRaised ? '🖐 Hand raised' : '🖐 Raise hand'}
                </button>
              )}
            </div>
            {(handRaised || isMicrophoneEnabled) && (
              <div style={{ fontSize: 11, color: '#fde68a', marginTop: 8 }}>
                {isMicrophoneEnabled
                  ? 'The mentor can hear you — ask them to excuse you from the camera rule.'
                  : 'The mentor has been told. They can excuse you from the Participants panel.'}
              </div>
            )}
          </div>
        </div>
      )}

    </>
  )
}

// Only until LiveRoom has measured the bar (--focas-bar-h) — one frame.
const CONTROL_BAR_FALLBACK = 96

// The card must fit whatever is left above the bar: a landscape phone leaves
// ~300px, so on short screens it drops the big icon and tightens up, and it
// scrolls rather than ever spilling over the controls.
const CARD_CSS = `
.focas-cam-card { max-height: 100%; overflow-y: auto; }
.focas-chip-short { display: none; }
@media (max-width: 640px), (max-height: 500px), (pointer: coarse) and (max-width: 1100px) {
  .focas-chip-long { display: none; }
  .focas-chip-short { display: inline; }
}
@media (max-height: 560px) {
  .focas-cam-card { padding: 12px 16px !important; max-width: 440px !important; }
  .focas-cam-card .focas-cam-icon { display: none; }
  .focas-cam-card .focas-cam-clock { font-size: 22px !important; margin: 0 0 4px !important; }
  .focas-cam-card .focas-cam-text { font-size: 11px !important; margin-bottom: 10px !important; }
}
/* The minimized corner window (a student submitting work, often on a phone)
   is ~320×200: keep the title, the clock and the three buttons, drop the
   explanation, and start below the window's own title bar so its drag handle
   and expand button stay reachable. */
.focas-pip .focas-cam-overlay { top: 30px !important; padding: 6px !important; }
.focas-pip .focas-cam-card { padding: 8px 10px !important; border-radius: 12px !important; }
.focas-pip .focas-cam-card .focas-cam-icon,
.focas-pip .focas-cam-card .focas-cam-text { display: none; }
.focas-pip .focas-cam-card .focas-cam-title { font-size: 13px !important; margin: 0 !important; }
.focas-pip .focas-cam-card .focas-cam-clock { font-size: 20px !important; margin: 0 0 6px !important; }
.focas-pip .focas-cam-card button { padding-top: 7px !important; padding-bottom: 7px !important; }
`

// The Unmute / Raise hand pair under the main button — half width each.
const secondaryBtn = {
  flex: 1, minWidth: 0, padding: '10px 6px',
  color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10,
  fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}

const ctaBtn = {
  background: '#0d9488', color: '#fff', border: 'none', borderRadius: 10,
  padding: '8px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
  whiteSpace: 'nowrap', flexShrink: 0,
}

// m:ss, rounding UP so a countdown never shows 0:00 while time is left.
function fmtClock(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function fmtMins(seconds) {
  const s = Number(seconds) || 0
  if (s < 60) return `${s} seconds`
  const m = Math.round(s / 60)
  return `${m} minute${m === 1 ? '' : 's'}`
}
