// The student's own progress report — the same picture an admin sees on the
// Users page, scoped to themselves by the endpoints (they read req.user and
// never an id from the request, so nobody can ask for somebody else's).
//
// Read-only throughout: completion is earned by attendance and confirmed by a
// mentor, never self-declared. Laid out as tabs rather than one long scroll
// because most students open this on a phone.
import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../../api'
import { enrollmentLabel } from '../../lib/ca'

// ───────────────────────────── formatting ─────────────────────────────

const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—')

function fmtSeconds(sec) {
  if (!sec) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(sec)}s`
}
const fmtMs = (ms) => fmtSeconds(Math.round((ms || 0) / 1000))

// One scale for every percentage on the page, so a colour always means the same
// thing whether it's attendance, marks or syllabus coverage.
function toneFor(p) {
  if (p == null) return 'gray'
  if (p >= 75) return 'emerald'
  if (p >= 50) return 'amber'
  return 'rose'
}
const BAR  = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', gray: 'bg-gray-300', indigo: 'bg-indigo-500' }
const TEXT = { emerald: 'text-emerald-600', amber: 'text-amber-600', rose: 'text-rose-500', gray: 'text-gray-400', indigo: 'text-indigo-600' }
const SOFT = {
  emerald: 'bg-emerald-100 text-emerald-700', amber: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-600', gray: 'bg-gray-100 text-gray-500',
  indigo: 'bg-indigo-100 text-indigo-700', blue: 'bg-blue-100 text-blue-700',
  violet: 'bg-violet-100 text-violet-700',
}

// ───────────────────────────── building blocks ─────────────────────────────

const Bar = ({ percent, tone = 'emerald', className = '' }) => (
  <div className={`h-1.5 bg-gray-100 rounded-full overflow-hidden ${className}`}>
    <div className={`h-full rounded-full transition-all ${BAR[tone]}`} style={{ width: `${Math.max(0, Math.min(100, percent || 0))}%` }} />
  </div>
)

const Badge = ({ tone = 'gray', children }) => (
  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wide whitespace-nowrap ${SOFT[tone]}`}>{children}</span>
)

const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-2xl shadow-sm ${className}`}>{children}</div>
)

function Stat({ label, value, tone = 'gray', sub, bar }) {
  return (
    <Card className="px-3.5 py-3 min-w-0">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-xl md:text-2xl font-bold mt-0.5 leading-tight ${TEXT[tone] || 'text-gray-900'}`}>{value}</p>
      {bar != null && <Bar percent={bar} tone={tone === 'gray' ? 'indigo' : tone} className="mt-2" />}
      {sub && <p className="text-[11px] text-gray-400 mt-1.5 leading-snug">{sub}</p>}
    </Card>
  )
}

const Empty = ({ title, hint }) => (
  <Card className="p-8 text-center">
    <p className="text-gray-700 font-semibold mb-1 text-sm">{title}</p>
    {hint && <p className="text-gray-400 text-sm">{hint}</p>}
  </Card>
)

function Chip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap flex-shrink-0 transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
      {children}
    </button>
  )
}

function Pager({ page, totalPages, total, unit, onPage }) {
  if (totalPages <= 1) return total ? <p className="text-center text-[11px] text-gray-400 py-2">{total} {unit}</p> : null
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <p className="text-[11px] text-gray-400">Page {page} of {totalPages} · {total} {unit}</p>
      <div className="flex gap-2">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1}
          className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg disabled:opacity-40">Prev</button>
        <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
          className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg disabled:opacity-40">Next</button>
      </div>
    </div>
  )
}

const selectCls = 'text-xs px-3 py-2 bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400'

// ───────────────────────────── data hook ─────────────────────────────

// One GET, re-run whenever the serialized query changes. Loading is derived from
// "the answer we hold isn't for the query we're asking", so nothing is set
// synchronously in the effect and the last good payload survives a filter change.
function useResource(path, params) {
  const qs = useMemo(() => {
    const q = new URLSearchParams()
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== '' && v != null) q.set(k, v) })
    const s = q.toString()
    return s ? `?${s}` : ''
  }, [params])
  const url = `${path}${qs}`

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

// Open a presigned file in a new tab. The blank window opens synchronously
// (before the await) so the browser doesn't treat it as a blocked popup.
async function openInTab(path, onError) {
  const win = window.open('', '_blank')
  try {
    const { url } = await apiFetch(path)
    if (win) win.location = url
    else window.location.href = url
  } catch (e) {
    if (win) win.close()
    onError?.(e.message || 'Unable to open file')
  }
}

// ───────────────────────────── subjects tab ─────────────────────────────

const SUBJECT_FILTERS = [
  { key: 'all',         label: 'All' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'completed',   label: 'Completed' },
  { key: 'not-started', label: 'Not started' },
]

function TopicRow({ row }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 break-words">{row.unitName || row.chapterName}</p>
        <p className="text-xs text-gray-400 mt-1">
          {row.sessions
            ? `${row.sessions} class${row.sessions !== 1 ? 'es' : ''} · you attended ${row.percent}%`
            : 'Not taught yet'}
          {!row.completed && row.reason === 'attendance' && <span className="text-amber-600"> · attend more to complete</span>}
          {!row.completed && row.reason === 'teaching' && <span className="text-gray-400"> · still being taught</span>}
        </p>
      </div>
      <Badge tone={row.completed ? 'emerald' : 'gray'}>{row.completed ? '✓ Done' : 'Pending'}</Badge>
    </div>
  )
}

function SubjectCard({ subject, query, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const q = query.trim().toLowerCase()
  // A live search forces every card open — a collapsed match looks like no match.
  const expanded = q ? true : open

  const chapters = q
    ? subject.chapters
        .map(ch => ch.name.toLowerCase().includes(q)
          ? ch
          : { ...ch, rows: ch.rows.filter(r => (r.unitName || '').toLowerCase().includes(q)) })
        .filter(ch => ch.rows.length)
    : subject.chapters

  const tone = subject.status === 'completed' ? 'emerald' : toneFor(subject.percent)

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
        <span className="text-gray-300 text-xs w-3 flex-shrink-0">{expanded ? '▾' : '▸'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">{subject.name}</p>
            {subject.status === 'completed' && <Badge tone="emerald">Completed</Badge>}
            {subject.status === 'not-started' && <Badge tone="gray">Not started</Badge>}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <Bar percent={subject.percent} tone={tone} className="flex-1 max-w-[200px]" />
            <span className={`text-xs font-semibold flex-shrink-0 ${TEXT[tone]}`}>{subject.percent}%</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            {subject.completedChapters}/{subject.totalChapters} chapters · {subject.completedItems}/{subject.totalItems} topics
          </p>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {!chapters.length ? (
            <p className="text-xs text-gray-400 px-1 py-2">Nothing here matches your search.</p>
          ) : chapters.map(ch => {
            // A chapter with no units is one row that already carries its name.
            const single = ch.rows.length === 1 && !ch.rows[0].unitName
            return (
              <div key={ch.chapterId}>
                {!single && (
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex-1 min-w-0 truncate">{ch.name}</p>
                    <Bar percent={ch.percent} tone={ch.completed ? 'emerald' : toneFor(ch.percent)} className="w-16 flex-shrink-0" />
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{ch.done}/{ch.total}</span>
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
    </Card>
  )
}

function SubjectsTab({ syllabus }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const visible = syllabus.subjects.filter(s =>
    (filter === 'all' || s.status === filter) &&
    (!q || s.name.toLowerCase().includes(q) ||
      s.chapters.some(ch => ch.name.toLowerCase().includes(q) || ch.rows.some(r => (r.unitName || '').toLowerCase().includes(q)))))

  if (!syllabus.subjects.length) {
    return <Empty title="No chapters yet" hint="Once you attend live classes, your chapter progress shows up here." />
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-col sm:flex-row sm:items-center">
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          {SUBJECT_FILTERS.map(f => (
            <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} {f.key === 'all' ? syllabus.subjects.length : syllabus.subjects.filter(s => s.status === f.key).length}
            </Chip>
          ))}
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chapter or topic…"
          className="sm:ml-auto w-full sm:w-52 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
      </div>

      {!visible.length ? (
        <Empty title="No match" hint="Nothing here matches the current filter." />
      ) : (
        <div className="space-y-2">
          {visible.map(s => <SubjectCard key={s.subjectId} subject={s} query={query} defaultOpen={visible.length <= 2} />)}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── attendance tab ─────────────────────────────

const ATT_STATUS = [
  { key: '',        label: 'All' },
  { key: 'present', label: 'Present' },
  { key: 'late',    label: 'Late' },
  { key: 'absent',  label: 'Absent' },
]
const ATT_BADGE = { present: ['emerald', 'Present'], late: ['amber', 'Late'], absent: ['rose', 'Absent'] }

function AttendanceTab() {
  const [filters, setFilters] = useState({ page: 1, limit: 15, status: '', subjectId: '' })
  const set = (patch) => setFilters(f => ({ ...f, page: 1, ...patch }))
  const { data, error, loading } = useResource('/api/progress/me/attendance-log', filters)

  const rows = data?.rows || []
  const s = data?.summary

  return (
    <div className="space-y-3">
      {s && (
        <Card className="px-4 py-3 grid grid-cols-3 sm:grid-cols-5 gap-3">
          {[
            ['Classes', s.sessions, 'gray'],
            ['Present', s.present, 'emerald'],
            ['Late', s.late, 'amber'],
            ['Absent', s.absent, 'rose'],
            ['Attendance', `${s.percent}%`, toneFor(s.percent)],
          ].map(([label, value, tone]) => (
            <div key={label}>
              <p className={`text-base font-bold leading-tight ${TEXT[tone]}`}>{value}</p>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </Card>
      )}

      <div className="flex gap-2 flex-col sm:flex-row sm:items-center">
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          {ATT_STATUS.map(o => (
            <Chip key={o.key} active={filters.status === o.key} onClick={() => set({ status: o.key })}>{o.label}</Chip>
          ))}
        </div>
        {(data?.subjects || []).length > 1 && (
          <select value={filters.subjectId} onChange={e => set({ subjectId: e.target.value })} className={`${selectCls} sm:ml-auto w-full sm:w-56`}>
            <option value="">All subjects</option>
            {data.subjects.map(x => <option key={x.subjectId} value={x.subjectId}>{x.name}</option>)}
          </select>
        )}
      </div>

      {error ? <Empty title="Couldn't load your attendance" hint={error} />
        : loading && !rows.length ? <Card className="p-8 text-center text-sm text-gray-400">Loading…</Card>
        : !rows.length ? <Empty title="No classes here" hint="Nothing matches the current filter." />
        : (
          <div className="space-y-2">
            {rows.map(r => {
              const [tone, label] = ATT_BADGE[r.status] || ATT_BADGE.absent
              return (
                <Card key={r._id} className="p-3.5">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 break-words">{r.subject?.name || r.title}</p>
                      <p className="text-xs text-gray-500 break-words mt-0.5">
                        {[r.chapter?.name, r.unit?.name].filter(Boolean).join(' · ') || r.title}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        {fmtDay(r.classDate)} · {fmtTime(r.classDate)}
                        {r.tutor && ` · ${r.tutor}`}
                      </p>
                    </div>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-2.5">
                    <Bar percent={r.percent} tone={toneFor(r.percent)} className="flex-1" />
                    <span className={`text-[11px] font-semibold flex-shrink-0 ${TEXT[toneFor(r.percent)]}`}>{r.percent}%</span>
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtMs(r.attendedMs)} of {fmtMs(r.classDurationMs)}</span>
                  </div>
                </Card>
              )
            })}
            <Pager page={filters.page} totalPages={data?.pagination?.totalPages || 1} total={data?.pagination?.total || 0}
              unit="classes" onPage={p => setFilters(f => ({ ...f, page: p }))} />
          </div>
        )}
    </div>
  )
}

// ───────────────────────────── tests tab ─────────────────────────────

const TEST_STATUS = [
  { key: '',          label: 'All' },
  { key: 'completed', label: 'Evaluated' },
  { key: 'assigned',  label: 'Under review' },
  { key: 'pending',   label: 'Waiting' },
]
const TEST_BADGE = { completed: ['emerald', 'Evaluated'], assigned: ['blue', 'Under review'], pending: ['amber', 'Waiting'] }

function TestsTab({ bySubject }) {
  const [filters, setFilters] = useState({ page: 1, limit: 15, status: '', subjectId: '' })
  const [fileError, setFileError] = useState('')
  const set = (patch) => setFilters(f => ({ ...f, page: 1, ...patch }))
  const { data, error, loading } = useResource('/api/progress/me/test-marks', filters)

  const rows = data?.rows || []
  const s = data?.summary
  const fileUrl = (id, key, inline) =>
    `/api/test-series/submission/${id}/file?key=${encodeURIComponent(key)}${inline ? '&inline=1' : ''}`

  return (
    <div className="space-y-3">
      {s && (
        <Card className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ['Submitted', s.submitted, 'gray'],
            ['Evaluated', s.evaluated, 'emerald'],
            ['Awaiting review', s.pending, 'amber'],
            ['Average', s.evaluated ? `${s.averagePercent}%` : '—', s.evaluated ? toneFor(s.averagePercent) : 'gray'],
          ].map(([label, value, tone]) => (
            <div key={label}>
              <p className={`text-base font-bold leading-tight ${TEXT[tone]}`}>{value}</p>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </Card>
      )}

      {/* Per-subject marks — "how am I doing in Costing" without filtering first */}
      {(bySubject || []).length > 0 && (
        <Card className="p-3.5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Marks by subject</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {bySubject.map(x => (
              <div key={x.subjectId || x.name} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-900 break-words">{x.name}</p>
                  <p className="text-[11px] text-gray-400">
                    {x.evaluated}/{x.submitted} evaluated{x.evaluated > 0 && ` · ${x.awarded}/${x.total} marks`}
                  </p>
                </div>
                {x.evaluated > 0
                  ? <span className={`text-sm font-bold flex-shrink-0 ${TEXT[toneFor(x.percent)]}`}>{x.percent}%</span>
                  : <span className="text-[11px] text-gray-300 flex-shrink-0">pending</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex gap-2 flex-col sm:flex-row sm:items-center">
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          {TEST_STATUS.map(o => (
            <Chip key={o.key} active={filters.status === o.key} onClick={() => set({ status: o.key })}>{o.label}</Chip>
          ))}
        </div>
        {(data?.subjects || []).length > 1 && (
          <select value={filters.subjectId} onChange={e => set({ subjectId: e.target.value })} className={`${selectCls} sm:ml-auto w-full sm:w-56`}>
            <option value="">All subjects</option>
            {data.subjects.map(x => <option key={x.subjectId} value={x.subjectId}>{x.name}</option>)}
          </select>
        )}
      </div>

      {fileError && <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{fileError}</p>}

      {error ? <Empty title="Couldn't load your test marks" hint={error} />
        : loading && !rows.length ? <Card className="p-8 text-center text-sm text-gray-400">Loading…</Card>
        : !rows.length ? <Empty title="No test submissions" hint="Papers you write from Test Series show up here with their marks." />
        : (
          <div className="space-y-2">
            {rows.map(r => {
              const [tone, label] = TEST_BADGE[r.status] || TEST_BADGE.pending
              return (
                <Card key={r.id} className="p-3.5">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 break-words">{r.fileName || 'Untitled test'}</p>
                      <p className="text-xs text-gray-500 break-words mt-0.5">
                        {[r.subject, r.chapter, r.unit].filter(Boolean).join(' · ') || '—'}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        Written {fmtDay(r.date)}
                        {r.testDuration ? ` · ${r.testDuration} min paper` : ''}
                        {r.evaluatedAt ? ` · evaluated ${fmtDay(r.evaluatedAt)}` : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {r.status === 'completed' ? (
                        <>
                          <p className="text-lg font-bold text-gray-900 leading-tight">
                            {r.awardedMarks ?? 0}<span className="text-gray-300 text-sm"> / {r.totalMarks || 0}</span>
                          </p>
                          {r.percent != null && <p className={`text-xs font-semibold ${TEXT[toneFor(r.percent)]}`}>{r.percent}%</p>}
                        </>
                      ) : <Badge tone={tone}>{label}</Badge>}
                    </div>
                  </div>

                  {r.mentorNotes && (
                    <p className="text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2.5 break-words">
                      {r.mentorNotes}
                    </p>
                  )}

                  {(r.answerFiles.length > 0 || r.evaluatedFiles.length > 0 || r.reviewVideoUrl) && (
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      {r.evaluatedFiles.map(f => (
                        <button key={f.key} onClick={() => openInTab(fileUrl(r.id, f.key, true), setFileError)}
                          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:opacity-80">
                          Corrected paper
                        </button>
                      ))}
                      {r.answerFiles.map(f => (
                        <button key={f.key} onClick={() => openInTab(fileUrl(r.id, f.key, true), setFileError)}
                          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-blue-100 text-blue-700 hover:opacity-80">
                          My answer sheet
                        </button>
                      ))}
                      {r.reviewVideoUrl && (
                        <a href={r.reviewVideoUrl} target="_blank" rel="noreferrer"
                          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-violet-100 text-violet-700 hover:opacity-80">
                          Review video ↗
                        </a>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
            <Pager page={filters.page} totalPages={data?.pagination?.totalPages || 1} total={data?.pagination?.total || 0}
              unit="papers" onPage={p => setFilters(f => ({ ...f, page: p }))} />
          </div>
        )}
    </div>
  )
}

// ───────────────────────────── lectures tab ─────────────────────────────

function LecturesTab() {
  const { data, error, loading } = useResource('/api/progress/me/lectures', null)
  const [showAll, setShowAll] = useState(false)

  const groups = useMemo(() => {
    const byProduct = new Map()
    for (const p of data?.progress || []) {
      const key = p.productId?._id || p.productId || 'unknown'
      const g = byProduct.get(key) || { name: p.productId?.name || 'My course', items: [], seconds: 0, completed: 0 }
      g.items.push(p)
      g.seconds += p.watchedSeconds || 0
      if (p.completed) g.completed += 1
      byProduct.set(key, g)
    }
    return [...byProduct.values()].sort((a, b) => b.seconds - a.seconds)
  }, [data])

  if (loading) return <Card className="p-8 text-center text-sm text-gray-400">Loading…</Card>
  if (error) return <Empty title="Couldn't load your watch history" hint={error} />
  if (!data?.progress?.length) return <Empty title="No lectures watched yet" hint="Videos and notes you open from My Courses show up here." />

  return (
    <div className="space-y-4">
      {groups.map((g, gi) => {
        const items = showAll ? g.items : g.items.slice(0, 8)
        return (
          <div key={gi}>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
              {g.name} · {fmtSeconds(g.seconds)} · {g.completed}/{g.items.length} completed
            </p>
            <div className="space-y-1.5">
              {items.map((p, i) => (
                <Card key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Badge tone={p.contentId?.type === 'video' ? 'blue' : 'rose'}>{p.contentId?.type || 'file'}</Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 break-words">{p.contentId?.title || 'Untitled'}</p>
                    <p className="text-[11px] text-gray-400">
                      {p.contentId?.subject ? `${p.contentId.subject} · ` : ''}{fmtSeconds(p.watchedSeconds)} watched
                      {p.lastPosition > 0 && ` · resume at ${fmtSeconds(p.lastPosition)}`}
                    </p>
                  </div>
                  {p.completed && <span className="text-[11px] font-semibold text-emerald-600 flex-shrink-0">✓</span>}
                </Card>
              ))}
            </div>
            {!showAll && g.items.length > items.length && (
              <p className="text-[11px] text-gray-400 mt-1.5 px-1">{g.items.length - items.length} more hidden</p>
            )}
          </div>
        )
      })}
      {!showAll && groups.some(g => g.items.length > 8) && (
        <button onClick={() => setShowAll(true)} className="text-xs font-semibold text-indigo-600">Show everything</button>
      )}
    </div>
  )
}

// ───────────────────────────── page ─────────────────────────────

const FORECAST_REASON = {
  complete:               "You're all caught up",
  'no-syllabus':          'No syllabus set yet',
  'insufficient-history': 'Needs a few more weeks',
  'pace-too-slow':        'Attend more to get an estimate',
}

const TABS = [
  { key: 'subjects',   label: 'Subjects' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'tests',      label: 'Test marks' },
  { key: 'lectures',   label: 'Lectures' },
]

export default function ProgressPage() {
  const { data: report, error, loading } = useResource('/api/progress/me', null)
  const [tab, setTab] = useState('subjects')

  const enrolled = report ? enrollmentLabel(report.student) : ''
  const papers = (report?.student?.caSubjects || []).map(x => x.name)

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-3">
        <div className="h-16 bg-white rounded-2xl shadow-sm animate-pulse" />
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
          {Array(5).fill(0).map((_, i) => <div key={i} className="h-24 bg-white rounded-2xl shadow-sm animate-pulse" />)}
        </div>
        <div className="h-64 bg-white rounded-2xl shadow-sm animate-pulse" />
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <Empty title="Couldn't load your progress" hint={error || 'Please try again in a moment.'} />
      </div>
    )
  }

  const { syllabus, attendance, tests, lectures, forecast, thresholdPercent } = report

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">My Progress</h1>
        <p className="text-gray-400 text-sm mt-1">
          {enrolled && <span className="text-indigo-500 font-medium">{enrolled} · </span>}
          {papers.length > 0 && <span className="text-gray-500">{papers.join(', ')} · </span>}
          A chapter is completed once your mentor has taught it and you attended
          {thresholdPercent != null ? ` at least ${thresholdPercent}%` : ' enough'} of its classes.
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-2.5 md:gap-3 mb-4">
        <Stat label="Overall progress" value={`${syllabus.percent}%`} tone={toneFor(syllabus.percent)} bar={syllabus.percent}
          sub={`${syllabus.completedChapters}/${syllabus.totalChapters} chapters · ${syllabus.completedItems}/${syllabus.totalItems} topics`} />

        <Stat label="Attendance" value={`${attendance.percent}%`} tone={toneFor(attendance.percent)} bar={attendance.percent}
          sub={`${attendance.present} of ${attendance.sessions} classes cleared`} />

        <Stat label="Test average"
          value={tests.evaluated ? `${tests.averagePercent}%` : '—'}
          tone={tests.evaluated ? toneFor(tests.averagePercent) : 'gray'}
          bar={tests.evaluated ? tests.averagePercent : null}
          sub={tests.evaluated ? `${tests.awarded} of ${tests.total} marks` : 'No evaluated papers yet'} />

        <Stat label="Watch time" value={fmtSeconds(lectures?.watchedSeconds)} tone="indigo"
          sub={lectures ? `${lectures.completed} of ${lectures.lectures} items completed` : '—'} />

        <Stat label="On track to finish"
          value={forecast.estimatedCompletion ? fmtDay(forecast.estimatedCompletion) : '—'}
          tone={forecast.estimatedCompletion ? 'amber' : 'gray'}
          sub={forecast.estimatedCompletion
            ? `${forecast.remaining} topics left at ${forecast.itemsPerWeek}/week`
            : FORECAST_REASON[forecast.reason] || 'Not enough data yet'} />
      </div>

      <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 mb-3">
        {TABS.map(t => (
          <Chip key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</Chip>
        ))}
      </div>

      {tab === 'subjects'   && <SubjectsTab syllabus={syllabus} />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'tests'      && <TestsTab bySubject={tests.bySubject} />}
      {tab === 'lectures'   && <LecturesTab />}
    </div>
  )
}
