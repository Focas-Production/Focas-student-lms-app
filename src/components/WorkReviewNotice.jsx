import { useEffect, useState } from 'react'
import { useDataChannel } from '@livekit/components-react'
import { apiFetch } from '../api'
import { NOTIFY_TOPIC } from '../utils/livekitPermissions'
import { playAsk, playConfirmed } from '../utils/chime'
import { wasReviewSeen, markReviewSeen } from '../lib/workReviewSeen'

// Student, inside a live room: tells them when a mentor has
//   • asked them to REDO work they handed in ("changes"), or
//   • FINISHED reviewing it ("reviewed", with the marks).
//
// Two ways in, so it can't be missed:
//   1. Push — the server sends { type: 'work-review' } to this student in every
//      live room the moment the mentor presses the button (reviewSubmission →
//      notifyStudentOfReview). The work may be for an earlier class.
//   2. On join — this class's own submission is read once; an unseen redo
//      request (sent while the student was away) is shown then.
// Each outcome shows once per device (lib/workReviewSeen).
//
// Props:
//   classId       the class this room is
//   onOpenSubmit  open the in-room submit panel (only for this class's work)
//   refreshKey    bump to re-read this class's submission (e.g. file count)
//   onStatus      (status) this class's submission status changed — drives the
//                 colour of the Submit button

export default function WorkReviewNotice({ classId, refreshKey = 0, onOpenSubmit, onStatus }) {
  const [notice, setNotice] = useState(null)  // payload shape from the server

  // On join: a redo request for THIS class that arrived while they were away.
  // Re-read whenever the student's file count moves (refreshKey) — handing in
  // new work puts the submission back to "submitted", clearing the orange button.
  useEffect(() => {
    if (!classId) return undefined
    let alive = true
    apiFetch(`/api/live-classes/${classId}/submissions/mine`)
      .then((d) => {
        if (!alive) return
        const s = d?.submission
        onStatus?.(s?.status || null)
        if (s?.status === 'changes_requested' && !wasReviewSeen(classId, s.changesRequestedAt)) {
          setNotice({
            action: 'changes', classId: String(classId), classTitle: s.classTitle || '',
            at: s.changesRequestedAt, note: s.mentorNotes || '', mentorName: s.reviewedBy?.name || '',
          })
          playAsk()
        }
      })
      .catch(() => { /* the push and the Tutor Session page still cover it */ })
    return () => { alive = false }
  }, [classId, refreshKey, onStatus])

  useDataChannel(NOTIFY_TOPIC, (msg) => {
    let p
    try { p = JSON.parse(new TextDecoder().decode(msg.payload)) } catch { return }
    if (p?.type !== 'work-review' || !p.classId) return
    if (String(p.classId) === String(classId)) {
      onStatus?.(p.action === 'changes' ? 'changes_requested' : 'reviewed')
    }
    if (wasReviewSeen(p.classId, p.at)) return
    setNotice(p)
    if (p.action === 'changes') playAsk(); else playConfirmed()
  })

  if (!notice) return null

  const changes = notice.action === 'changes'
  const thisClass = String(notice.classId) === String(classId)
  const who = notice.mentorName || 'Your mentor'
  const score = !changes && notice.marks != null
    ? `${notice.marks}${notice.totalMarks != null ? ` / ${notice.totalMarks}` : ''}` : ''

  const close = () => { markReviewSeen(notice.classId, notice.at); setNotice(null) }
  const open = () => { close(); onOpenSubmit?.() }

  const accent = changes ? '#fb923c' : '#2dd4bf'
  return (
    <div style={{
      position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)',
      zIndex: 28, width: 'min(94vw, 460px)',
    }}>
      <div role="alertdialog" aria-label={changes ? 'Your mentor asked you to redo your work' : 'Your work was reviewed'} style={{
        background: 'rgba(17,24,39,0.97)', color: '#fff', borderRadius: 14,
        padding: '12px 14px', border: `1px solid ${accent}`,
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>{changes ? '↩' : '✅'}</span>
          <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>
              {changes ? `${who} asked you to redo your work` : `${who} reviewed your work`}
              {score && <span style={{ color: accent }}> · {score}</span>}
            </div>
            {!thisClass && notice.classTitle && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
                For the class “{notice.classTitle}”
              </div>
            )}
            {notice.note && (
              <div style={{
                fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 6, whiteSpace: 'pre-wrap',
                background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '6px 8px',
                maxHeight: 120, overflowY: 'auto',
              }}>
                “{notice.note}”
              </div>
            )}
            {changes && !thisClass && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 6 }}>
                After this class, open <b>Tutor Session</b> and press <b>Submit work</b> on that class to send it again.
              </div>
            )}
          </div>
          <button onClick={close} aria-label="Close" style={{
            background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)',
            fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 0,
          }}>×</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          {thisClass && onOpenSubmit ? (
            <>
              <button onClick={close} style={{
                padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: 'transparent', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.3)',
              }}>Later</button>
              <button onClick={open} style={{
                padding: '7px 16px', borderRadius: 9, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                background: changes ? '#ea580c' : '#14b8a6', color: '#fff', border: 'none',
              }}>{changes ? 'Send my work again' : 'See feedback'}</button>
            </>
          ) : (
            <button onClick={close} style={{
              padding: '7px 16px', borderRadius: 9, fontSize: 12, fontWeight: 800, cursor: 'pointer',
              background: '#374151', color: '#fff', border: 'none',
            }}>OK</button>
          )}
        </div>
      </div>
    </div>
  )
}
