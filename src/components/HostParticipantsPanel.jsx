import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ParticipantKind, Track } from 'livekit-client'
import {
  useDataChannel, useIsMuted, useIsSpeaking, useLocalParticipant,
  useParticipantPermissions, useRemoteParticipants,
} from '@livekit/components-react'
import { apiFetch } from '../api'
import { NOTIFY_TOPIC, canPublishSource } from '../utils/livekitPermissions'

// The host's participants drawer — Zoom's "Participants" panel for a class.
// Must live inside <LiveKitRoom>.
//
// Per student:  Mute / Stop video (they can turn it back on), Ask to unmute /
//               Ask for video (a prompt on their screen — the host can't switch
//               a student's mic on remotely, and shouldn't), and a ⋯ menu with
//               the hard locks ("Don't allow to unmute") and Remove.
// Everyone:     Mute all / Stop all video, with Zoom's "allow students to turn
//               it back on" choice, and two standing switches for whether
//               students may unmute / start video at all, plus the "camera must
//               be on" rule: a switch for this class, and a live countdown on
//               every student the rule is currently waiting on. The grace time
//               and the rejoin limit are ADMIN settings — the switch here is the
//               host's, and so is excusing a student who genuinely can't be on
//               video: one click on the row while their countdown runs (they are
//               usually asking out loud with seconds left), or from the ⋯ menu
//               any time (see server/utils/cameraRule.js).
//
// What each row shows comes from LiveKit itself (is the track muted? does the
// participant still have permission for the source?), so it's right even when
// a student muted themselves. The persisted policy — fetched once, then kept
// fresh by the server's "media-policy" pushes — only adds what LiveKit can't
// know: the room-wide switches and who's been removed.
// hands: [{ id, name }] — who has a hand up in this room (server's list, via
// LiveRoom). Those rows float to the top and wear a 🖐, so the panel answers
// "who wants to speak" as well as "who is here".
export default function HostParticipantsPanel({ classId, hands = [], onClose }) {
  const { localParticipant } = useLocalParticipant()
  const remote = useRemoteParticipants()
  const handOrder = new Map((hands || []).map((h, i) => [String(h.id), i]))
  // Students only: real people, not egress/agents, and not a mirrored copy of
  // this host (ForwardParticipant keeps the host's identity). Hands up first,
  // in the order they were raised; then everyone else as LiveKit lists them.
  const students = remote
    .filter((p) => p.kind === ParticipantKind.STANDARD && p.identity !== localParticipant?.identity)
    .sort((a, b) => (handOrder.get(a.identity) ?? Infinity) - (handOrder.get(b.identity) ?? Infinity))
  const handsUp = students.filter((p) => handOrder.has(p.identity)).length

  const [policy, setPolicy] = useState(null)
  // The "camera must be on" rule, plus the instant it arrived: the server sends
  // each countdown as a RELATIVE remaining time, so the arrival time is what
  // turns those into local deadlines. `now` ticks forward from there — reading
  // the clock while rendering would be impure (and would not re-render anyway).
  const [camRule, setCamRule] = useState(null)
  const [camAt, setCamAt] = useState(0)
  const [now, setNow] = useState(0)
  const [busy, setBusy] = useState({})      // action key → true while in flight
  const [err, setErr] = useState('')
  const [sheet, setSheet] = useState(null)  // { source } — the "mute all" confirm
  const [allowBack, setAllowBack] = useState(true)
  const [menuFor, setMenuFor] = useState(null)
  const errTimer = useRef(null)
  useEffect(() => () => clearTimeout(errTimer.current), [])

  const flash = useCallback((msg) => {
    setErr(msg)
    clearTimeout(errTimer.current)
    errTimer.current = setTimeout(() => setErr(''), 6000)
  }, [])

  const base = `/api/live-classes/manage/${classId}`

  // "asking for 2 min" needs a clock even in a class that never turned the
  // camera rule on, so the panel stamps one as soon as it has a policy.
  const applyCamRule = useCallback((rule) => {
    const at = Date.now()
    setCamRule(rule)
    setCamAt(at)
    setNow(at)
  }, [])

  useEffect(() => {
    let alive = true
    apiFetch(`${base}/media`)
      .then((d) => { if (alive && d?.policy) { setPolicy(d.policy); setNow(Date.now()) } })
      .catch((e) => { if (alive) flash(e.message || 'Could not load the room policy') })
    apiFetch(`${base}/camera-rule`)
      .then((d) => { if (alive && d?.rule) applyCamRule(d.rule) })
      .catch(() => { /* the rule panel just stays in its loading state */ })
    return () => { alive = false }
  }, [base, flash, applyCamRule])

  // Another host window (or this one) changed something — keep in step.
  useDataChannel(NOTIFY_TOPIC, (msg) => {
    let p
    try { p = JSON.parse(new TextDecoder().decode(msg.payload)) } catch { return }
    if (p.classId !== String(classId)) return
    // The camera rule pushes on every change — a countdown starting, a student
    // complying, a removal — so this panel is the server's view, not a guess.
    if (p.type === 'camera-rule-state' && p.rule) { applyCamRule(p.rule); return }
    if (p.type !== 'media-policy' || !p.policy) return
    setPolicy(p.policy)
  })

  const run = useCallback(async (key, path, options) => {
    setBusy((b) => ({ ...b, [key]: true }))
    try {
      const d = await apiFetch(path, options)
      if (d?.policy) setPolicy(d.policy)
      if (d?.rule) applyCamRule(d.rule)
      return d
    } catch (e) {
      flash(e.message || 'That didn’t work')
      return null
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[key]; return n })
    }
  }, [flash, applyCamRule])

  const control = (identity, source, action) => run(
    `${identity}:${source}`,
    `${base}/participants/${identity}/media`,
    { method: 'POST', body: JSON.stringify({ source, action }) },
  )
  const controlAll = (source, action) => run(
    `all:${source}`,
    `${base}/media/all`,
    { method: 'POST', body: JSON.stringify({ source, action }) },
  )
  const remove = (p) => {
    const name = p.name || p.identity
    if (!window.confirm(`Remove ${name} from the class?\n\nThey won't be able to rejoin unless you let them back in from this panel.`)) return
    setMenuFor(null)
    run(`remove:${p.identity}`, `${base}/participants/${p.identity}`, { method: 'DELETE' })
  }
  const readmit = (userId) => run(`readmit:${userId}`, `${base}/participants/${userId}/readmit`, { method: 'POST', body: '{}' })
  // Answering a student who asked to come back. Approving is a readmit that
  // also clears their camera strikes, so the rule doesn't throw them straight
  // back out; declining leaves them removed and free to ask again.
  const decideRejoin = (userId, approve) => run(
    `rejoin:${userId}`, `${base}/participants/${userId}/rejoin`,
    { method: 'POST', body: JSON.stringify({ approve }) },
  )

  // ── "camera must be on" ──
  const toggleCameraRule = (enabled) => run(
    'camera-rule', `${base}/camera-rule`,
    { method: 'POST', body: JSON.stringify({ enabled }) },
  )
  const setExempt = (p, exempt) => {
    setMenuFor(null)
    run(`exempt:${p.identity}`, `${base}/participants/${p.identity}/camera-exempt`,
      { method: 'POST', body: JSON.stringify({ exempt }) })
  }

  // Declared before the ticker effect below, which reads waitingCount from its
  // dependency array — that is evaluated during render, so a later `const`
  // would still be in its temporal dead zone.
  const removedList = policy?.removed || []
  const waitingCount = removedList.filter((r) => r.request?.status === 'pending').length

  // The server sends each countdown as a RELATIVE remaining time, so turn it
  // into a local deadline the moment it arrives and tick from that — no clock
  // skew, and no re-render storm from re-reading the server.
  const camDeadlines = useMemo(
    () => new Map((camRule?.pending || []).map((x) => [x.userId, camAt + x.endsInMs])),
    [camRule, camAt],
  )
  useEffect(() => {
    if (!camDeadlines.size && !waitingCount) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [camDeadlines, waitingCount])

  const camEnabled = !!camRule?.enabled
  const camExempt = new Set((camRule?.exempt || []).map((e) => e.userId))
  const camStrikes = camRule?.strikes || {}
  // Students the camera rule removed AND blocked — the Removed list says why.
  const camBlocked = new Set((camRule?.removals || []).filter((r) => r.blocked).map((r) => r.userId))
  const camWaiting = camDeadlines.size

  // "Mute all" sheet → soft mute, or lock when the host unticks "allow".
  const confirmSheet = async () => {
    const { source } = sheet
    setSheet(null)
    if (allowBack) {
      await controlAll(source, 'mute')
      // If the room was locked, "allow" means unlock it too.
      if (policy?.[source === 'mic' ? 'micLocked' : 'cameraLocked']) await controlAll(source, 'unlock')
    } else {
      await controlAll(source, 'lock')
    }
  }

  const micLockedRoom = !!policy?.micLocked
  const camLockedRoom = !!policy?.cameraLocked
  const removed = removedList

  return (
    <div
      role="dialog"
      aria-label="Participants"
      className="focas-ppanel"
      onClick={() => setMenuFor(null)}
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 30,
        // 440 on a laptop so a full name fits beside the row's two buttons; the
        // whole screen on a phone, where the row goes two-line (PANEL_CSS).
        width: 'min(440px, 100vw)', display: 'flex', flexDirection: 'column',
        background: 'rgba(17,17,22,0.97)', color: '#fff',
        borderLeft: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
      }}
    >
      <style>{PANEL_CSS}</style>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Participants</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
            {students.length} student{students.length === 1 ? '' : 's'} in this room
            {handsUp > 0 && (
              <span style={{ color: '#fde68a', fontWeight: 700 }}>{' · '}🖐 {handsUp} hand{handsUp === 1 ? '' : 's'} up</span>
            )}
            {camEnabled && (
              <span style={{ color: '#7dd3fc', fontWeight: 700 }}>
                {' · '}📷 camera required{camWaiting > 0 ? ` · ${camWaiting} waiting` : ''}
              </span>
            )}
            {(micLockedRoom || camLockedRoom) && (
              <span style={{ color: '#fca5a5', fontWeight: 700 }}>
                {' · '}🔒 {[micLockedRoom && 'mic', camLockedRoom && 'video'].filter(Boolean).join(' & ')} locked
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} title="Close" aria-label="Close participants" style={iconBtn}>✕</button>
      </div>

      {err && (
        <div style={{
          margin: '8px 12px 0', background: 'rgba(127,29,29,0.92)', color: '#fff',
          fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 8,
          border: '1px solid rgba(248,113,113,0.5)',
        }}>
          {err}
        </div>
      )}

      {/* Rows */}
      <div className="focas-ppanel-rows" style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {students.length === 0 && (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', padding: '28px 12px' }}>
            No students in the room yet.
          </div>
        )}
        {students.map((p) => (
          <StudentRow
            key={p.identity}
            p={p}
            handUp={handOrder.has(p.identity)}
            busy={busy}
            menuOpen={menuFor === p.identity}
            onMenu={(open) => setMenuFor(open ? p.identity : null)}
            onControl={(source, action) => { setMenuFor(null); control(p.identity, source, action) }}
            onRemove={() => remove(p)}
            camRuleOn={camEnabled}
            camExempt={camExempt.has(p.identity)}
            camEndsAt={camDeadlines.get(p.identity) || null}
            now={now}
            camStrikes={camStrikes[p.identity] || 0}
            onExempt={(exempt) => setExempt(p, exempt)}
          />
        ))}

        {removed.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'rgba(255,255,255,0.45)', padding: '6px 6px 4px' }}>
              Removed ({removed.length}){waitingCount > 0 ? ` · ${waitingCount} asking to come back` : ''}
            </div>
            {removed.map((r) => {
              const asking = r.request?.status === 'pending'
              const rejoinBusy = !!busy[`rejoin:${r.userId}`]
              return (
                <div key={r.userId} className="focas-prow" style={{
                  ...row,
                  opacity: asking ? 1 : 0.85,
                  borderColor: asking ? 'rgba(245,158,11,0.7)' : 'rgba(255,255,255,0.06)',
                  background: asking ? 'rgba(120,53,15,0.28)' : undefined,
                }}>
                  <Avatar name={r.name || '?'} dim={!asking} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name || r.userId}
                    </div>
                    {asking && (
                      <div style={{ fontSize: 10, color: '#fcd34d', fontWeight: 800 }}>
                        🙋 Asking to come back{r.request.at ? ` · ${sinceLabel(r.request.at, now)}` : ''}
                      </div>
                    )}
                    {!asking && r.request?.status === 'declined' && (
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
                        You declined their request
                      </div>
                    )}
                    {camBlocked.has(r.userId) && (
                      <div style={{ fontSize: 10, color: '#fca5a5', fontWeight: 600 }}>
                        📷 camera stayed off {camStrikes[r.userId] ? `· ${camStrikes[r.userId]}×` : ''}
                      </div>
                    )}
                  </div>
                  {asking ? (
                    <div className="focas-prow-actions">
                      <button
                        onClick={() => decideRejoin(r.userId, false)}
                        disabled={rejoinBusy}
                        title={`Say no to ${r.name || 'this student'} — they stay out and may ask again`}
                        style={{ ...pill, background: 'rgba(255,255,255,0.12)' }}
                      >Not now</button>
                      <button
                        onClick={() => decideRejoin(r.userId, true)}
                        disabled={rejoinBusy}
                        title={`Let ${r.name || 'this student'} back into the class`}
                        style={{ ...pill, background: '#0d9488' }}
                      >{rejoinBusy ? '…' : '✓ Let in'}</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => readmit(r.userId)}
                      disabled={!!busy[`readmit:${r.userId}`]}
                      title="Let this student join the class again"
                      style={{ ...pill, background: 'rgba(255,255,255,0.1)' }}
                    >Let back in</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer: room-wide controls */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '10px 12px', flexShrink: 0 }}>
        {sheet ? (
          <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
              {sheet.source === 'mic' ? 'Mute all students?' : 'Stop all students’ video?'}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={allowBack} onChange={(e) => setAllowBack(e.target.checked)} />
              Allow students to {sheet.source === 'mic' ? 'unmute themselves' : 'turn their video back on'}
            </label>
            {/* Stopping video while the camera rule is on would put the whole
                room on a countdown a second later — say so before it happens. */}
            {sheet.source === 'camera' && camEnabled && allowBack && (
              <div style={{
                background: 'rgba(120,53,15,0.85)', color: '#fde68a', fontSize: 11, fontWeight: 600,
                padding: '6px 9px', borderRadius: 8, marginBottom: 12,
                border: '1px solid rgba(245,158,11,0.5)',
              }}>
                ⚠ Cameras are required in this class, so everyone will be asked to turn theirs back
                on within {fmtGrace(camRule?.graceSeconds)}. Untick the box above, or switch the
                camera rule off below, to stop video for longer.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setSheet(null)} style={{ ...pill, flex: 1, background: 'rgba(255,255,255,0.1)', padding: '9px 0' }}>Cancel</button>
              <button onClick={confirmSheet} style={{ ...pill, flex: 1, background: '#dc2626', padding: '9px 0' }}>
                {sheet.source === 'mic' ? 'Mute all' : 'Stop all video'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => { setAllowBack(!micLockedRoom); setSheet({ source: 'mic' }) }}
                disabled={!!busy['all:mic'] || students.length === 0}
                style={{ ...pill, flex: 1, background: 'rgba(255,255,255,0.1)', padding: '9px 0' }}
              >🔇 Mute all</button>
              <button
                onClick={() => { setAllowBack(!camLockedRoom); setSheet({ source: 'camera' }) }}
                disabled={!!busy['all:camera'] || students.length === 0}
                style={{ ...pill, flex: 1, background: 'rgba(255,255,255,0.1)', padding: '9px 0' }}
              >📷 Stop all video</button>
            </div>
            <Switch
              checked={!micLockedRoom}
              busy={!!busy['all:mic']}
              label="Students can unmute themselves"
              hint={micLockedRoom ? 'Off: every student is muted and can’t unmute' : 'Turning this off mutes everyone now'}
              onChange={(on) => controlAll('mic', on ? 'unlock' : 'lock')}
            />
            <Switch
              checked={!camLockedRoom}
              busy={!!busy['all:camera']}
              label="Students can turn on video"
              hint={camLockedRoom ? 'Off: every student’s camera is off and stays off' : 'Turning this off stops every camera now'}
              onChange={(on) => controlAll('camera', on ? 'unlock' : 'lock')}
            />
            <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '8px 0 4px' }} />
            {/* The rule itself: the host's switch, the admin's numbers. */}
            <Switch
              checked={camEnabled}
              busy={!!busy['camera-rule'] || camRule === null || camLockedRoom}
              label="Require students to turn their camera on"
              hint={camLockedRoom
                ? camEnabled
                  // Both at once is a contradiction the server resolves in the
                  // student's favour — say so rather than leave a switch that
                  // reads "on" while nothing is being enforced.
                  ? 'Paused — student video is locked above, so nobody is being asked for a camera'
                  : 'Not available while student video is locked above'
                : camEnabled
                  ? `A student whose camera is off is removed after ${fmtGrace(camRule?.graceSeconds)}${camRule?.maxStrikes ? ` · blocked from rejoining after ${camRule.maxStrikes}` : ''}. Excuse anyone who can’t from their ⋯ menu.`
                  : `Off: nobody is removed for having their camera off${camRule ? ` · admin sets the wait to ${fmtGrace(camRule.graceSeconds)}` : ''}`}
              onChange={(on) => {
                if (on && !window.confirm(`Require cameras in this class?\n\nEvery student whose camera is off gets ${fmtGrace(camRule?.graceSeconds)} to turn it on, then they are removed from the room.${camRule?.maxStrikes ? `\nAfter ${camRule.maxStrikes} removals they can only come back if you let them in.` : ''}\n\nYou can excuse any student from their ⋯ menu.`)) return
                toggleCameraRule(on)
              }}
            />
            {camEnabled && camWaiting > 0 && (
              <div style={{ fontSize: 10, color: '#fca5a5', fontWeight: 700, padding: '2px 0 0 26px' }}>
                ⏳ {camWaiting} student{camWaiting === 1 ? '' : 's'} still to turn their camera on
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StudentRow({
  p, handUp, busy, menuOpen, onMenu, onControl, onRemove,
  camRuleOn, camExempt, camEndsAt, camStrikes, onExempt, now,
}) {
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone })
  const camMuted = useIsMuted({ participant: p, source: Track.Source.Camera })
  const perms = useParticipantPermissions({ participant: p })
  const speaking = useIsSpeaking(p)
  const micLocked = !canPublishSource(perms, 'mic')
  const camLocked = !canPublishSource(perms, 'camera')
  const name = p.name || p.identity
  const micBusy = !!busy[`${p.identity}:mic`]
  const camBusy = !!busy[`${p.identity}:camera`]
  const removing = !!busy[`remove:${p.identity}`]
  const exemptBusy = !!busy[`exempt:${p.identity}`]
  // Counting down only matters while the rule is on and their camera is off —
  // the server has already stopped the clock for anyone excused.
  const camCounting = camRuleOn && !camExempt && camMuted && camEndsAt != null
  const camLeft = camCounting ? Math.max(0, camEndsAt - now) : 0

  // Primary mic button: the one thing a host most likely wants right now.
  const mic = !micMuted
    ? { label: 'Mute', title: `Mute ${name} — they can unmute themselves`, action: 'mute', tone: 'warn' }
    : micLocked
      ? { label: '🔒 Allow mic', title: `Let ${name} unmute`, action: 'unlock', tone: 'locked' }
      : { label: 'Ask to unmute', title: `Ask ${name} to unmute — only they can turn it on`, action: 'ask', tone: 'ask' }
  const cam = !camMuted
    ? { label: 'Stop video', title: `Turn off ${name}'s camera — they can turn it back on`, action: 'mute', tone: 'warn' }
    : camLocked
      ? { label: '🔒 Allow video', title: `Let ${name} turn their camera on`, action: 'unlock', tone: 'locked' }
      : { label: 'Ask for video', title: `Ask ${name} to turn their camera on`, action: 'ask', tone: 'ask' }

  return (
    <div className="focas-prow" style={{
      ...row, position: 'relative',
      borderColor: camCounting ? 'rgba(220,38,38,0.7)'
        : handUp ? 'rgba(202,138,4,0.7)' : speaking ? 'rgba(20,184,166,0.6)' : 'rgba(255,255,255,0.06)',
      background: camCounting ? 'rgba(220,38,38,0.10)' : handUp ? 'rgba(202,138,4,0.10)' : undefined,
    }}>
      <Avatar name={name} speaking={speaking} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          {handUp && (
            <span title="Hand raised" style={{ background: '#ca8a04', color: '#fff', fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 999, flexShrink: 0 }}>
              🖐 Hand up
            </span>
          )}
          {camCounting && (
            <span
              title={`Removed in ${fmtClock(camLeft)} unless they turn their camera on`}
              style={{ background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 999, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
            >
              📷 {camLeft > 0 ? fmtClock(camLeft) : 'removing…'}
            </span>
          )}
          {camExempt && (
            <span title="Excused from the camera rule by the host" style={{ background: 'rgba(255,255,255,0.14)', color: '#93c5fd', fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 999, flexShrink: 0 }}>
              📷 Excused
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 1 }}>
          <span title={micLocked ? 'Microphone locked by host' : micMuted ? 'Microphone off' : 'Microphone on'}
            style={{ color: micLocked ? '#fca5a5' : micMuted ? undefined : '#5eead4' }}>
            {micLocked ? '🔒🎙' : micMuted ? '🔇' : '🎙'}
          </span>
          <span title={camLocked ? 'Camera locked by host' : camMuted ? 'Camera off' : 'Camera on'}
            style={{ color: camLocked ? '#fca5a5' : camMuted ? undefined : '#5eead4' }}>
            {camLocked ? '🔒📷' : camMuted ? '📷̸' : '📷'}
          </span>
          {camStrikes > 0 && (
            <span title={`Removed ${camStrikes} time${camStrikes === 1 ? '' : 's'} for having their camera off`} style={{ color: '#fca5a5' }}>
              ⚠ {camStrikes}×
            </span>
          )}
        </div>
      </div>
      <div className="focas-prow-actions">
      <button onClick={() => onControl('mic', mic.action)} disabled={micBusy || removing} title={mic.title} style={{ ...pill, ...TONE[mic.tone] }}>
        {micBusy ? '…' : mic.label}
      </button>
      {/* On the clock, "Ask for video" is redundant — the rule is already
          asking. What the host needs then is the answer to a student saying
          "my camera's broken": one click, not a trip into the ⋯ menu with
          seconds left. */}
      {camCounting ? (
        <button
          onClick={() => onExempt(true)}
          disabled={exemptBusy || removing}
          title={`Excuse ${name} from the camera rule — their countdown stops now`}
          style={{ ...pill, ...TONE.excuse }}
        >
          {exemptBusy ? '…' : '🆘 Excuse'}
        </button>
      ) : (
        <button onClick={() => onControl('camera', cam.action)} disabled={camBusy || removing} title={cam.title} style={{ ...pill, ...TONE[cam.tone] }}>
          {camBusy ? '…' : cam.label}
        </button>
      )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onMenu(!menuOpen) }}
        title="More"
        aria-label={`More actions for ${name}`}
        aria-expanded={menuOpen}
        style={{ ...iconBtn, background: menuOpen ? 'rgba(255,255,255,0.16)' : 'transparent' }}
      >⋯</button>

      {menuOpen && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', right: 8, top: 'calc(100% - 4px)', zIndex: 5, minWidth: 220,
            background: '#1f1f27', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10,
            boxShadow: '0 12px 28px rgba(0,0,0,0.55)', padding: 4,
          }}
        >
          <MenuItem onClick={() => onControl('mic', micLocked ? 'unlock' : 'lock')}>
            {micLocked ? '🔓 Allow to unmute' : '🔒 Don’t allow to unmute'}
          </MenuItem>
          <MenuItem onClick={() => onControl('camera', camLocked ? 'unlock' : 'lock')}>
            {camLocked ? '🔓 Allow video' : '🔒 Don’t allow video'}
          </MenuItem>
          {camRuleOn && (
            <MenuItem onClick={() => onExempt(!camExempt)} disabled={exemptBusy}>
              {camExempt ? '📷 Require their camera again' : '🆘 Excuse from the camera rule'}
            </MenuItem>
          )}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 2px' }} />
          <MenuItem onClick={onRemove} danger>⛔ Remove from class</MenuItem>
        </div>
      )}
    </div>
  )
}

function Switch({ checked, busy, label, hint, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={busy}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: '#0d9488' }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 700 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{hint}</span>
      </span>
    </label>
  )
}

function Avatar({ name, speaking, dim }) {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
      background: dim ? '#374151' : '#0d9488', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 800,
      boxShadow: speaking ? '0 0 0 2px #14b8a6' : 'none',
    }}>
      {(name || '?').trim()[0]?.toUpperCase() || '?'}
    </div>
  )
}

function MenuItem({ onClick, danger, disabled, children }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      style={{
        opacity: disabled ? 0.55 : 1,
        display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
        color: danger ? '#fca5a5' : '#fff', fontSize: 12, fontWeight: 600,
        padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
    >
      {children}
    </button>
  )
}

// Phone layout. A row's buttons are one group (.focas-prow-actions) that is
// invisible to layout on a laptop — one line: avatar, name, buttons, ⋯ — and
// becomes its own full-width second line on a phone, so a name is never cut to
// "Kart…" by two buttons it has no room beside. On a short screen (a phone in
// landscape) the whole drawer scrolls, or the switches in the footer would
// leave the list a sliver.
const PANEL_CSS = `
.focas-prow-actions { display: contents; }
@media (max-width: 480px) {
  .focas-prow { flex-wrap: wrap; row-gap: 6px !important; }
  .focas-prow-actions { display: flex; order: 3; flex-basis: 100%; gap: 6px; padding-left: 40px; }
  .focas-prow-actions > button { flex: 1; min-height: 36px; }
}
@media (max-height: 560px) {
  .focas-ppanel { overflow-y: auto; }
  .focas-ppanel-rows { flex: none !important; overflow: visible !important; }
}
`

// m:ss, rounding UP so a countdown never reads 0:00 while time is left.
function fmtClock(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// "just now" / "3 min" — how long a student has been waiting on an answer.
function sinceLabel(at, now) {
  const mins = Math.floor(Math.max(0, now - new Date(at).getTime()) / 60000)
  if (!now || mins < 1) return 'just now'
  return `${mins} min`
}

// The grace window in words, for the host's switch — "2 minutes", "90 seconds".
function fmtGrace(seconds) {
  const s = Number(seconds) || 0
  if (!s) return 'the time the admin has set'
  if (s % 60 === 0) return `${s / 60} minute${s === 60 ? '' : 's'}`
  return `${s} seconds`
}

const row = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px',
  borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', marginBottom: 4,
}
const pill = {
  border: 'none', color: '#fff', fontSize: 11, fontWeight: 700,
  padding: '6px 9px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
}
const iconBtn = {
  background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', color: '#fff',
  width: 30, height: 30, borderRadius: 8, fontSize: 14, fontWeight: 800, cursor: 'pointer', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const TONE = {
  warn:   { background: 'rgba(220,38,38,0.85)' },
  ask:    { background: 'rgba(13,148,136,0.85)' },
  locked: { background: 'rgba(255,255,255,0.14)', color: '#fca5a5' },
  excuse: { background: 'rgba(217,119,6,0.95)' },
}
