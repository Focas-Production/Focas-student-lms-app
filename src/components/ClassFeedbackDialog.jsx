import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import { markAsked } from '../lib/classFeedback'

// "How was your class?" — a 1–5 star rating and a comment, BOTH optional,
// shown after a live class ends (see StudentLiveSessionProvider and the
// "Rate your classes" strip on LiveClassesPage). The answer goes to the FOCAS
// team only (the admin Class Feedback page) — never to the mentor by name.
//
//   Submit — saves whatever was given (stars, comment, or both)
//   Skip   — saved as a skip: we won't ask about this class again
//   ×      — "later": nothing saved, the class stays in the strip to rate
//
// The server lets a student answer only classes they joined, only after the
// class ends, and only for a few days — see liveClassFeedbackController.

const COMMENT_MAX = 1000
const LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

const source = () => (window.focasDesktop?.isDesktop ? 'desktop' : 'web')

function Star({ filled, onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="p-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 transition-transform active:scale-90">
      <svg viewBox="0 0 24 24" className={`w-9 h-9 sm:w-10 sm:h-10 ${filled ? 'text-amber-400' : 'text-gray-200'}`} fill="currentColor">
        <path d="M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5z" />
      </svg>
    </button>
  )
}

// cls: { _id, title, hostName, subjectName, chapterName }
// initial: an earlier answer to edit, if any
// onClose(result): 'saved' | 'skipped' | 'later'
export default function ClassFeedbackDialog({ cls, initial = null, onClose }) {
  const [rating, setRating] = useState(initial?.rating || 0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState(initial?.comment || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => { markAsked(cls._id) }, [cls._id])

  // Esc = later, like the × button.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose('later') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const hasAnswer = rating > 0 || comment.trim().length > 0

  const save = async (skip) => {
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/live-classes/${cls._id}/feedback`, {
        method: 'PUT',
        body: JSON.stringify(skip ? { source: source() } : { rating: rating || null, comment: comment.trim(), source: source() }),
      })
      if (skip) { onClose('skipped'); return }
      setDone(true)
      setTimeout(() => onClose('saved'), 1400)
    } catch (e) {
      setError(e.message || 'Could not save — please try again')
      setBusy(false)
    }
  }

  const shown = hover || rating
  const about = [cls.subjectName, cls.chapterName].filter(Boolean).join(' · ')

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog" aria-modal="true" aria-labelledby="class-feedback-title">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-xl p-5 sm:p-6 max-h-[92vh] overflow-y-auto">
        {done ? (
          <div className="py-8 text-center">
            <p className="text-4xl mb-2">🙏</p>
            <p className="text-lg font-bold text-gray-900">Thank you!</p>
            <p className="text-sm text-gray-500 mt-1">Your feedback helps us make every class better.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 mb-4">
              <div className="min-w-0 flex-1">
                <h2 id="class-feedback-title" className="text-lg font-bold text-gray-900">How was your class?</h2>
                <p className="text-sm text-gray-600 mt-0.5 break-words">
                  {cls.title}{cls.hostName ? ` · with ${cls.hostName}` : ''}
                </p>
                {about && <p className="text-xs text-indigo-500 mt-0.5 break-words">📖 {about}</p>}
              </div>
              <button type="button" onClick={() => onClose('later')} disabled={busy}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none -mt-1" title="Later" aria-label="Close — rate later">×</button>
            </div>

            <div className="flex flex-col items-center mb-4" onMouseLeave={() => setHover(0)}>
              <div className="flex">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} onMouseEnter={() => setHover(n)}>
                    <Star filled={n <= shown} label={`${n} star${n > 1 ? 's' : ''} — ${LABELS[n]}`}
                      // Tapping the chosen star again clears it — the rating is optional.
                      onClick={() => setRating((r) => (r === n ? 0 : n))} />
                  </span>
                ))}
              </div>
              <p className={`text-sm h-5 mt-1 font-medium ${shown ? 'text-amber-600' : 'text-gray-400'}`}>
                {shown ? LABELS[shown] : 'Tap a star to rate'}
              </p>
            </div>

            <label className="block text-xs font-semibold text-gray-600 mb-1" htmlFor="class-feedback-comment">
              Anything to tell us? <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea id="class-feedback-comment" value={comment} rows={3} maxLength={COMMENT_MAX}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What went well, what could be better…"
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
            <div className="flex justify-between text-[11px] text-gray-400 mt-1">
              <span>🔒 Only the FOCAS team sees this.</span>
              <span className="tabular-nums">{comment.length}/{COMMENT_MAX}</span>
            </div>

            {error && <p className="text-sm text-red-500 mt-3">{error}</p>}

            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => save(true)} disabled={busy}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                Skip
              </button>
              <button type="button" onClick={() => save(false)} disabled={busy || !hasAnswer}
                className="flex-[2] px-4 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400">
                {busy ? 'Saving…' : 'Submit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
