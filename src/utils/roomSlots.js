// A mentor hosts a ROOM, not a track: they Start once and hop between the
// room's tracks from inside (the in-room switcher starts the other track's
// booking on the way in). So wherever the mentor portal lists classes, the
// tracks of one room that run at the same time collapse into a single "room
// slot" with one Start / Enter button. Students are allotted to one track and
// join that class directly, so their lists never group.
//
// A slot carries the same display fields as a class (title, status,
// scheduledStart, roomLabel …) so cards and the calendar render either shape
// without caring, plus:
//   classes  the per-track classes, in track order (a lone class → [itself])
//   isGroup  true when there is more than one track
//
// Works on both class shapes in the app: the raw list documents
// ({ room: { key, label }, track: {…}, chapter: {…} }) and the flat calendar
// feed ({ roomKey, roomLabel, trackKey, trackLabel, chapterName }).

export const roomKeyOf     = (c) => c.roomKey || c.room?.key || ''
export const roomLabelOf   = (c) => c.roomLabel || c.room?.label || ''
export const trackKeyOf    = (c) => c.trackKey || c.track?.key || ''
export const trackLabelOf  = (c) => c.trackLabel || c.track?.label || ''
const hostNameOf    = (c) => c.hostName || c.host?.name || ''
const subjectNameOf = (c) => c.subjectName || c.subject?.name || ''
const chapterNameOf = (c) => c.chapterName || c.chapter?.name || ''
const unitNameOf    = (c) => c.unitName || c.unit?.name || ''

// "Track 1" before "Track 2" before "Track 10".
export const trackOrder = (a, b) =>
  trackLabelOf(a).localeCompare(trackLabelOf(b), undefined, { numeric: true })
    || trackKeyOf(a).localeCompare(trackKeyOf(b), undefined, { numeric: true })

const byStart = (a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart) || trackOrder(a, b)

// A room is live if any track is, upcoming if any track still is, and so on.
const RANK = { live: 0, scheduled: 1, ended: 2, cancelled: 3 }
const aggregateStatus = (classes) =>
  classes.reduce((best, c) => ((RANK[c.status] ?? 9) < (RANK[best] ?? 9) ? c.status : best), 'cancelled')

// Admin titles are "Room 1 · Track 1 — Morning Slot 2": the part after the dash
// is the period both tracks share. Anything else falls back to a plain count.
function slotTitle(roomLabel, classes) {
  const suffixes = classes.map((c) => {
    const i = (c.title || '').lastIndexOf(' — ')
    return i > -1 ? c.title.slice(i + 3).trim() : ''
  })
  const shared = suffixes[0] && suffixes.every((s) => s === suffixes[0]) ? suffixes[0] : ''
  return shared ? `${roomLabel} — ${shared}` : `${roomLabel} · ${classes.length} tracks`
}

export const singleSlot = (c) => ({ ...c, classes: [c], isGroup: false })

function groupSlot(classes) {
  const sorted = [...classes].sort(trackOrder)
  const first = sorted[0]
  const roomLabel = roomLabelOf(first)
  // A field is shown at room level only when every track agrees on it.
  const shared = (get) => { const v = get(first); return sorted.every((c) => get(c) === v) ? v : '' }
  const starts = sorted.map((c) => new Date(c.scheduledStart).getTime())
  const ends = sorted.map((c) => new Date(c.scheduledEnd).getTime())
  const startedAts = sorted.map((c) => c.startedAt).filter(Boolean).sort()
  const endedAts = sorted.map((c) => c.endedAt).filter(Boolean).sort()
  return {
    _id: `slot:${roomKeyOf(first)}:${sorted.map((c) => c._id).join('+')}`,
    isGroup: true,
    classes: sorted,
    title: slotTitle(roomLabel, sorted),
    description: '',
    status: aggregateStatus(sorted),
    scheduledStart: new Date(Math.min(...starts)).toISOString(),
    scheduledEnd: new Date(Math.max(...ends)).toISOString(),
    startedAt: startedAts[0] || null,
    endedAt: endedAts[endedAts.length - 1] || null,
    hostName: shared(hostNameOf),
    roomKey: roomKeyOf(first),
    roomLabel,
    trackKey: '',
    trackLabel: `${sorted.length} tracks`,   // reads as "Room 1 · 2 tracks" wherever room · track is shown
    subjectName: shared(subjectNameOf),
    chapterName: shared(chapterNameOf),
    unitName: shared(unitNameOf),
    submissionOpen: sorted.some((c) => c.submissionOpen),
  }
}

// Collapse `classes` into room slots. Within one room, classes whose times
// overlap form a slot — but never two classes on the same track, so a chain of
// back-to-back bookings (Track 1 6–9, Track 2 8–11, Track 1 9–12) still splits
// where a track repeats. Cancelled classes and classes without a room stay on
// their own. The result keeps the caller's order (the list is attention-first
// from the server, and must stay that way); the calendar re-sorts by time.
export function groupRoomSlots(classes, group = true) {
  if (!group) return classes.map(singleSlot)

  const position = new Map(classes.map((c, i) => [c._id, i]))
  const byRoom = new Map()
  const slots = []
  for (const c of classes) {
    const rk = roomKeyOf(c)
    if (!rk || c.status === 'cancelled') { slots.push(singleSlot(c)); continue }
    if (!byRoom.has(rk)) byRoom.set(rk, [])
    byRoom.get(rk).push(c)
  }

  for (const list of byRoom.values()) {
    list.sort(byStart)
    let current = null, currentEnd = 0, tracks = new Set()
    const flush = () => {
      if (current) slots.push(current.length > 1 ? groupSlot(current) : singleSlot(current[0]))
    }
    for (const c of list) {
      const start = new Date(c.scheduledStart).getTime()
      const end = new Date(c.scheduledEnd).getTime()
      const tk = trackKeyOf(c) || trackLabelOf(c)
      if (current && start < currentEnd && !tracks.has(tk)) {
        current.push(c); tracks.add(tk); currentEnd = Math.max(currentEnd, end)
      } else {
        flush(); current = [c]; tracks = new Set([tk]); currentEnd = end
      }
    }
    flush()
  }

  const firstPosition = (s) => Math.min(...s.classes.map((c) => position.get(c._id) ?? Infinity))
  return slots.sort((a, b) => firstPosition(a) - firstPosition(b))
}

// The class a slot's one button acts on: the class we're already hosting, else
// a live track (lowest first), else the earliest scheduled one — Track 1 for a
// fresh slot. The mentor reaches the other track from inside the room.
export function slotPrimaryClass(slot, sessionClassId) {
  const cs = slot.classes
  return (sessionClassId && cs.find((c) => c._id === sessionClassId))
    || cs.find((c) => c.status === 'live')
    || cs.filter((c) => c.status === 'scheduled').sort(byStart)[0]
    || null
}
