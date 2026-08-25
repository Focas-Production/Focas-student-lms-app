import { useState, Fragment } from 'react'

const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—')
const fmtExact = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—')
function fmtDur(ms) {
  if (!ms || ms < 0) return '0m'
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csvRow = (arr) => arr.map(csvCell).join(',')
const dt = (d) => (d ? new Date(d).toLocaleString() : '')
const mins = (ms) => Math.round((ms || 0) / 60000)

// How long the class actually ran: host start → end (or → now if still live).
function meetingMs(classInfo) {
  if (!classInfo?.startedAt) return null
  const end = classInfo.endedAt ? new Date(classInfo.endedAt).getTime()
    : classInfo.status === 'live' ? Date.now() : null
  if (!end) return null
  return end - new Date(classInfo.startedAt).getTime()
}

function exportCsv(title, roster, classInfo, items) {
  const lines = []
  const runMs = meetingMs(classInfo)
  // One completion column per item the class taught (booked chapter/unit plus
  // any extras the host marked as also finished).
  const itemCols = items?.length ? items.map((it) => `${it.label} completed`) : ['Chapter Completed']
  const itemCells = (p) => items?.length
    ? items.map((it, i) => (p.record.items?.[i]?.completed ?? (i === 0 && p.record.chapterCompleted)) ? 'Yes' : 'No')
    : [p.record.chapterCompleted ? 'Yes' : 'No']
  const anyManual = (p) => p.record.presentSource === 'manual' || p.record.chapterSource === 'manual'
    || (p.record.items || []).some((x) => x?.source === 'manual')

  // Class header
  lines.push(csvRow(['Class', title || '']))
  lines.push(csvRow(['Exported', new Date().toLocaleString()]))
  if (classInfo?.startedAt) lines.push(csvRow(['Started', dt(classInfo.startedAt)]))
  if (classInfo?.endedAt) lines.push(csvRow(['Ended', dt(classInfo.endedAt)]))
  if (runMs != null) lines.push(csvRow(['Class duration', mins(runMs), fmtDur(runMs)]))
  lines.push(csvRow(['Participants', roster.length]))
  lines.push('')

  // Per-person summary. Present / chapter verdict columns appear once the class
  // has ended and the server has attached per-student records.
  const hasRecords = roster.some((p) => p.record)
  lines.push(csvRow(['SUMMARY']))
  lines.push(csvRow([
    'Name', 'Role', 'Times Joined', 'First Join', 'Last Leave', 'Total Time (min)', 'Total Time', 'Currently In Class',
    ...(hasRecords ? ['Attended %', 'Present', ...itemCols, 'Marked'] : []),
  ]))
  for (const p of roster) {
    lines.push(csvRow([
      p.name || 'Unknown',
      p.role,
      p.sessionCount,
      dt(p.firstJoin),
      p.live ? 'still in class' : dt(p.lastLeave),
      mins(p.totalMs),
      fmtDur(p.totalMs),
      p.live ? 'Yes' : 'No',
      ...(hasRecords ? (p.record ? [
        `${p.record.percent}%`,
        p.record.present ? 'Present' : 'Absent',
        ...itemCells(p),
        anyManual(p) ? `edited by ${p.record.markedByName || 'mentor'}` : 'auto',
      ] : Array(3 + itemCols.length).fill('')) : []),
    ]))
  }
  lines.push('')

  // Every join/leave session
  lines.push(csvRow(['SESSION DETAIL']))
  lines.push(csvRow(['Name', 'Role', 'Session', 'Joined', 'Left', 'Duration (min)', 'Duration']))
  for (const p of roster) {
    (p.sessions || []).forEach((s, i) => {
      lines.push(csvRow([
        p.name || 'Unknown',
        p.role,
        i + 1,
        dt(s.joinedAt),
        s.live ? 'still in class' : dt(s.leftAt),
        mins(s.durationMs),
        fmtDur(s.durationMs),
      ]))
    })
  }
  lines.push('')

  // Class totals
  const students = roster.filter((p) => p.role === 'student')
  const hosts = roster.filter((p) => p.role === 'host')
  const totalJoins = roster.reduce((s, p) => s + (p.sessionCount || 0), 0)
  const currentlyIn = roster.filter((p) => p.live).length
  const avgStudentMs = students.length ? students.reduce((s, p) => s + (p.totalMs || 0), 0) / students.length : 0
  const longest = roster.reduce((m, p) => Math.max(m, p.totalMs || 0), 0)

  lines.push(csvRow(['CLASS TOTALS']))
  if (runMs != null) lines.push(csvRow(['Class duration (min)', mins(runMs), fmtDur(runMs)]))
  lines.push(csvRow(['Total participants', roster.length]))
  lines.push(csvRow(['Hosts', hosts.length]))
  lines.push(csvRow(['Students', students.length]))
  lines.push(csvRow(['Total joins (all sessions)', totalJoins]))
  lines.push(csvRow(['Currently in class', currentlyIn]))
  lines.push(csvRow(['Average student time (min)', mins(avgStudentMs), fmtDur(avgStudentMs)]))
  lines.push(csvRow(['Longest attendance (min)', mins(longest), fmtDur(longest)]))

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `attendance-${(title || 'class').replace(/[^\w-]+/g, '_')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// roster: null = loading; [] = empty; else array of participant summaries with sessions[].
// After a class ends the server attaches p.record (present / chapterCompleted verdicts);
// pass onToggleRecord(userId, patch) to let the viewer override them.
export default function AttendanceModal({ title, roster, classInfo, meta, onToggleRecord, onClose, accent = 'teal' }) {
  const [expanded, setExpanded] = useState(null)
  const [saving, setSaving] = useState(null)   // `${userId}:${field}` while a toggle is in flight
  const badgeHost = accent === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-teal-100 text-teal-700'
  const runMs = meetingMs(classInfo)

  const hasRecords = !!roster?.some((p) => p.record)
  const chapterLabel = meta?.unitName || meta?.chapterName || ''
  // Everything the class taught — the booked chapter/unit plus extras the host
  // marked as also finished. Older servers only send the flat single-chapter
  // meta fields; fold those into the same list shape.
  const metaItems = meta?.items?.length ? meta.items
    : chapterLabel ? [{
        chapterId: null, unitId: null,
        chapterName: meta?.chapterName || '', unitName: meta?.unitName || '',
        label: chapterLabel, itemCompleted: !!meta?.itemCompleted,
      }]
    : []
  // Every taught item gets a column (hiding the scheduled chapter while extras
  // showed was just confusing). Cells stay locked until the mentor marks the
  // item done in syllabus progress — before that there's nothing to edit. `i`
  // keeps each item's index in the full list, which record.items aligns with.
  const shownItems = hasRecords ? metaItems.map((it, i) => ({ ...it, i })) : []
  const cols = 5 + (hasRecords ? 2 : 0) + shownItems.length

  // A student's verdict for one taught item (falls back to the flat fields a
  // pre-items server/record used for the booked item).
  const itemState = (p, it) => p.record?.items?.[it.i]
    || (it.i === 0
      ? { completed: !!p.record?.chapterCompleted, source: p.record?.chapterSource || 'auto' }
      : { completed: false, source: 'auto' })

  const togglePresent = async (p) => {
    if (!onToggleRecord || !p.userId || saving) return
    const key = `${p.userId}:present`
    setSaving(key)
    try {
      await onToggleRecord(p.userId, { present: !p.record.present })
    } finally { setSaving(null) }
  }

  const toggleItem = async (p, it) => {
    if (!onToggleRecord || !p.userId || saving || !it.itemCompleted) return
    const key = `${p.userId}:item${it.i}`
    setSaving(key)
    try {
      await onToggleRecord(p.userId, {
        chapterCompleted: !itemState(p, it).completed,
        // Old servers know only the booked item and take no ids.
        ...(it.chapterId ? { chapterId: it.chapterId, unitId: it.unitId || undefined } : {}),
      })
    } finally { setSaving(null) }
  }

  // Class-wide rollups for the footer.
  const stats = (roster && roster.length) ? (() => {
    const students = roster.filter((p) => p.role === 'student')
    return {
      participants: roster.length,
      students: students.length,
      totalJoins: roster.reduce((s, p) => s + (p.sessionCount || 0), 0),
      currentlyIn: roster.filter((p) => p.live).length,
      totalTimeMs: roster.reduce((s, p) => s + (p.totalMs || 0), 0),
      avgStudentMs: students.length ? students.reduce((s, p) => s + (p.totalMs || 0), 0) / students.length : 0,
      presentCount: students.filter((p) => p.record?.present).length,
    }
  })() : null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${shownItems.length > 1 ? 'max-w-4xl' : hasRecords ? 'max-w-3xl' : 'max-w-2xl'} max-h-[85vh] flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900">Attendance</p>
            <p className="text-xs text-gray-400 truncate">
              {title}
              {runMs != null && <span className="ml-2 text-gray-500">· ran {fmtDur(runMs)}{classInfo?.status === 'live' ? ' so far' : ''}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {roster?.length > 0 && (
              <button onClick={() => exportCsv(title, roster, classInfo, metaItems)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                Export CSV
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto">
          {roster === null ? (
            <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
          ) : !roster.length ? (
            <p className="text-sm text-gray-400 text-center py-6">No one has joined this class yet.</p>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-3">{roster.length} participant{roster.length > 1 ? 's' : ''} · tap a row for join/leave detail</p>
              <table className="w-full text-sm">
                <thead className="text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="text-left pb-2 font-semibold">Name</th>
                    <th className="text-center pb-2 font-semibold">Joins</th>
                    <th className="text-left pb-2 font-semibold">First join</th>
                    <th className="text-left pb-2 font-semibold">Last leave</th>
                    <th className="text-right pb-2 font-semibold">Total</th>
                    {hasRecords && <th className="text-center pb-2 font-semibold">%</th>}
                    {hasRecords && <th className="text-center pb-2 font-semibold">Present</th>}
                    {shownItems.map((it) => (
                      <th key={it.i} className="text-center pb-2 font-semibold max-w-[110px] truncate normal-case"
                        title={it.unitName ? `${it.chapterName} · ${it.unitName}` : it.chapterName}>
                        {it.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {roster.map((p, idx) => {
                    const open = expanded === idx
                    return (
                      <Fragment key={idx}>
                        <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setExpanded(open ? null : idx)}>
                          <td className="py-2.5">
                            <span className="text-gray-400 mr-1">{open ? '▾' : '▸'}</span>
                            <span className="text-gray-900">{p.name || 'Unknown'}</span>
                            {p.role === 'host' && <span className={`ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${badgeHost}`}>Host</span>}
                            {p.live && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 uppercase">In class</span>}
                          </td>
                          <td className="py-2.5 text-center text-gray-700">{p.sessionCount}</td>
                          <td className="py-2.5 text-gray-500">{fmtTime(p.firstJoin)}</td>
                          <td className="py-2.5 text-gray-500">{p.live ? '—' : fmtTime(p.lastLeave)}</td>
                          <td className="py-2.5 text-right text-gray-900 font-medium">{fmtDur(p.totalMs)}</td>
                          {hasRecords && (
                            <td className="py-2.5 text-center text-gray-500">
                              {p.record ? `${p.record.percent}%` : '—'}
                            </td>
                          )}
                          {hasRecords && (
                            <td className="py-2.5 text-center">
                              {p.record ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); togglePresent(p) }}
                                  disabled={!onToggleRecord || saving === `${p.userId}:present`}
                                  title={`${p.record.presentSource === 'manual' ? `Edited by ${p.record.markedByName || 'mentor'}` : 'Auto-marked'}${onToggleRecord ? ' · click to change' : ''}`}
                                  className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase transition disabled:opacity-50 ${
                                    p.record.present ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-red-100 text-red-700 hover:bg-red-200'
                                  } ${onToggleRecord ? 'cursor-pointer' : 'cursor-default'}`}>
                                  {p.record.present ? 'Present' : 'Absent'}
                                  {p.record.presentSource === 'manual' && <span className="ml-0.5 opacity-60">✎</span>}
                                </button>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                          )}
                          {shownItems.map((it) => {
                            const st = p.record ? itemState(p, it) : null
                            const editable = !!onToggleRecord && it.itemCompleted
                            return (
                              <td key={it.i} className="py-2.5 text-center">
                                {st ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleItem(p, it) }}
                                    disabled={!editable || saving === `${p.userId}:item${it.i}`}
                                    title={!it.itemCompleted
                                      ? `"${it.label}" isn't marked completed in syllabus progress yet — use the class card's mark-done or ＋ More button first, then students who attended complete it automatically`
                                      : `${it.label} · ${st.source === 'manual' ? `edited by ${p.record.markedByName || 'mentor'}` : 'auto: completes when the item is marked done in syllabus progress AND attendance across its sessions meets the threshold'}${editable ? ' · click to change' : ''}`}
                                    className={`text-[10px] font-bold px-2 py-1 rounded-md transition ${
                                      !it.itemCompleted ? 'bg-gray-50 text-gray-300'
                                      : st.completed ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50'
                                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50'
                                    } ${editable ? 'cursor-pointer' : 'cursor-default'}`}>
                                    {st.completed ? '✓ Done' : 'Not done'}
                                    {st.source === 'manual' && <span className="ml-0.5 opacity-60">✎</span>}
                                  </button>
                                ) : <span className="text-gray-300">—</span>}
                              </td>
                            )
                          })}
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={cols} className="pb-3 pl-6">
                              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                                {!(p.sessions || []).length && (
                                  <p className="text-xs text-gray-400">Never joined this class.</p>
                                )}
                                {(p.sessions || []).map((s, si) => (
                                  <div key={si} className="flex items-center justify-between text-xs">
                                    <span className="text-gray-400">Session {si + 1}</span>
                                    <span className="text-gray-700">
                                      {fmtExact(s.joinedAt)} <span className="text-gray-400">→</span> {s.live ? <span className="text-red-600 font-medium">still in class</span> : fmtExact(s.leftAt)}
                                    </span>
                                    <span className="text-gray-900 font-medium">{fmtDur(s.durationMs)}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        {stats && (
          <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-x-6 gap-y-1.5 text-xs bg-gray-50 rounded-b-2xl">
            {runMs != null && <span className="text-gray-500">Class duration <b className="text-gray-900">{fmtDur(runMs)}</b></span>}
            <span className="text-gray-500">Participants <b className="text-gray-900">{stats.participants}</b></span>
            <span className="text-gray-500">Students <b className="text-gray-900">{stats.students}</b></span>
            {hasRecords && (
              <span className="text-gray-500">
                Present <b className="text-emerald-700">{stats.presentCount}/{stats.students}</b>
                {meta?.thresholdPercent != null && <span className="text-gray-400"> (≥{meta.thresholdPercent}% of class)</span>}
              </span>
            )}
            <span className="text-gray-500">Total joins <b className="text-gray-900">{stats.totalJoins}</b></span>
            {stats.currentlyIn > 0 && <span className="text-gray-500">In class now <b className="text-red-600">{stats.currentlyIn}</b></span>}
            <span className="text-gray-500">Avg student time <b className="text-gray-900">{fmtDur(stats.avgStudentMs)}</b></span>
          </div>
        )}
      </div>
    </div>
  )
}
