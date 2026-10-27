import { useCallback, useEffect, useRef, useState } from 'react'
import { useDataChannel } from '@livekit/components-react'
import { apiFetch } from '../api'
import { NOTIFY_TOPIC } from '../utils/livekitPermissions'
import { playAsk, playNudge, playConfirmed } from '../utils/chime'

// The student's side of "Heard in class". Must live inside <LiveKitRoom>.
//
// The mentor marks that this student explained their work out loud; the
// server pushes { type: 'verbal-check', action: 'ask' } to this student only,
// and this card asks them to confirm. It counts as handed in ONLY when they
// tap "Yes" — the mentor can't record one alone, and the student can't start
// one at all (see markVerbal / respondVerbal in the server's
// classSubmissionController). "No" is recorded too and shown to admins.
//
// A poll backs up the push: a student who reconnects, or whose data message
// was dropped, still sees the question while it's open. The countdown ticks
// from a RELATIVE expiresInMs, so a wrong device clock can't shorten it.
//
// Sound: a call when a NEW question arrives (a student looking at their
// notes may not be watching the screen), a nudge with 30 s left, and a short
// tone when their yes is recorded.
const POLL_MS = 20_000
const NUDGE_AT_MS = 30_000

const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function VerbalCheckGuard({ classId, onConfirmed }) {
  const [check, setCheck] = useState(null)     // the open request, or null
  const [deadline, setDeadline] = useState(0)  // local epoch ms
  const [left, setLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef(null)
  const seenRef = useRef(new Set())   // check ids already announced with sound
  const nudgedRef = useRef(null)      // check id already nudged
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  const flash = useCallback((msg) => {
    setNotice(msg)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 6000)
  }, [])

  const show = useCallback((c) => {
    if (!c || !(c.expiresInMs > 0)) { setCheck(null); return }
    // The push and the poll both deliver the same question — ring once.
    const id = String(c._id)
    if (!seenRef.current.has(id)) { seenRef.current.add(id); playAsk() }
    setCheck(c)
    setErr('')
    setDeadline(Date.now() + c.expiresInMs)
    setLeft(c.expiresInMs)
  }, [])

  const poll = useCallback(() => {
    if (!classId) return
    apiFetch(`/api/live-classes/${classId}/submissions/verbal/pending`)
      .then((d) => show(d?.check || null))
      .catch(() => { /* keep whatever we have */ })
  }, [classId, show])

  useEffect(() => {
    poll()
    const t = setInterval(() => { if (document.visibilityState === 'visible') poll() }, POLL_MS)
    return () => clearInterval(t)
  }, [poll])

  useDataChannel(NOTIFY_TOPIC, (msg) => {
    let p
    try { p = JSON.parse(new TextDecoder().decode(msg.payload)) } catch { return }
    if (p?.type !== 'verbal-check') return
    if (p.classId && classId && p.classId !== String(classId)) return
    if (p.action === 'ask') show(p.check)
    else if (p.action === 'cancel') {
      setCheck((cur) => (cur && String(cur._id) === String(p.checkId) ? null : cur))
    }
  })

  useEffect(() => {
    if (!check) return undefined
    const t = setInterval(() => {
      const ms = deadline - Date.now()
      setLeft(ms)
      if (ms <= NUDGE_AT_MS && ms > 0 && nudgedRef.current !== String(check._id)) {
        nudgedRef.current = String(check._id)
        playNudge()
      }
      if (ms <= 0) {
        setCheck(null)
        flash('The confirmation timed out. Ask your mentor to send it again.')
      }
    }, 500)
    return () => clearInterval(t)
  }, [check, deadline, flash])

  const answer = async (confirm) => {
    if (!check) return
    setBusy(true)
    setErr('')
    try {
      await apiFetch(`/api/live-classes/${classId}/submissions/verbal/${check._id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ confirm }),
      })
      setCheck(null)
      if (confirm) {
        playConfirmed()
        flash('Recorded — your mentor will review it.')
        onConfirmed?.()
      } else {
        flash('Okay — nothing was recorded.')
      }
    } catch (e) {
      setErr(e.message || 'Could not send your answer')
      // The request may have closed under us (expired / cancelled).
      poll()
    } finally {
      setBusy(false)
    }
  }

  if (!check && !notice) return null

  const what = [check?.chapter?.name, check?.unit?.name].filter(Boolean).join(' · ')
  return (
    <div style={{
      position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)',
      zIndex: 27, width: 'min(94vw, 440px)', pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    }}>
      {check && (
        <div role="dialog" aria-label="Confirm work explained in class" style={{
          width: '100%', pointerEvents: 'auto',
          background: 'rgba(17,24,39,0.97)', color: '#fff', borderRadius: 14,
          padding: '12px 14px', border: '1px solid rgba(45,212,191,0.6)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>🗣</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>
                {check.markedBy?.name || 'Your mentor'} says you explained {what ? <span style={{ color: '#5eead4' }}>{what}</span> : 'your work'} out loud.
              </div>
              {check.note && (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>“{check.note}”</div>
              )}
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                Is that right? It counts as your submission only if you say yes · {fmtClock(left)}
              </div>
            </div>
          </div>
          {err && (
            <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 6 }}>{err}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button onClick={() => answer(false)} disabled={busy} style={{
              padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: 'transparent', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.3)',
            }}>No</button>
            <button onClick={() => answer(true)} disabled={busy} style={{
              padding: '7px 16px', borderRadius: 9, fontSize: 12, fontWeight: 800, cursor: 'pointer',
              background: '#14b8a6', color: '#fff', border: 'none',
            }}>{busy ? '…' : 'Yes, I did'}</button>
          </div>
        </div>
      )}
      {!check && notice && (
        <div style={{
          background: 'rgba(0,0,0,0.82)', color: '#ccfbf1', textAlign: 'center',
          fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 10,
          border: '1px solid rgba(45,212,191,0.5)',
        }}>
          {notice}
        </div>
      )}
    </div>
  )
}
