// Helpers for the "How was your class?" dialog (components/ClassFeedbackDialog.jsx),
// kept out of the component file so fast refresh keeps working.
import { apiFetch } from '../api'

// Classes we've already popped the dialog for on this device, so closing it
// with × never makes it jump straight back up. Best-effort: storage can throw.
const ASKED_KEY = 'classFeedbackAsked'
export function wasAsked(classId) {
  try { return (JSON.parse(localStorage.getItem(ASKED_KEY) || '[]')).includes(String(classId)) } catch { return false }
}
export function markAsked(classId) {
  try {
    const list = JSON.parse(localStorage.getItem(ASKED_KEY) || '[]').filter((id) => id !== String(classId))
    list.push(String(classId))
    localStorage.setItem(ASKED_KEY, JSON.stringify(list.slice(-50)))
  } catch { /* nothing to remember with */ }
}

// The class to ask about once this student is out of it, or null: only when it
// has ended, they may answer it, and they haven't yet (a skip counts).
export async function feedbackPromptFor(classId) {
  if (!classId) return null
  try {
    const d = await apiFetch(`/api/live-classes/${classId}/feedback`)
    return d.canGive && !d.feedback ? d.class : null
  } catch {
    return null
  }
}
