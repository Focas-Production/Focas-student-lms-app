// FOCAS Hall session types — announcements, inductions, faculty sessions. Every
// classroom session is "class". Keys mirror server/config/liveRooms.js
// (HALL_SESSION_TYPES); the topology endpoint also returns them for forms.
export const SESSION_TYPE_LABELS = {
  announcement: 'Announcement',
  induction:    'Induction',
  faculty:      'Faculty',
  mentorship:   'Mentorship',
  other:        'Hall session',
}

/** Is this a FOCAS Hall session rather than a chapter class? */
export const isHallSession = (c) => !!c?.sessionType && c.sessionType !== 'class'

/** "Announcement" etc., or '' for a normal class. */
export const sessionTypeLabel = (c) =>
  isHallSession(c) ? (SESSION_TYPE_LABELS[c.sessionType] || 'Hall session') : ''
