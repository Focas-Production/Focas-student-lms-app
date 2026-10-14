import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FeedbackContext } from './feedbackContext'

// App-wide toasts and a styled confirm dialog (hooks: feedbackContext.js) — the replacement for
// window.alert/confirm on regular pages. Mounted once in App.jsx.
//
//   const toast = useToast();     toast.success('Saved', 'optional detail')
//   const confirm = useConfirm(); if (!(await confirm({ title, message, confirmLabel, tone: 'danger' }))) return
//
// Both degrade gracefully outside the provider (console / window.confirm), so a
// component rendered somewhere unexpected never crashes on a missing context.
//
// Not for the live room: it can pop out into a Picture-in-Picture window,
// where a dialog rendered in this document would be invisible.

const TOAST_MS = 4500
const MAX_TOASTS = 4

const TONES = {
  success: { ring: 'bg-teal-100 text-teal-700', bar: 'bg-teal-500' },
  error:   { ring: 'bg-red-100 text-red-600',   bar: 'bg-red-500' },
  info:    { ring: 'bg-slate-100 text-slate-600', bar: 'bg-slate-400' },
}

function ToneIcon({ kind }) {
  const common = { className: 'w-4 h-4', viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, 'aria-hidden': true }
  if (kind === 'success') return <svg {...common}><path d="M4.5 10.5l3.5 3.5L15.5 6.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (kind === 'error') return <svg {...common}><path d="M10 5.5v5.5M10 14.5h.01" strokeLinecap="round" /></svg>
  return <svg {...common}><path d="M10 9v5M10 6h.01" strokeLinecap="round" /></svg>
}

function Toast({ toast, onDismiss }) {
  const tone = TONES[toast.kind] || TONES.info
  return (
    <div role={toast.kind === 'error' ? 'alert' : 'status'}
      className="fb-toast pointer-events-auto relative w-full sm:w-[22rem] overflow-hidden rounded-2xl bg-white shadow-[0_10px_40px_-10px_rgba(15,23,42,0.35)] ring-1 ring-black/5">
      <div className="flex items-start gap-3 p-3.5 pr-10">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${tone.ring}`}>
          <ToneIcon kind={toast.kind} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-sm font-semibold text-gray-900 leading-snug">{toast.title}</p>
          {toast.message && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{toast.message}</p>}
        </div>
      </div>
      <button onClick={() => onDismiss(toast.id)} aria-label="Dismiss"
        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center text-lg leading-none">
        ×
      </button>
      <span className={`fb-toast-bar absolute bottom-0 left-0 h-0.5 ${tone.bar}`} style={{ animationDuration: `${TOAST_MS}ms` }} />
    </div>
  )
}

function ConfirmDialog({ opts, onAnswer }) {
  const danger = opts.tone === 'danger'
  const cancelRef = useRef(null)
  const okRef = useRef(null)

  useEffect(() => {
    // Destructive actions start on Cancel, so a stray Enter doesn't fire them.
    ;(danger ? cancelRef : okRef).current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onAnswer(false) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [danger, onAnswer])

  return (
    <div className="fb-fade fixed inset-0 z-[90] bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => onAnswer(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="fb-confirm-title" aria-describedby="fb-confirm-msg"
        className="fb-pop bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 flex items-start gap-3.5">
          <span className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            danger ? 'bg-red-100 text-red-600' : 'bg-teal-100 text-teal-700'}`}>
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              {danger
                ? <path d="M10 6.5v4.5M10 14h.01M8.6 3.2L1.9 15a1.6 1.6 0 001.4 2.4h13.4a1.6 1.6 0 001.4-2.4L11.4 3.2a1.6 1.6 0 00-2.8 0z" strokeLinecap="round" strokeLinejoin="round" />
                : <path d="M10 9v5M10 6h.01M10 18a8 8 0 100-16 8 8 0 000 16z" strokeLinecap="round" />}
            </svg>
          </span>
          <div className="min-w-0 pt-0.5">
            <p id="fb-confirm-title" className="text-base font-bold text-gray-900">{opts.title}</p>
            {opts.message && <p id="fb-confirm-msg" className="text-sm text-gray-500 mt-1 leading-relaxed">{opts.message}</p>}
          </div>
        </div>
        <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
          <button ref={cancelRef} onClick={() => onAnswer(false)}
            className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300">
            {opts.cancelLabel || 'Cancel'}
          </button>
          <button ref={okRef} onClick={() => onAnswer(true)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
              danger ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-400' : 'bg-teal-600 hover:bg-teal-700 focus-visible:ring-teal-400'}`}>
            {opts.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [confirmState, setConfirmState] = useState(null)   // { opts, resolve }
  const timers = useRef(new Map())
  const nextId = useRef(0)

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((kind, title, message) => {
    const id = ++nextId.current
    setToasts((list) => [...list, { id, kind, title, message }].slice(-MAX_TOASTS))
    timers.current.set(id, setTimeout(() => dismiss(id), TOAST_MS))
    return id
  }, [dismiss])

  useEffect(() => {
    const all = timers.current
    return () => { for (const t of all.values()) clearTimeout(t) }
  }, [])

  const toast = useMemo(() => ({
    success: (title, message) => push('success', title, message),
    error:   (title, message) => push('error', title, message),
    info:    (title, message) => push('info', title, message),
  }), [push])

  // One dialog at a time: a second ask while one is open answers the first "no".
  const confirm = useCallback((opts) => new Promise((resolve) => {
    setConfirmState((cur) => { cur?.resolve(false); return { opts, resolve } })
  }), [])

  const answer = useCallback((ok) => {
    setConfirmState((cur) => { cur?.resolve(ok); return null })
  }, [])

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div aria-live="polite"
        className="fixed z-[80] top-3 sm:top-4 inset-x-0 px-3 flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => <Toast key={t.id} toast={t} onDismiss={dismiss} />)}
      </div>
      {confirmState && <ConfirmDialog opts={confirmState.opts} onAnswer={answer} />}
    </FeedbackContext.Provider>
  )
}
