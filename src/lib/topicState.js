// Where a syllabus topic stands, in plain words. The server puts every topic on
// a ladder (not-allotted → allotted → attended → completed) that reads as jargon,
// so each topic is shown as ONE of these states instead — and every count, chip
// and badge on a progress view uses them, so the numbers always agree.
// The admin panel (admin-lms StudentProgressPage) carries the same rules.

const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

export const TOPIC_STATES = [
  { key: 'done',      label: 'Done',               tone: 'emerald', help: 'Mentor finished the topic and attendance was enough' },
  { key: 'attending', label: 'Attended, not done', tone: 'amber',   help: 'Came to class, but the topic is not finished yet' },
  { key: 'missed',    label: 'Never attended',     tone: 'rose',    help: 'Classes were given for this topic but none of them were attended' },
  { key: 'upcoming',  label: 'Class booked',       tone: 'indigo',  help: 'The next class for this topic is scheduled or running now' },
  { key: 'no-class',  label: 'No class yet',       tone: 'gray',    help: 'No class has been given or booked for this topic yet' },
]
export const STATE_META = Object.fromEntries(TOPIC_STATES.map((s) => [s.key, s]))

export function topicState(row) {
  if (row.completed) return 'done'
  if (row.status === 'attended') return 'attending'
  if (row.status === 'allotted') return row.pendingKind === 'upcoming' || row.pendingKind === 'live' ? 'upcoming' : 'missed'
  return 'no-class'
}

export function countStates(rows) {
  const counts = Object.fromEntries(TOPIC_STATES.map((s) => [s.key, 0]))
  for (const r of rows) counts[topicState(r)] += 1
  return counts
}

const classes = (n) => `${n} class${n === 1 ? '' : 'es'}`

// One plain sentence saying where the topic stands and why: { text, why?, tone? }.
// `you` words it for the student reading their own page; otherwise it is about
// "the student", for a mentor or admin.
export function describeTopic(row, { threshold, you = false } = {}) {
  const n = row.sessions || 0
  const came = row.attendedSessions || 0
  const bar = threshold != null ? `${threshold}%` : 'enough'
  const by = row.markedByName || (you ? 'your mentor' : 'admin')
  const attendedLine = you
    ? `You came to ${came} of ${classes(n)} · in class ${row.percent}% of the time`
    : `Came to ${came} of ${classes(n)} · in class ${row.percent}% of the time`

  switch (topicState(row)) {
    case 'done':
      if (row.source === 'manual' || (!n && row.manualMark === 'completed')) return { text: `Marked done by ${by}` }
      if (row.source === 'chapter') return { text: 'Covered in a full-chapter class' }
      return { text: attendedLine }

    case 'attending':
      if (row.reason === 'teaching') {
        return { text: attendedLine, why: you ? 'your mentor is still teaching this topic' : 'mentor has not finished teaching this topic yet', tone: 'amber' }
      }
      return { text: attendedLine, why: you ? `you need ${bar} to finish it` : `needs ${bar} to count as done`, tone: 'rose' }

    case 'upcoming':
      if (row.pendingKind === 'live') {
        if (row.joinedLive) return { text: 'Class is live now', why: you ? "you're in it" : 'student is in it', tone: 'emerald' }
        return { text: 'Class is live now', why: you ? 'join from Live classes' : 'student has not joined', tone: 'rose' }
      }
      return {
        text: row.nextClassAt ? `Next class ${fmtDay(row.nextClassAt)}, ${fmtTime(row.nextClassAt)}` : 'Class booked',
        why: n ? `${you ? 'you missed' : 'missed'} ${n === 1 ? 'the earlier class' : `${n} earlier classes`}` : '',
        tone: 'rose',
      }

    case 'missed': {
      if (!n && row.manualMark === 'absent') return { text: `Marked absent by ${by}` }
      const missed = n || row.missedSessions || 0
      const who = you ? 'You missed' : 'Did not attend'
      const text = missed === 1 ? `${who} the class` : missed ? `${who} ${you ? 'all' : 'any of the'} ${missed} classes` : who
      // Joined but left too early to be counted present.
      const why = row.percent > 0 ? `${you ? 'you were' : 'was'} in class only ${row.percent}% of the time (needs ${bar})` : ''
      return { text, why, tone: 'rose' }
    }

    default:
      return { text: you ? 'No class booked for you yet' : 'No class given or booked for this student yet' }
  }
}
