import { useState, useEffect, useMemo, useCallback } from 'react'
import { apiFetch } from '../../api'
import PdfViewer from '../../components/PdfViewer'

const TYPE_LABELS = {
  chapter_wise: 'Chapter-wise',
  segment_wise: 'Subject-wise',
  full_test:    'Full Test',
}
const ATTEMPT_KEY = 'active_test_attempt'

const uniq = (arr) => [...new Set(arr.filter(Boolean))]

// PUT a file straight to its presigned R2 URL — bytes never touch our server.
async function putToR2(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
  if (!res.ok) throw new Error(`Upload failed for ${file.name}`)
}

function StatusPill({ status }) {
  const map = {
    pending:   'bg-amber-100 text-amber-700',
    assigned:  'bg-amber-100 text-amber-700',
    completed: 'bg-emerald-100 text-emerald-700',
  }
  const label = status === 'completed' ? 'Completed' : 'Pending'
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] || map.pending}`}>{label}</span>
}

export default function TestSeriesPage() {
  const [tab, setTab] = useState('take')   // 'take' | 'submissions'
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  // cascade selections
  const [type, setType] = useState('')
  const [level, setLevel] = useState('')
  const [subject, setSubject] = useState('')
  const [chapter, setChapter] = useState('')
  const [unit, setUnit] = useState('')
  const [fileId, setFileId] = useState('')

  // active attempt (persisted so a refresh resumes the timer)
  const [attempt, setAttempt] = useState(() => {
    try { return JSON.parse(localStorage.getItem(ATTEMPT_KEY)) || null } catch { return null }
  })

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000) }

  useEffect(() => {
    apiFetch('/api/test-series/catalog')
      .then(d => setCatalog(d.catalog || []))
      .catch(() => setCatalog([]))
      .finally(() => setLoading(false))
  }, [])

  // ── cascade option lists ──
  const types    = useMemo(() => uniq(catalog.map(c => c.testSeriesType)), [catalog])
  const levels   = useMemo(() => uniq(catalog.filter(c => c.testSeriesType === type).map(c => c.level)), [catalog, type])
  const subjects = useMemo(() => uniq(catalog.filter(c => c.testSeriesType === type && c.level === level).map(c => c.subject)), [catalog, type, level])
  const chapters = useMemo(() => uniq(catalog.filter(c => c.testSeriesType === type && c.level === level && c.subject === subject).map(c => c.chapter)), [catalog, type, level, subject])
  const units    = useMemo(() => uniq(catalog.filter(c => c.testSeriesType === type && c.level === level && c.subject === subject && c.chapter === chapter).map(c => c.unit)), [catalog, type, level, subject, chapter])
  const files    = useMemo(() => catalog.filter(c => c.testSeriesType === type && c.level === level && c.subject === subject && c.chapter === chapter && (c.unit || '') === unit), [catalog, type, level, subject, chapter, unit])
  const selectedFile = useMemo(() => files.find(f => f.contentId === fileId) || null, [files, fileId])

  // reset descendants when an ancestor changes
  const onType    = v => { setType(v); setLevel(''); setSubject(''); setChapter(''); setUnit(''); setFileId('') }
  const onLevel   = v => { setLevel(v); setSubject(''); setChapter(''); setUnit(''); setFileId('') }
  const onSubject = v => { setSubject(v); setChapter(''); setUnit(''); setFileId('') }
  const onChapter = v => { setChapter(v); setUnit(''); setFileId('') }
  const onUnit    = v => { setUnit(v); setFileId('') }

  const beginAttempt = (file) => {
    const a = {
      contentId: file.contentId, fileName: file.fileName, level: file.level,
      subject: file.subject, chapter: file.chapter, unit: file.unit || '', durationMin: file.testDuration,
      totalMarks: file.totalMarks, startedAt: new Date().toISOString(),
    }
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify(a))
    setAttempt(a)
  }

  const clearAttempt = () => { localStorage.removeItem(ATTEMPT_KEY); setAttempt(null) }

  const onSubmitted = () => {
    clearAttempt()
    setType(''); setLevel(''); setSubject(''); setChapter(''); setUnit(''); setFileId('')
    showToast('✅ Answer sheet submitted! Your mentor will evaluate it soon.')
    setTab('submissions')
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg max-w-[90vw] text-center">
          {toast}
        </div>
      )}

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Test Series</h1>
        <p className="text-gray-400 text-sm mt-1">Take a timed test, then upload your handwritten answer sheet.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {[['take', 'Take a Test'], ['submissions', 'My Submissions']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
            }`}>{l}</button>
        ))}
      </div>

      {/* Take-a-test stays in a narrow centered column; submissions use the full width */}
      {tab === 'take' && (
        <div className="max-w-xl">
          {attempt
            ? <AttemptView attempt={attempt} onCancel={clearAttempt} onSubmitted={onSubmitted} />
            : <CascadePicker
                loading={loading} catalog={catalog}
                types={types} levels={levels} subjects={subjects} chapters={chapters} units={units} files={files}
                type={type} level={level} subject={subject} chapter={chapter} unit={unit} fileId={fileId}
                onType={onType} onLevel={onLevel} onSubject={onSubject} onChapter={onChapter} onUnit={onUnit} setFileId={setFileId}
                selectedFile={selectedFile} onStart={beginAttempt}
              />}
        </div>
      )}

      {tab === 'submissions' && <SubmissionsTable />}
    </div>
  )
}

// ───────────────────────── cascade picker ─────────────────────────
function Dropdown({ label, value, onChange, options, render, disabled, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400">
        <option value="">{placeholder}</option>
        {options.map(o => {
          const { val, lab } = render ? render(o) : { val: o, lab: o }
          return <option key={val} value={val}>{lab}</option>
        })}
      </select>
    </div>
  )
}

function CascadePicker({ loading, catalog, types, levels, subjects, chapters, units, files,
  type, level, subject, chapter, unit, fileId, onType, onLevel, onSubject, onChapter, onUnit, setFileId, selectedFile, onStart }) {

  if (loading) return <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading test series…</div>
  if (!catalog.length) return (
    <div className="bg-white rounded-2xl p-8 text-center">
      <p className="text-gray-700 font-semibold mb-1">No test series available</p>
      <p className="text-gray-400 text-sm">Test series for your enrolled courses will appear here.</p>
    </div>
  )

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
      <Dropdown label="Test Type" value={type} onChange={onType} options={types}
        render={o => ({ val: o, lab: TYPE_LABELS[o] || o })} placeholder="Select test type…" />

      <Dropdown label="Level" value={level} onChange={onLevel} options={levels}
        disabled={!type} placeholder="Select level…" />

      <Dropdown label="Subject" value={subject} onChange={onSubject} options={subjects}
        disabled={!level} placeholder="Select subject…" />

      <Dropdown label="Chapter" value={chapter} onChange={onChapter} options={chapters}
        disabled={!subject} placeholder="Select chapter…" />

      {units.filter(Boolean).length > 0 && (
        <Dropdown label="Unit / Part" value={unit} onChange={onUnit} options={units.filter(Boolean)}
          disabled={!chapter} placeholder="Select unit / part…" />
      )}

      <Dropdown label="Test Paper" value={fileId} onChange={setFileId} options={files}
        render={f => ({ val: f.contentId, lab: f.fileName })}
        disabled={!chapter || (units.filter(Boolean).length > 0 && !unit)} placeholder="Select test paper…" />

      {selectedFile && (
        <div className="flex items-center gap-4 bg-indigo-50 rounded-xl px-4 py-3 text-sm">
          <div className="flex-1">
            <p className="font-semibold text-indigo-900">{selectedFile.fileName}</p>
            <p className="text-indigo-600 text-xs mt-0.5">
              Duration {selectedFile.testDuration} min · {selectedFile.totalMarks} marks
            </p>
          </div>
        </div>
      )}

      <button disabled={!selectedFile} onClick={() => onStart(selectedFile)}
        className="w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors disabled:bg-gray-200 disabled:text-gray-400">
        Start Test
      </button>
    </div>
  )
}

// ───────────────────────── attempt: instructions → timer → upload ─────────────────────────
function AttemptView({ attempt, onCancel, onSubmitted }) {
  const [agreed, setAgreed] = useState(false)
  const endTs = useMemo(() => new Date(attempt.startedAt).getTime() + attempt.durationMin * 60 * 1000, [attempt])
  const [now, setNow] = useState(Date.now())
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const remainingMs = Math.max(0, endTs - now)
  const timeUp = remainingMs <= 0
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, '0')
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')

  const handleSubmit = useCallback(async () => {
    if (!files.length) { setError('Please select at least one file'); return }
    setBusy(true); setError('')
    try {
      // 1. ask server for presigned PUT urls
      const { uploads } = await apiFetch('/api/test-series/presign-upload', {
        method: 'POST',
        body: JSON.stringify({
          contentId: attempt.contentId,
          files: files.map(f => ({ name: f.name, contentType: f.type, size: f.size })),
        }),
      })
      // 2. upload each file directly to R2
      await Promise.all(uploads.map((u, i) => putToR2(u.uploadUrl, files[i])))
      // 3. record the submission with the resulting keys
      await apiFetch('/api/test-series/submit', {
        method: 'POST',
        body: JSON.stringify({
          contentId: attempt.contentId,
          startedAt: attempt.startedAt,
          files: uploads.map(u => ({ key: u.key, name: u.name, size: u.size, contentType: u.contentType })),
        }),
      })
      onSubmitted()
    } catch (e) {
      setError(e.message || 'Submission failed')
    } finally {
      setBusy(false)
    }
  }, [files, attempt, onSubmitted])

  // Instruction screen (before Agree)
  if (!agreed) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">📝</span>
          <h2 className="text-lg font-bold text-gray-900">Test Instructions</h2>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 space-y-2 mb-5">
          <p className="font-semibold">{attempt.fileName}</p>
          <ul className="list-disc list-inside space-y-1 text-amber-700">
            <li>Duration: <strong>{attempt.durationMin} minutes</strong></li>
            <li>Total marks: <strong>{attempt.totalMarks}</strong></li>
            <li>The timer starts as soon as you press <strong>I Agree</strong>.</li>
            <li>Write your answers on paper. The <strong>upload option unlocks only after the timer ends</strong>.</li>
            <li>You may upload multiple files (photo, PDF, Excel — any format).</li>
          </ul>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => setAgreed(true)} className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700">
            I Agree — Start Timer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      <div className="text-center mb-6">
        <p className="text-xs text-gray-400 font-medium mb-1">{attempt.subject} · {attempt.chapter}{attempt.unit ? ` · ${attempt.unit}` : ''}</p>
        <p className="text-sm font-semibold text-gray-700 mb-3">{attempt.fileName}</p>
        <div className={`inline-flex items-baseline gap-1 font-mono text-4xl font-bold ${timeUp ? 'text-emerald-600' : 'text-indigo-600'}`}>
          {timeUp ? 'Time up!' : <>{mm}<span className="text-2xl">:</span>{ss}</>}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {timeUp ? 'You can now upload your answer sheet.' : 'Upload unlocks when the timer reaches 00:00.'}
        </p>
      </div>

      <fieldset disabled={!timeUp} className={timeUp ? '' : 'opacity-50 pointer-events-none'}>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Answer sheet(s)</label>
        <input type="file" multiple onChange={e => setFiles([...e.target.files])}
          className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-semibold file:text-sm" />
        {files.length > 0 && (
          <ul className="mt-3 space-y-1">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                <span className="truncate text-gray-700">{f.name}</span>
                <span className="text-gray-400 flex-shrink-0 ml-2">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

      <div className="flex gap-2 mt-5">
        <button onClick={onCancel} disabled={busy}
          className="px-4 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50">
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={!timeUp || busy || !files.length}
          className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400">
          {busy ? 'Uploading…' : 'Submit Answer Sheet'}
        </button>
      </div>
    </div>
  )
}

// ───────────────────────── my submissions ─────────────────────────
function SubmissionsTable() {
  const [rows, setRows] = useState(null)
  const [result, setResult] = useState(null)   // completed submission opened in modal
  const [answer, setAnswer] = useState(null)    // { blobUrl, title } for the answer-key viewer
  const [answerLoadingId, setAnswerLoadingId] = useState(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    setRows(null)
    apiFetch(`/api/test-series/my-submissions?page=${page}&limit=${limit}`)
      .then(d => { setRows(d.submissions || []); setTotal(d.total || 0); setTotalPages(d.totalPages || 1) })
      .catch(() => { setRows([]); setTotal(0); setTotalPages(1) })
  }, [page, limit])

  const onLimit = (v) => { setLimit(v); setPage(1) }
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1
  const rangeEnd   = Math.min(page * limit, total)

  // Fetch the view-only answer key for a submitted test and open the PDF viewer.
  const openAnswerKey = async (r) => {
    setAnswerLoadingId(r._id)
    try {
      const { url } = await apiFetch(`/api/test-series/submission/${r._id}/answer-key`)
      const token = localStorage.getItem('student_token')
      const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      if (!res.ok) throw new Error('Unable to open answer key')
      setAnswer({ blobUrl: URL.createObjectURL(await res.blob()), title: `${r.fileName} — Answer Key` })
    } catch {
      alert('Answer key is not available yet.')
    } finally {
      setAnswerLoadingId(null)
    }
  }
  const closeAnswer = () => {
    if (answer?.blobUrl) setTimeout(() => URL.revokeObjectURL(answer.blobUrl), 300)
    setAnswer(null)
  }

  if (rows === null) return <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
  if (!rows.length) return (
    <div className="bg-white rounded-2xl p-8 text-center">
      <p className="text-gray-700 font-semibold mb-1">No submissions yet</p>
      <p className="text-gray-400 text-sm">Tests you submit will appear here with their status.</p>
    </div>
  )

  const AnswerBtn = ({ r, full }) => r.hasAnswerKey ? (
    <button onClick={(e) => { e.stopPropagation(); openAnswerKey(r) }} disabled={answerLoadingId === r._id}
      className={`${full ? 'w-full justify-center ' : ''}inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50`}>
      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 011-1h.01a1 1 0 010 2H11v3a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd"/></svg>
      {answerLoadingId === r._id ? 'Loading…' : 'Answer Key'}
    </button>
  ) : (full ? <span className="text-xs text-gray-300">No answer key</span> : <span className="text-xs text-gray-300">—</span>)

  const marksCell = (r) => r.status === 'completed' && r.awardedMarks != null
    ? <span className="font-semibold text-emerald-700">{r.awardedMarks}/{r.totalMarks}</span>
    : <span>{r.totalMarks}</span>

  return (
    <>
      {/* Desktop / tablet — table */}
      <div className="hidden md:block bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[12%]" /><col className="w-[16%]" /><col className="w-[13%]" /><col className="w-[23%]" />
            <col className="w-[8%]" /><col className="w-[8%]" /><col className="w-[10%]" /><col className="w-[10%]" />
          </colgroup>
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left font-semibold px-4 py-3">Level</th>
              <th className="text-left font-semibold px-4 py-3">Subject</th>
              <th className="text-left font-semibold px-4 py-3">Chapter</th>
              <th className="text-left font-semibold px-4 py-3">Paper</th>
              <th className="text-center font-semibold px-3 py-3">Duration</th>
              <th className="text-center font-semibold px-3 py-3">Marks</th>
              <th className="text-center font-semibold px-3 py-3">Status</th>
              <th className="text-center font-semibold px-3 py-3">Answer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r._id} className={`border-t border-gray-50 align-middle ${r.status === 'completed' ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                onClick={() => r.status === 'completed' && setResult(r)}>
                <td className="px-4 py-3 text-gray-600">{r.level || '—'}</td>
                <td className="px-4 py-3 text-gray-800 font-medium truncate" title={r.subject}>{r.subject}</td>
                <td className="px-4 py-3 text-gray-600 truncate" title={`${r.chapter || ''}${r.unit ? ' · ' + r.unit : ''}`}>
                  {r.chapter || '—'}
                  {r.unit && <span className="block text-[11px] text-indigo-500 truncate">{r.unit}</span>}
                </td>
                <td className="px-4 py-3 text-gray-600 truncate" title={r.fileName}>{r.fileName}</td>
                <td className="px-3 py-3 text-center text-gray-600 whitespace-nowrap">{r.testDuration}m</td>
                <td className="px-3 py-3 text-center text-gray-600 whitespace-nowrap">{marksCell(r)}</td>
                <td className="px-3 py-3 text-center"><StatusPill status={r.status} /></td>
                <td className="px-3 py-3 text-center"><AnswerBtn r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile — cards */}
      <div className="md:hidden space-y-3">
        {rows.map(r => (
          <div key={r._id} onClick={() => r.status === 'completed' && setResult(r)}
            className={`bg-white rounded-2xl shadow-sm p-4 ${r.status === 'completed' ? 'cursor-pointer active:bg-gray-50' : ''}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 truncate" title={r.fileName}>{r.fileName}</p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{r.subject}{r.chapter ? ` · ${r.chapter}` : ''}{r.unit ? ` · ${r.unit}` : ''}</p>
              </div>
              <StatusPill status={r.status} />
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {r.level && <Chip>{r.level}</Chip>}
              <Chip>⏱ {r.testDuration}m</Chip>
              <Chip>💯 {marksCell(r)}</Chip>
            </div>
            <AnswerBtn r={r} full />
          </div>
        ))}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 mt-4">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Rows:</span>
            <select value={limit} onChange={e => onLimit(Number(e.target.value))}
              className="px-2 py-1 border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400">
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="ml-1">{rangeStart}–{rangeEnd} of {total}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              ← Prev
            </button>
            <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              Next →
            </button>
          </div>
        </div>
      )}

      {result && <ResultModal sub={result} onClose={() => setResult(null)} />}
      {answer && <PdfViewer blobUrl={answer.blobUrl} title={answer.title} onClose={closeAnswer} />}
    </>
  )
}

function Chip({ children }) {
  return <span className="inline-flex items-center bg-gray-100 text-gray-600 text-xs font-medium px-2 py-1 rounded-lg">{children}</span>
}

function ResultModal({ sub, onClose }) {
  const openFile = async (key, inline) => {
    const win = window.open('', '_blank')   // opened synchronously so it isn't popup-blocked
    try {
      const q = `key=${encodeURIComponent(key)}${inline ? '&inline=1' : ''}`
      const { url } = await apiFetch(`/api/test-series/submission/${sub._id}/file?${q}`)
      if (win) win.location = url
      else window.location.href = url
    } catch { if (win) win.close() }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-gray-900">Result</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="text-center bg-emerald-50 rounded-xl py-4">
            <p className="text-3xl font-bold text-emerald-700">{sub.awardedMarks}/{sub.totalMarks}</p>
            <p className="text-xs text-emerald-600 mt-1">{sub.subject} · {sub.fileName}</p>
          </div>
          {sub.mentorNotes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Mentor notes</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 whitespace-pre-wrap">{sub.mentorNotes}</p>
            </div>
          )}
          {sub.reviewVideoUrl && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">Mentor review video</p>
              <a href={sub.reviewVideoUrl} target="_blank" rel="noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold bg-rose-50 text-rose-700 rounded-lg px-3 py-2.5 hover:bg-rose-100">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"/></svg>
                Watch Review Video ↗
              </a>
            </div>
          )}
          {(sub.evaluatedFiles || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">Corrected answer sheet</p>
              <div className="space-y-2">
                {sub.evaluatedFiles.map(f => (
                  <div key={f.key} className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-sm text-gray-700 truncate mb-1.5" title={f.name}>{f.name}</p>
                    <div className="flex gap-2">
                      <button onClick={() => openFile(f.key, true)}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold bg-indigo-50 text-indigo-700 rounded-lg px-3 py-1.5 hover:bg-indigo-100">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                        View
                      </button>
                      <button onClick={() => openFile(f.key, false)}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-100">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
