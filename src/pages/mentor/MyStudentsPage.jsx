// A mentor's students — the roster of every class they have hosted, and how far
// each student has got with the chapters they were taught.
//
// Deliberately narrow. A mentor sees their own teaching: their subjects, their
// sessions, chapters completed vs still open. Not the student's whole course,
// their purchases or their test history — that is the admin's view. The server
// enforces the same boundary, so this page can only ask for what it may show.
import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../../api'
import { enrollmentLabel } from '../../lib/ca'

const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—')

function fmtMs(ms) {
  const sec = Math.round((ms || 0) / 1000)
  if (!sec) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m || 1}m`
}

// The list is a chapter-level view, so its bar is chapter-level too — showing a
// topic percentage next to "1/3 chapters taught" reads as a contradiction.
const chapterPct = (s) => (s.chapters > 0 ? Math.round((s.chaptersDone / s.chapters) * 100) : 0)

function toneFor(p) {
  if (p == null) return 'gray'
  if (p >= 75) return 'emerald'
  if (p >= 50) return 'amber'
  return 'rose'
}
const BAR  = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', gray: 'bg-gray-300', teal: 'bg-teal-500' }
const TEXT = { emerald: 'text-emerald-600', amber: 'text-amber-600', rose: 'text-rose-500', gray: 'text-gray-400', teal: 'text-teal-600' }
const SOFT = {
  emerald: 'bg-emerald-100 text-emerald-700', amber: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-600', gray: 'bg-gray-100 text-gray-500', teal: 'bg-teal-100 text-teal-700',
}

function useResource(url) {
  const [state, setState] = useState({ key: null, data: null, error: '' })

  useEffect(() => {
    let alive = true
    apiFetch(url)
      .then(d => alive && setState({ key: url, data: d, error: '' }))
      .catch(e => alive && setState(prev => ({ key: url, data: prev.data, error: e.message || 'Failed to load' })))
    return () => { alive = false }
  }, [url])

  const settled = state.key === url
  return { data: state.data, error: settled ? state.error : '', loading: !settled }
}

const Bar = ({ percent, tone = 'emerald', className = '' }) => (
  <div className={`h-1.5 bg-gray-100 rounded-full overflow-hidden ${className}`}>
    <div className={`h-full rounded-full transition-all ${BAR[tone]}`} style={{ width: `${Math.max(0, Math.min(100, percent || 0))}%` }} />
  </div>
)

const Badge = ({ tone = 'gray', children, title }) => (
  <span title={title} className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wide whitespace-nowrap ${SOFT[tone]}`}>{children}</span>
)

const Empty = ({ title, hint }) => (
  <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
    <p className="text-gray-700 font-semibold mb-1 text-sm">{title}</p>
    {hint && <p className="text-gray-400 text-sm leading-relaxed">{hint}</p>}
  </div>
)

function Chip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap flex-shrink-0 transition-colors ${
        active ? 'bg-teal-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
      {children}
    </button>
  )
}

// ───────────────────────────── student detail ─────────────────────────────

function TopicRow({ row }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2 bg-gray-50 rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 break-words">{row.unitName || row.chapterName}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {row.sessions
            ? `${row.sessions} session${row.sessions !== 1 ? 's' : ''} · attended ${row.percent}%`
            : 'Not taught yet'}
          {!row.completed && row.reason === 'teaching' && <span className="text-amber-600"> · still teaching</span>}
          {!row.completed && row.reason === 'attendance' && <span className="text-rose-500"> · attendance short</span>}
        </p>
      </div>
      <Badge tone={row.completed ? 'emerald' : 'gray'}
        title={row.source === 'manual' ? `Marked by ${row.markedByName || 'a mentor'}` : 'Auto-computed from attendance'}>
        {row.completed ? '✓ Done' : 'Not done'}{row.source === 'manual' && <span className="ml-0.5 opacity-60">✎</span>}
      </Badge>
    </div>
  )
}

function SubjectBlock({ subject, filter }) {
  const [open, setOpen] = useState(true)

  const chapters = subject.chapters
    .map(ch => ({
      ...ch,
      rows: ch.rows.filter(r => filter === 'all' || (filter === 'done' ? r.completed : !r.completed)),
    }))
    .filter(ch => ch.rows.length)

  if (!chapters.length) return null

  const tone = subject.status === 'completed' ? 'emerald' : toneFor(subject.percent)

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
        <span className="text-gray-300 text-xs w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 break-words">{subject.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <Bar percent={subject.percent} tone={tone} className="flex-1 max-w-[180px]" />
            <span className={`text-[11px] font-semibold flex-shrink-0 ${TEXT[tone]}`}>{subject.percent}%</span>
            <span className="text-[11px] text-gray-400 flex-shrink-0">
              {subject.completedChapters}/{subject.totalChapters} chapters
            </span>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {chapters.map(ch => {
            const single = ch.rows.length === 1 && !ch.rows[0].unitName
            return (
              <div key={ch.chapterId}>
                {!single && (
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex-1 min-w-0 truncate">{ch.name}</p>
                    <Badge tone={ch.completed ? 'emerald' : 'gray'}>{ch.done}/{ch.total}</Badge>
                  </div>
                )}
                <div className="space-y-1.5">
                  {ch.rows.map(r => <TopicRow key={`${r.chapterId}:${r.unitId || ''}`} row={r} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const ATT_BADGE = { present: ['emerald', 'Present'], late: ['amber', 'Late'], absent: ['rose', 'Absent'] }

function AttendanceList({ studentId }) {
  const [page, setPage] = useState(1)
  const { data, error, loading } = useResource(`/api/mentor/students/${studentId}/attendance-log?page=${page}&limit=10`)

  if (error) return <p className="text-xs text-rose-500 py-3">{error}</p>
  if (loading && !data) return <p className="text-xs text-gray-400 py-3">Loading classes…</p>
  if (!data?.rows.length) return <p className="text-xs text-gray-400 py-3">No finished classes yet.</p>

  return (
    <div className="space-y-1.5">
      {data.rows.map(r => {
        const [tone, label] = ATT_BADGE[r.status] || ATT_BADGE.absent
        return (
          <div key={r._id} className="flex items-start gap-3 px-3 py-2 bg-gray-50 rounded-lg">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-900 break-words">
                {[r.chapter?.name, r.unit?.name].filter(Boolean).join(' · ') || r.title}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {fmtDay(r.classDate)} · {fmtTime(r.classDate)} · {fmtMs(r.attendedMs)} of {fmtMs(r.classDurationMs)} ({r.percent}%)
              </p>
            </div>
            <Badge tone={tone}>{label}</Badge>
          </div>
        )
      })}
      {data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-gray-400">Page {page} of {data.pagination.totalPages} · {data.pagination.total} classes</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 bg-white">Prev</button>
            <button onClick={() => setPage(p => Math.min(data.pagination.totalPages, p + 1))} disabled={page === data.pagination.totalPages}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 bg-white">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}

const DETAIL_TABS = [
  { key: 'pending', label: 'Not done' },
  { key: 'done',    label: 'Completed' },
  { key: 'all',     label: 'All chapters' },
  { key: 'classes', label: 'Class attendance' },
]

function StudentPanel({ student, onClose }) {
  const { data: report, error, loading } = useResource(`/api/mentor/students/${student.id}/report`)
  const [tab, setTab] = useState('pending')

  const s = report?.syllabus
  const a = report?.attendance
  const filter = tab === 'classes' ? 'all' : tab

  const shown = useMemo(() => (s?.subjects || []).reduce((n, subj) =>
    n + subj.chapters.reduce((m, ch) =>
      m + ch.rows.filter(r => filter === 'all' || (filter === 'done' ? r.completed : !r.completed)).length, 0), 0),
    [s, filter])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="bg-white w-full max-w-lg h-full shadow-2xl overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 truncate">{student.name || 'Unnamed student'}</h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              {student.phoneNumber || '—'}
              {enrollmentLabel(student) && <span className="text-teal-600"> · {enrollmentLabel(student)}</span>}
            </p>
            {student.papers?.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-0.5 truncate" title={student.papers.join(', ')}>
                Enrolled for: {student.papers.join(', ')}
              </p>
            )}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 flex-shrink-0">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 flex-1">
          {error ? (
            <Empty title="Couldn't load this student" hint={error} />
          ) : loading || !report ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  ['Progress',      `${s.percent}%`, toneFor(s.percent)],
                  ['Chapters done', `${s.completedChapters}/${s.totalChapters}`, 'emerald'],
                  ['Chapters left', s.totalChapters - s.completedChapters, 'amber'],
                  ['Attendance',    `${a.percent}%`, toneFor(a.percent)],
                ].map(([label, value, tone]) => (
                  <div key={label} className="bg-gray-50 rounded-xl px-3 py-2.5">
                    <p className={`text-lg font-bold leading-tight ${TEXT[tone]}`}>{value}</p>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
                Scoped to the papers you teach. A chapter completes once it is marked taught in Syllabus
                {report.thresholdPercent != null ? ` and the student attended ≥${report.thresholdPercent}% of its sessions` : ''}.
                {' '}{a.sessions} session{a.sessions !== 1 ? 's' : ''} of yours · {fmtMs(a.attendedMs)} attended.
              </p>

              <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 mb-3">
                {DETAIL_TABS.map(t => {
                  const n = t.key === 'pending' ? s.totalItems - s.completedItems
                    : t.key === 'done' ? s.completedItems
                    : t.key === 'all' ? s.totalItems : null
                  return (
                    <Chip key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
                      {t.label}{n != null && ` ${n}`}
                    </Chip>
                  )
                })}
              </div>

              {tab === 'classes' ? (
                <AttendanceList studentId={student.id} />
              ) : !s.subjects.length ? (
                <Empty title="Nothing to show" hint="No chapters from your papers for this student yet." />
              ) : !shown ? (
                <Empty title={filter === 'done' ? 'Nothing completed yet' : 'Nothing pending'}
                  hint={filter === 'done'
                    ? 'No chapter of yours is completed for this student yet.'
                    : 'Every chapter in your papers is completed for this student.'} />
              ) : (
                <div className="space-y-2">
                  {s.subjects.map(subj => <SubjectBlock key={subj.subjectId} subject={subj} filter={filter} />)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────── page ─────────────────────────────

const LIST_FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'pending',  label: 'Chapters pending' },
  { key: 'complete', label: 'All done' },
  { key: 'at-risk',  label: 'Low attendance' },
]

export default function MyStudentsPage() {
  const { data, error, loading } = useResource('/api/mentor/students')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [open, setOpen]     = useState(null)

  const students = useMemo(() => data?.students || [], [data])
  const q = search.trim().toLowerCase()

  const visible = useMemo(() => students.filter(s => {
    if (q && !`${s.name} ${s.phoneNumber}`.toLowerCase().includes(q)) return false
    if (filter === 'pending')  return s.chaptersLeft > 0
    if (filter === 'complete') return s.chapters > 0 && s.chaptersLeft === 0
    if (filter === 'at-risk')  return s.attendancePercent < 50
    return true
  }), [students, q, filter])

  const counts = {
    all: students.length,
    pending: students.filter(s => s.chaptersLeft > 0).length,
    complete: students.filter(s => s.chapters > 0 && s.chaptersLeft === 0).length,
    'at-risk': students.filter(s => s.attendancePercent < 50).length,
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">My Students</h1>
        <p className="text-gray-400 text-sm mt-1">
          Everyone on the roster of a class you hosted. Figures cover the chapters you taught them.
        </p>
      </div>

      {error ? (
        <Empty title="Couldn't load your students" hint={error} />
      ) : loading && !data ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-white rounded-2xl shadow-sm animate-pulse" />)}</div>
      ) : !students.length ? (
        <div className="bg-teal-50 border border-teal-100 rounded-2xl p-6 text-center">
          <div className="w-14 h-14 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <p className="text-teal-800 font-semibold mb-1">No students yet</p>
          <p className="text-teal-600 text-sm leading-relaxed">
            Students appear here once you have hosted and ended a live class they attended.
          </p>
        </div>
      ) : (
        <>
          {/* Headline across everyone you teach */}
          <div className="bg-white rounded-2xl shadow-sm px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              ['Students',      students.length, 'gray'],
              ['Taught chapters done', `${data.totals.chaptersDone}/${data.totals.chapters}`, 'emerald'],
              ['Still open', data.totals.chapters - data.totals.chaptersDone, 'amber'],
              ['Class hours',   fmtMs(data.totals.attendedMs), 'teal'],
            ].map(([label, value, tone]) => (
              <div key={label}>
                <p className={`text-lg font-bold leading-tight ${TEXT[tone]}`}>{value}</p>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2 flex-col sm:flex-row sm:items-center mb-3">
            <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
              {LIST_FILTERS.map(f => (
                <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>{f.label} {counts[f.key]}</Chip>
              ))}
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or phone…"
              className="sm:ml-auto w-full sm:w-56 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-400" />
          </div>

          {!visible.length ? (
            <Empty title="No match" hint="Nothing here matches the current filter." />
          ) : (
            <div className="space-y-2">
              {visible.map(s => (
                <button key={s.id} onClick={() => setOpen(s)}
                  className="w-full bg-white rounded-2xl shadow-sm px-4 py-3.5 text-left hover:bg-gray-50 transition-colors flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700 flex-shrink-0">
                    {s.name?.[0]?.toUpperCase() || '?'}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">{s.name || 'Unnamed student'}</p>
                      {enrollmentLabel(s)
                        ? <Badge tone="gray">{enrollmentLabel(s)}</Badge>
                        : <Badge tone="amber">No course set</Badge>}
                      {s.deleted && <Badge tone="rose">Account removed</Badge>}
                      {s.attendancePercent < 50 && <Badge tone="rose">Low attendance</Badge>}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate"
                      title={s.papers.length ? `Enrolled for: ${s.papers.join(', ')}` : undefined}>
                      {s.phoneNumber || '—'} · you taught {s.subjectNames.join(', ') || 'no subject'}
                      {s.papers.length > 0 && ` · enrolled for ${s.papers.join(', ')}`}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Bar percent={chapterPct(s)} tone={toneFor(chapterPct(s))} className="flex-1 max-w-[200px]" />
                      <span className={`text-[11px] font-semibold flex-shrink-0 ${TEXT[toneFor(chapterPct(s))]}`}>{chapterPct(s)}%</span>
                      <span className="text-[11px] text-gray-400 flex-shrink-0"
                        title="Chapters you have taught this student, and how many are completed for them">
                        {s.chaptersDone}/{s.chapters} chapters taught · {s.topicsDone}/{s.topics} topics
                        {s.chaptersLeft > 0 && <span className="text-amber-600"> · {s.chaptersLeft} open</span>}
                      </span>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0 hidden sm:block">
                    <p className={`text-sm font-bold ${TEXT[toneFor(s.attendancePercent)]}`}>{s.attendancePercent}%</p>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">attendance</p>
                    <p className="text-[11px] text-gray-400 mt-1">{s.present}/{s.sessions} classes</p>
                    <p className="text-[11px] text-gray-300">last {fmtDay(s.lastClassAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {open && <StudentPanel student={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
