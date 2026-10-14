import { createContext, useContext } from 'react'

// Context + hooks for components/Feedback.jsx (kept apart so that file only
// exports components — Vite fast refresh needs that).
export const FeedbackContext = createContext(null)

const fallbackToast = {
  success: (t, m) => console.info('[toast]', t, m || ''),
  error:   (t, m) => console.error('[toast]', t, m || ''),
  info:    (t, m) => console.info('[toast]', t, m || ''),
}

export function useToast() {
  return useContext(FeedbackContext)?.toast || fallbackToast
}

export function useConfirm() {
  const ctx = useContext(FeedbackContext)
  return ctx?.confirm || ((opts) => Promise.resolve(window.confirm([opts.title, opts.message].filter(Boolean).join('\n\n'))))
}
