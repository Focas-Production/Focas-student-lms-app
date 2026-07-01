import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../../api'
import PdfViewer from '../../components/PdfViewer'

// Small inline file-row with View (inline) + Download (attachment) actions.
function FileRow({ name, color, onOpen }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${color} rounded-lg px-3 py-2`}>
      <span className="truncate flex-1">{name}</span>
      <button onClick={() => onOpen(true)} className="text-xs font-semibold hover:underline flex-shrink-0">View</button>
      <span className="text-gray-300">|</span>
      <button onClick={() => onOpen(false)} className="text-xs font-semibold hover:underline flex-shrink-0">Download</button>
    </div>
  )
}

async function putToR2(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: 'PUT', body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
  if (!res.ok) throw new Error(`Upload failed for ${file.name}`)
}

const TABS = [['pool', 'Pool'], ['mine', 'Assigned to me'], ['completed', 'Completed']]

// Ensure a mentor-entered link is absolute so target="_blank" doesn't resolve it
// relative to the app (e.g. "drive.google.com/…" → localhost:5173/mentor/drive…).
// Returns '' for values that don't look like a URL at all (e.g. a stray "409787").
function normalizeUrl(raw) {
  const u = (raw || '').trim()
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  if (!u.includes('.')) return ''            // not a hostname — treat as invalid
  return `https://${u}`
}

export default function MentorTestSeriesPage() {
  const [tab, setTab] = useState('pool')
  const [rows, setRows] = useState(null)
  const [evaluating, setEvaluating] = useState(null) // submission being evaluated
  const [toast, setToast] = useState('')

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 4000) }

  const load = useCallback(() => {
    setRows(null)
    apiFetch(`/api/mentor/test-series?tab=${tab}`).then(d => setRows(d.submissions || [])).catch(() => setRows([]))
  }, [tab])

  useEffect(() => { load() }, [load])

  const assignToMe = async (id) => {
    try {
      await apiFetch(`/api/mentor/test-series/${id}/assign`, { method: 'POST' })
      showToast('Assigned to you. See "Assigned to me".')
      load()
    } catch (e) { showToast(e.message) }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>
      )}

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Test Series</h1>
        <p className="text-gray-400 text-sm mt-1">Evaluate student answer sheets and publish marks.</p>
      </div>

      <div className="flex gap-2 mb-5">
        {TABS.map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === v ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
            }`}>{l}</button>
        ))}
      </div>

      {rows === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !rows.length ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">Nothing here yet</p>
          <p className="text-gray-400 text-sm">
            {tab === 'pool' ? 'Unassigned submissions will appear here.' : tab === 'mine' ? 'Papers assigned to you will appear here.' : 'Your evaluated papers will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map(r => (
            <SubmissionCard key={r._id} sub={r} tab={tab}
              onAssign={() => assignToMe(r._id)}
              onEvaluate={() => setEvaluating(r)} />
          ))}
        </div>
      )}

      {evaluating && (
        <EvaluateModal sub={evaluating} onClose={() => setEvaluating(null)}
          onDone={() => { setEvaluating(null); showToast('Evaluation submitted. Student notified.'); load() }} />
      )}
    </div>
  )
}

function SubmissionCard({ sub, tab, onAssign, onEvaluate }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-900 truncate">{sub.fileName}</p>
          {sub.assignedVia === 'auto' && tab === 'mine' && (
            <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full font-semibold">auto-assigned</span>
          )}
        </div>
        <p className="text-xs text-gray-700 mt-0.5">
          <span className="font-semibold">{sub.studentName || 'Student'}</span>
          {sub.studentPhone && <span className="text-gray-500"> · {sub.studentPhone}</span>}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {sub.level || '—'} · {sub.subject} · {sub.chapter || '—'}{sub.unit ? ` · ${sub.unit}` : ''}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {sub.testDuration} min · {sub.totalMarks} marks
          {sub.status === 'completed' && sub.awardedMarks != null && (
            <span className="ml-2 font-semibold text-emerald-700">Scored {sub.awardedMarks}/{sub.totalMarks}</span>
          )}
        </p>
      </div>
      <div className="flex-shrink-0">
        {tab === 'pool' && (
          <button onClick={onAssign} className="px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700">
            Assign to me
          </button>
        )}
        {tab === 'mine' && (
          <button onClick={onEvaluate} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
            Evaluate
          </button>
        )}
        {tab === 'completed' && (
          <button onClick={onEvaluate} className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50">
            View
          </button>
        )}
      </div>
    </div>
  )
}

function EvaluateModal({ sub, onClose, onDone }) {
  const readOnly = sub.status === 'completed'
  const [marks, setMarks] = useState(sub.awardedMarks != null ? String(sub.awardedMarks) : '')
  const [notes, setNotes] = useState(sub.mentorNotes || '')
  const [reviewVideo, setReviewVideo] = useState(sub.reviewVideoUrl || '')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [paper, setPaper] = useState(null)       // { blobUrl, title } currently shown read-only
  const [paperLoading, setPaperLoading] = useState('') // 'question' | 'answer' | '' while fetching

  // Open the tab synchronously (within the click gesture) so it isn't popup-blocked,
  // then point it at the presigned URL once we have it.
  const openFile = async (key, inline) => {
    const win = window.open('', '_blank')
    try {
      const q = `key=${encodeURIComponent(key)}${inline ? '&inline=1' : ''}`
      const { url } = await apiFetch(`/api/mentor/test-series/${sub._id}/file?${q}`)
      if (win) win.location = url
      else window.location.href = url
    } catch (e) {
      if (win) win.close()
      setError(e.message)
    }
  }

  // Question paper and answer key render inline, read-only (PdfViewer = canvas, no
  // download/print), so the mentor can grade against them without saving the files.
  const viewPaper = async (which) => {
    if (paperLoading) return
    setPaperLoading(which); setError('')
    try {
      const endpoint = which === 'question' ? 'question-paper' : 'answer-key'
      const title = which === 'question' ? 'Question Paper' : 'Answer Key'
      const { url } = await apiFetch(`/api/mentor/test-series/${sub._id}/${endpoint}`)
      const token = localStorage.getItem('student_token')
      const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      if (!res.ok) throw new Error('Unable to open document. Please try again.')
      setPaper({ blobUrl: URL.createObjectURL(await res.blob()), title })
    } catch (e) {
      setError(e.message || 'Document not available')
    } finally { setPaperLoading('') }
  }

  const closePaper = () => {
    setPaper(p => { if (p?.blobUrl) URL.revokeObjectURL(p.blobUrl); return null })
  }

  const submit = async () => {
    const m = Number(marks)
    if (!Number.isFinite(m) || m < 0 || m > sub.totalMarks) { setError(`Marks must be 0–${sub.totalMarks}`); return }
    setBusy(true); setError('')
    try {
      let evaluatedFiles = []
      if (files.length) {
        const { uploads } = await apiFetch(`/api/mentor/test-series/${sub._id}/presign-eval`, {
          method: 'POST',
          body: JSON.stringify({ files: files.map(f => ({ name: f.name, contentType: f.type, size: f.size })) }),
        })
        await Promise.all(uploads.map((u, i) => putToR2(u.uploadUrl, files[i])))
        evaluatedFiles = uploads.map(u => ({ key: u.key, name: u.name, size: u.size, contentType: u.contentType }))
      }
      await apiFetch(`/api/mentor/test-series/${sub._id}/evaluate`, {
        method: 'POST',
        body: JSON.stringify({ awardedMarks: m, mentorNotes: notes, reviewVideoUrl: normalizeUrl(reviewVideo), files: evaluatedFiles }),
      })
      onDone()
    } catch (e) {
      setError(e.message || 'Failed to submit')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-gray-900">{readOnly ? 'Evaluation' : 'Evaluate Paper'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm">
            <p className="font-semibold text-gray-900">{sub.fileName}</p>
            <p className="text-xs text-gray-700 mt-0.5"><span className="font-semibold">{sub.studentName || 'Student'}</span>{sub.studentPhone ? ` · ${sub.studentPhone}` : ''}</p>
            <p className="text-xs text-gray-500 mt-0.5">{sub.level} · {sub.subject} · {sub.chapter}{sub.unit ? ` · ${sub.unit}` : ''}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub.testDuration} min · {sub.totalMarks} marks</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => viewPaper('question')} disabled={!!paperLoading}
                className="inline-flex items-center gap-1 text-xs font-semibold bg-teal-100 text-teal-700 rounded-lg px-3 py-1.5 hover:bg-teal-200 disabled:opacity-50">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/></svg>
                {paperLoading === 'question' ? 'Loading…' : 'View Question Paper'}
              </button>
              {sub.hasAnswerKey && (
                <button onClick={() => viewPaper('answer')} disabled={!!paperLoading}
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-emerald-100 text-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-200 disabled:opacity-50">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/></svg>
                  {paperLoading === 'answer' ? 'Loading…' : 'View Answer Key'}
                </button>
              )}
            </div>
          </div>

          {/* Student's answer files */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">Student answer sheet(s)</p>
            <div className="space-y-1.5">
              {(sub.answerFiles || []).map(f => (
                <FileRow key={f.key} name={f.name} color="bg-teal-50 text-teal-700" onOpen={(inline) => openFile(f.key, inline)} />
              ))}
              {!(sub.answerFiles || []).length && <p className="text-xs text-gray-400">No files</p>}
            </div>
          </div>

          {/* Marks */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Marks awarded (out of {sub.totalMarks})</label>
            <input type="number" min="0" max={sub.totalMarks} value={marks} disabled={readOnly}
              onChange={e => setMarks(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50" />
          </div>

          {/* Notes (optional) */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea rows={3} value={notes} disabled={readOnly} onChange={e => setNotes(e.target.value)}
              placeholder="Feedback for the student…"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 resize-none" />
          </div>

          {/* Review video link (optional) */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Review video link <span className="text-gray-400 font-normal">(optional — Google Drive / YouTube)</span></label>
            {readOnly ? (
              normalizeUrl(reviewVideo)
                ? <a href={normalizeUrl(reviewVideo)} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-rose-600 hover:underline break-all">
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"/></svg>
                    Watch review video ↗
                  </a>
                : <p className="text-xs text-gray-400">No review video</p>
            ) : (
              <input type="url" value={reviewVideo} onChange={e => setReviewVideo(e.target.value)}
                placeholder="https://drive.google.com/…"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400" />
            )}
          </div>

          {/* Corrected sheet upload / view */}
          {readOnly ? (
            (sub.evaluatedFiles || []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1.5">Corrected sheet(s)</p>
                <div className="space-y-1.5">
                  {sub.evaluatedFiles.map(f => (
                    <FileRow key={f.key} name={f.name} color="bg-indigo-50 text-indigo-700" onOpen={(inline) => openFile(f.key, inline)} />
                  ))}
                </div>
              </div>
            )
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Upload corrected sheet(s) <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="file" multiple onChange={e => setFiles([...e.target.files])}
                className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-semibold file:text-sm" />
              {files.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {files.map((f, i) => <li key={i} className="text-xs text-gray-500 truncate">{f.name}</li>)}
                </ul>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        {!readOnly && (
          <div className="px-5 py-4 border-t flex gap-2">
            <button onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400">
              {busy ? 'Submitting…' : 'Submit Evaluation'}
            </button>
          </div>
        )}
      </div>
    </div>
    {paper && <PdfViewer blobUrl={paper.blobUrl} title={paper.title} onClose={closePaper} />}
    </>
  )
}
