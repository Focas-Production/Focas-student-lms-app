// Which review outcomes ("redo your work" / "your work was reviewed") this
// device has already shown the student, so a notice pops up once — not on
// every room join or page poll. Keyed by class + the outcome's timestamp: a
// mentor sending the work back a SECOND time has a new timestamp, so it shows
// again.
//
// localStorage, best-effort: private mode or a full quota just means the
// notice may show again, never that it's lost.

const PREFIX = 'focas:work-review-seen:'
const MAX_KEYS = 200

const keyOf = (classId, at) => `${PREFIX}${classId}:${at ? new Date(at).getTime() : 0}`

export function wasReviewSeen(classId, at) {
  try { return localStorage.getItem(keyOf(classId, at)) === '1' } catch { return false }
}

// Fired on window whenever an outcome is marked seen, so another surface in the
// same tab (the Tutor Session page under a minimized room) drops its banner now
// instead of on its next poll. detail = { classId, at }.
export const REVIEW_SEEN_EVENT = 'focas:work-review-seen'

export function markReviewSeen(classId, at) {
  try { window.dispatchEvent(new CustomEvent(REVIEW_SEEN_EVENT, { detail: { classId: String(classId), at } })) } catch { /* ignore */ }
  try {
    localStorage.setItem(keyOf(classId, at), '1')
    // Keep the store bounded — one key per outcome adds up over a year.
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))
    if (keys.length > MAX_KEYS) keys.slice(0, keys.length - MAX_KEYS).forEach((k) => localStorage.removeItem(k))
  } catch { /* ignore */ }
}
