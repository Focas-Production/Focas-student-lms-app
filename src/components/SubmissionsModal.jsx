import { useCallback, useEffect, useRef, useState } from 'react'

// Review what students handed in for one live class: play voice notes and video
// answers inline, open PDFs and documents, award marks, write feedback, and send
// corrected files back.
//
// Deliberately transport-agnostic — it takes `apiFetch` as a prop instead of
// importing it. The mentor portal and the admin panel are separate Vite apps
// with separate API clients and separate token keys ('student_token' vs
// 'admin_token'); passing the client in is what lets one reviewed-and-tested
// component serve both instead of two copies drifting apart.
//
// Props:
//   classId, title   — which class
//   apiFetch         — the host app's authenticated fetch wrapper
//   basePath         — manage-route prefix (default '/api/live-classes/manage')
//   accent           — 'teal' (mentor) | 'blue' (admin)
//   onClose, onCountsChange

const KIND_ICON = { audio: '🎙', video: '🎬', pdf: '📕', image: '🖼', doc: '📄', other: '📎', verbal: '🗣' }

// Where a "heard in class" entry sits in the class recording, e.g. "at 12m".
const fmtOffset = (ms) => {
  if (ms == null) return ''
  const m = Math.floor(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

const fmtBytes = (b) => {
  if (!b) return ''
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}
const fmtClock = (ms) => {
  const s = Math.floor((ms || 0) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const fmtWhen = (d) => (d ? new Date(d).toLocaleString(undefined, {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}) : '—')

const STATUS_CHIP = {
  submitted:         { label: 'Awaiting review', cls: 'bg-amber-100 text-amber-700' },
  changes_requested: { label: 'Changes asked',   cls: 'bg-orange-100 text-orange-700' },
  reviewed:          { label: 'Reviewed',        cls: 'bg-emerald-100 text-emerald-700' },
}

const REVIEW_ACCEPT = [
  'application/pdf', 'image/*', 'audio/*', 'video/*',
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.zip',
].join(',')

export default function SubmissionsModal({
  classId, title, apiFetch, basePath = '/api/live-classes/manage',
  accent = 'teal', onClose, onCountsChange,
}) {
  const [data, setData]     = useState(null)   // { submissions, counts, class }
  const [error, setError]   = useState('')
  const [openId, setOpenId] = useState(null)
  const [filter, setFilter] = useState('all')  // all | pending | reviewed

  const btn = accent === 'blue'
    ? 'bg-blue-600 hover:bg-blue-700'
    : 'bg-teal-600 hover:bg-teal-700'

  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`${basePath}/${classId}/submissions`)
      setData(d)
      onCountsChange?.(d.counts)
      setError('')
    } catch (e) {
      setError(e.message || 'Could not load submissions')
      setData({ submissions: [], counts: { total: 0, pending: 0, reviewed: 0 } })
    }
  }, [apiFetch, basePath, classId, onCountsChange])

  useEffect(() => { load() }, [load])

  // Patch one row in place rather than refetching the whole list — a reviewer
  // working down a long class shouldn't lose their scroll position on every save.
  const patchRow = (updated) => {
    setData((d) => {
      if (!d) return d
      const submissions = d.submissions.map((s) => (s._id === updated._id ? updated : s))
      const counts = {
        total: submissions.length,
        pending: submissions.filter((s) => s.status !== 'reviewed').length,
        reviewed: submissions.filter((s) => s.status === 'reviewed').length,
      }
      onCountsChange?.(counts)
      return { ...d, submissions, counts }
    })
  }

  const rows = (data?.submissions || []).filter((s) => {
    if (filter === 'pending')  return s.status !== 'reviewed'
    if (filter === 'reviewed') return s.status === 'reviewed'
    return true
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      {/* colorScheme light: white card, so native inputs must not follow an OS
          dark theme — that renders their text white-on-white. */}
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col"
        style={{ colorScheme: 'light' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900">Submissions</p>
            <p className="text-xs text-gray-400 truncate">{title}</p>
          </div>
          <div className="flex items-center gap-2">
            {!!data?.counts?.total && (
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {[
                  { k: 'all', label: `All ${data.counts.total}` },
                  { k: 'pending', label: `Pending ${data.counts.pending}` },
                  { k: 'reviewed', label: `Done ${data.counts.reviewed}` },
                ].map((f) => (
                  <button key={f.k} onClick={() => setFilter(f.k)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition ${
                      filter === f.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

          {data === null ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
          ) : !data.submissions.length ? (
            <div className="text-center py-8">
              <p className="text-gray-700 font-semibold mb-1">Nothing submitted yet</p>
              <p className="text-gray-400 text-sm">
                Work students hand in during the class — voice notes, videos, PDFs, photos — shows up here.
              </p>
            </div>
          ) : !rows.length ? (
            <p className="text-sm text-gray-400 text-center py-8">Nothing in this filter.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((s) => (
                <SubmissionRow
                  key={s._id}
                  submission={s}
                  open={openId === s._id}
                  onToggle={() => setOpenId(openId === s._id ? null : s._id)}
                  apiFetch={apiFetch}
                  basePath={basePath}
                  classId={classId}
                  btn={btn}
                  onUpdated={patchRow}
                  onError={setError}
                />
              ))}
            </div>
          )}
        </div>

        {!!data?.counts?.total && (
          <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-x-6 gap-y-1.5 text-xs bg-gray-50 rounded-b-2xl flex-shrink-0">
            <span className="text-gray-500">Submissions <b className="text-gray-900">{data.counts.total}</b></span>
            <span className="text-gray-500">Awaiting review <b className="text-amber-600">{data.counts.pending}</b></span>
            <span className="text-gray-500">Reviewed <b className="text-emerald-700">{data.counts.reviewed}</b></span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Review validation ──
// Same limits the server enforces (server/controllers/classSubmissionController.js
// parseMarks / reviewSubmission / reviewSubmissionFile) — checked here first so
// the reason shows next to the field instead of after a failed save.
const MAX_TOTAL_MARKS   = 1000
const MAX_OVERALL_NOTES = 4000
const MAX_FILE_NOTES    = 2000
const MIN_CHANGES_NOTE  = 5
const MAX_REVIEW_FILES  = 5

// What a marks box accepts while typing: up to 4 digits, one dot, 2 decimals.
// A minus sign, "e" or letters simply don't go in.
const NUM_TYPING = /^\d{0,4}(\.\d{0,2})?$/
const acceptNum = (v) => {
  const t = String(v).replace(',', '.').trim()
  return NUM_TYPING.test(t) ? t : null
}
const str = (v) => (v == null ? '' : String(v))
const round2 = (n) => Math.round(n * 100) / 100
// Is the typed text the same NUMBER as the saved value? "7.50" over a saved 7.5
// is not an unsaved change.
const sameNum = (txt, v) => (txt === '' ? v == null : v != null && Number(txt) === Number(v))

// Problems with a marks / "out of" pair → { marks?, total? }.
// `finishing`: the score becomes final, where "out of" without marks isn't allowed.
function validateMarks(marks, total, { finishing = false } = {}) {
  const errs = {}
  const m = marks === '' ? null : Number(marks)
  const t = total === '' ? null : Number(total)
  if (m != null && !Number.isFinite(m)) errs.marks = 'Marks must be a number'
  if (t != null) {
    if (!Number.isFinite(t)) errs.total = '"Out of" must be a number'
    else if (t <= 0) errs.total = '"Out of" must be more than 0'
    else if (t > MAX_TOTAL_MARKS) errs.total = `"Out of" can be at most ${MAX_TOTAL_MARKS}`
  }
  if (!errs.marks && !errs.total) {
    if (m != null && t == null) errs.total = 'Enter what the marks are out of'
    else if (m != null && m > t) errs.marks = `Marks can't be more than ${t}`
    else if (finishing && t != null && m == null) errs.marks = 'Enter the marks, or clear "out of"'
  }
  return errs
}

const inputCls = (err, w = 'w-20') => `mt-0.5 ${w} text-sm text-gray-900 bg-white border rounded-lg px-2 py-1.5 focus:outline-none ${
  err ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-teal-400'}`

// One student's submission: a collapsed header row that expands into the files
// (inline audio/video, open-in-tab for the rest), the student's note and the
// review form. Exported so the per-class submissions PAGE
// (pages/mentor/MentorClassSubmissionsPage.jsx) renders the exact same row as
// this modal — one reviewed implementation, not two drifting copies.
//   extraChips    — optional nodes shown beside the status chip (e.g. "in room").
//   standalone    — always expanded, header not a toggle (the page's detail pane).
//   onDirtyChange — (submissionId, bool) unsaved typing, so the page can warn
//                   before switching student / leaving.
//   onNotice      — (message) after a successful save, for a page-level toast.
export function SubmissionRow({
  submission: s, open, onToggle, apiFetch, basePath, classId, btn, onUpdated,
  onDirtyChange, onNotice, extraChips = null, standalone = false,
}) {
  const isOpen = standalone || open
  const Header = standalone ? 'div' : 'button'
  const [marks, setMarks]         = useState(str(s.marks))
  const [totalMarks, setTotal]    = useState(str(s.totalMarks))
  const [notes, setNotes]         = useState(s.mentorNotes || '')
  const [saving, setSaving]       = useState(false)
  const [preview, setPreview]     = useState(null)  // { key, url, kind, name }
  const [uploading, setUploading] = useState(false)
  const [touched, setTouched]     = useState(false) // show marks errors after blur / a save attempt
  const [formError, setFormError] = useState('')
  const [notesError, setNotesError] = useState('')
  const [fileError, setFileError] = useState('')
  const [notice, setNotice]       = useState('')
  const [confirmBare, setConfirmBare] = useState(false)
  // Keys of files whose own review form is open. A Set, not one key: a
  // reviewer may grade two files side by side without losing typed marks.
  const [openFiles, setOpenFiles] = useState(() => new Set())
  // Keys of open file forms holding unsaved typing.
  const [dirtyFiles, setDirtyFiles] = useState(() => new Set())
  const toggleFileReview = (key) => setOpenFiles((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const markFileDirty = useCallback((key, dirty) => setDirtyFiles((prev) => {
    if (prev.has(key) === dirty) return prev
    const next = new Set(prev)
    if (dirty) next.add(key); else next.delete(key)
    return next
  }), [])
  const fileRef = useRef(null)
  const notesRef = useRef(null)

  // Adopt server values only when the SERVER's copy actually changed — not on
  // every re-render of this row.
  //
  // Attaching a corrected file re-saves the submission and hands back a fresh
  // object whose mentorNotes are whatever was last stored. Blindly copying that
  // into the inputs would silently erase marks and feedback the reviewer had
  // typed but not yet saved. Comparing against the last value we took from the
  // server distinguishes "the server changed this" from "this row re-rendered".
  const lastServer = useRef({ marks: s.marks, totalMarks: s.totalMarks, mentorNotes: s.mentorNotes })
  useEffect(() => {
    const prev = lastServer.current
    if (prev.marks !== s.marks)             setMarks(str(s.marks))
    if (prev.totalMarks !== s.totalMarks)   setTotal(str(s.totalMarks))
    if (prev.mentorNotes !== s.mentorNotes) setNotes(s.mentorNotes || '')
    lastServer.current = { marks: s.marks, totalMarks: s.totalMarks, mentorNotes: s.mentorNotes }
  }, [s.marks, s.totalMarks, s.mentorNotes])

  const dirty = !sameNum(marks, s.marks) || !sameNum(totalMarks, s.totalMarks)
    || notes.trim() !== (s.mentorNotes || '').trim() || dirtyFiles.size > 0
  useEffect(() => { onDirtyChange?.(s._id, dirty) }, [onDirtyChange, s._id, dirty])
  useEffect(() => () => onDirtyChange?.(s._id, false), [onDirtyChange, s._id])

  useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(t)
  }, [notice])

  const chip = STATUS_CHIP[s.status] || STATUS_CHIP.submitted
  const marksErrs = touched ? validateMarks(marks, totalMarks) : {}

  // Per-file grading rolled up: how many pieces are done, and what the marks
  // add up to — offered as the overall score with one click ("Use total").
  const gradedFiles = s.files.filter((f) => f.review)
  const markedFiles = gradedFiles.filter((f) => f.review.marks != null)
  const filesMarks  = round2(markedFiles.reduce((a, f) => a + f.review.marks, 0))
  const filesTotal  = markedFiles.length && markedFiles.every((f) => f.review.totalMarks != null)
    ? round2(markedFiles.reduce((a, f) => a + f.review.totalMarks, 0)) : null
  const allGraded = s.files.length > 0 && gradedFiles.length === s.files.length
  const anyFileFeedback = gradedFiles.some((f) => f.review.marks != null || f.review.notes)

  // What the student confirmed this submission is for — shown on the row so the
  // reviewer can tell the chapter at a glance.
  const workLabel = [s.subject?.name, s.chapter?.name, s.unit?.name].filter(Boolean).join(' · ')
  // A file confirmed for a DIFFERENT subject/chapter than the submission's
  // latest pick gets its own chip — one class can collect work for two papers.
  const fileWorkLabel = (f) => {
    if (!f.chapter?.name) return null
    const subjectDiffers = String(f.subject?.subjectId || '') !== String(s.subject?.subjectId || '')
    const differs = subjectDiffers ||
      String(f.chapter.chapterId || '') !== String(s.chapter?.chapterId || '') ||
      String(f.unit?.unitId || '') !== String(s.unit?.unitId || '')
    if (!differs) return null
    return [subjectDiffers ? f.subject?.name : null, f.chapter.name, f.unit?.name].filter(Boolean).join(' · ')
  }

  const fileUrl = async (key, download = false) => {
    const d = await apiFetch(
      `${basePath}/${classId}/submissions/${s._id}/file?key=${encodeURIComponent(key)}${download ? '&download=1' : ''}`,
    )
    return d
  }

  // Audio and video play inline — a mentor reviewing 30 voice notes shouldn't
  // have to open 30 browser tabs. Everything else opens in a new tab.
  const openFile = async (f) => {
    setFileError('')
    try {
      if (f.kind === 'audio' || f.kind === 'video') {
        if (preview?.key === f.key) { setPreview(null); return }
        const d = await fileUrl(f.key)
        setPreview({ key: f.key, url: d.url, kind: f.kind, name: f.name })
      } else {
        const d = await fileUrl(f.key)
        window.open(d.url, '_blank', 'noopener')
      }
    } catch (e) {
      setFileError(`Couldn't open "${f.name}". ${e.message || 'Try again.'}`)
    }
  }

  const download = async (f) => {
    setFileError('')
    try {
      const d = await fileUrl(f.key, true)
      window.open(d.url, '_blank', 'noopener')
    } catch (e) {
      setFileError(`Couldn't download "${f.name}". ${e.message || 'Try again.'}`)
    }
  }

  // status: 'reviewed' | 'changes_requested' | null (draft)
  const save = async (status, { skipBareCheck = false } = {}) => {
    if (saving || uploading) return
    setFormError(''); setNotesError(''); setNotice('')
    setTouched(true)
    const errs = validateMarks(marks, totalMarks, { finishing: status === 'reviewed' })
    if (errs.marks || errs.total) { setFormError(errs.marks || errs.total); return }
    const cleanNotes = notes.trim()
    if (status === 'changes_requested' && cleanNotes.length < MIN_CHANGES_NOTE) {
      setNotesError('Write what the student should change — they will see this.')
      notesRef.current?.focus()
      return
    }
    if (status && dirtyFiles.size) {
      const names = s.files.filter((f) => dirtyFiles.has(f.key)).map((f) => `"${f.name}"`).join(', ')
      setFormError(`Marks typed for ${names} are not saved yet — press Save on that file, or Cancel.`)
      return
    }
    if (status === 'reviewed' && !skipBareCheck && marks === '' && !cleanNotes && !anyFileFeedback && !s.mentorFiles.length) {
      setConfirmBare(true)
      return
    }
    setConfirmBare(false)
    setSaving(true)
    try {
      const d = await apiFetch(`${basePath}/${classId}/submissions/${s._id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          marks: marks === '' ? null : Number(marks),
          totalMarks: totalMarks === '' ? null : Number(totalMarks),
          mentorNotes: cleanNotes,
          ...(status ? { status } : {}),
        }),
      })
      const who = s.studentName || 'the student'
      const msg = status === 'reviewed' ? `Marked reviewed — ${who} can see it now.`
        : status === 'changes_requested' ? `Sent back to ${who} for changes.`
          : 'Draft saved.'
      setTouched(false)
      setNotice(msg)
      onNotice?.(msg)
      onUpdated(d.submission)
    } catch (e) {
      setFormError(e.message || 'Could not save the review. Check your internet and try again.')
    } finally {
      setSaving(false)
    }
  }

  // Corrected files go back the same way student work comes in: presign → PUT
  // straight to R2 → commit metadata.
  const uploadCorrected = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setFormError('')
    if (s.mentorFiles.length + files.length > MAX_REVIEW_FILES) {
      setFormError(`You can attach at most ${MAX_REVIEW_FILES} corrected files.`)
      return
    }
    setUploading(true)
    try {
      const { uploads } = await apiFetch(`${basePath}/${classId}/submissions/${s._id}/presign-review`, {
        method: 'POST',
        body: JSON.stringify({ files: files.map((f) => ({ name: f.name, contentType: f.type, size: f.size })) }),
      })
      for (let i = 0; i < uploads.length; i++) {
        const res = await fetch(uploads[i].uploadUrl, {
          method: 'PUT',
          headers: files[i].type ? { 'Content-Type': files[i].type } : {},
          body: files[i],
        })
        if (!res.ok) throw new Error(`Upload of "${files[i].name}" failed (${res.status})`)
      }
      const d = await apiFetch(`${basePath}/${classId}/submissions/${s._id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          files: uploads.map((u) => ({ key: u.key, name: u.name, contentType: u.contentType, size: u.size })),
        }),
      })
      onUpdated(d.submission)
    } catch (e) {
      setFormError(e.message || 'Could not upload the file')
    } finally {
      setUploading(false)
    }
  }

  const removeCorrected = async (key) => {
    if (!confirm('Remove this file?')) return
    setFormError('')
    try {
      const d = await apiFetch(`${basePath}/${classId}/submissions/${s._id}/review-file`, {
        method: 'DELETE', body: JSON.stringify({ key }),
      })
      onUpdated(d.submission)
    } catch (e) {
      setFormError(e.message || 'Could not remove the file')
    }
  }

  const busy = saving || uploading

  return (
    <div className={`rounded-xl overflow-hidden ${standalone ? '' : `border ${open ? 'border-gray-300' : 'border-gray-200'}`}`}>
      <Header onClick={standalone ? undefined : onToggle}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left ${standalone ? '' : 'hover:bg-gray-50'}`}>
        {!standalone && <span className="text-gray-400 text-xs">{open ? '▾' : '▸'}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{s.studentName || 'Student'}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${chip.cls}`}>{chip.label}</span>
            {s.submittedDuringClass && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 uppercase"
                title="Handed in while the class was live">in class</span>
            )}
            {extraChips}
          </div>
          {workLabel && (
            <p className="text-[11px] text-indigo-500 truncate mt-0.5" title={workLabel}>📖 {workLabel}</p>
          )}
          <p className="text-[11px] text-gray-400 mt-0.5">
            {s.files.length} file{s.files.length === 1 ? '' : 's'}
            {gradedFiles.length > 0 && (
              <span className={allGraded ? 'text-emerald-600' : 'text-amber-600'}>
                {' '}({gradedFiles.length}/{s.files.length} graded)
              </span>
            )}
            {' · '}{fmtWhen(s.lastFileAt)}
            {s.studentPhone ? ` · ${s.studentPhone}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {s.files.slice(0, 4).map((f) => <span key={f.key} title={f.name}>{KIND_ICON[f.kind] || '📎'}</span>)}
          {s.marks != null && (
            <span className="text-xs font-bold text-gray-900 ml-1">
              {s.marks}{s.totalMarks != null ? `/${s.totalMarks}` : ''}
            </span>
          )}
        </div>
      </Header>

      {isOpen && (
        <div className="px-3 pb-3 border-t border-gray-100 bg-gray-50/60">
          {s.note && (
            <div className="mt-3 rounded-lg bg-white border border-gray-200 p-2.5">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Student's note</p>
              <p className="text-xs text-gray-700 whitespace-pre-wrap [overflow-wrap:anywhere]">{s.note}</p>
            </div>
          )}

          <div className="mt-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[10px] font-bold text-gray-400 uppercase">Submitted work</p>
              {s.files.length > 1 && (
                <p className="text-[10px] text-gray-400">Each file can be graded on its own</p>
              )}
            </div>
            {fileError && <p role="alert" className="text-[11px] text-red-600 mb-1.5">⚠ {fileError}</p>}
            {/* Numbered and spaced, so "the 2nd photo" is easy to point at
                and a spoken item with its question reads as one block. */}
            <div className="space-y-3">
              {s.files.map((f, i) => (
                <div key={f.key}>
                  <div className={`rounded-lg bg-white border ${f.review ? 'border-emerald-200' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <span className="text-[11px] font-bold text-gray-400 w-5 text-right flex-shrink-0">{i + 1}.</span>
                    <span>{KIND_ICON[f.kind] || '📎'}</span>
                    {f.kind === 'verbal' ? (
                      // Explained to the mentor out loud — nothing to open.
                      <span className="text-xs text-gray-900 font-medium truncate flex-1"
                        title={`Marked by ${f.verbal?.markedBy?.name || 'the mentor'}, confirmed by the student ${fmtWhen(f.verbal?.confirmedAt)}`}>
                        {f.name}
                      </span>
                    ) : (
                      <button onClick={() => openFile(f)} className="text-xs text-gray-900 font-medium truncate flex-1 text-left hover:underline"
                        title={f.kind === 'audio' || f.kind === 'video' ? 'Play' : 'Open in a new tab'}>
                        {f.name}
                      </button>
                    )}
                    {f.kind === 'verbal' ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 uppercase flex-shrink-0"
                        title={`Marked by ${f.verbal?.markedBy?.name || 'the mentor'} · confirmed by the student ${fmtWhen(f.verbal?.confirmedAt)}${f.verbal?.recordingOffsetMs != null ? ` · ${fmtOffset(f.verbal.recordingOffsetMs)} into the recording` : ''}`}>
                        Spoken in class{f.verbal?.recordingOffsetMs != null ? ` · ${fmtOffset(f.verbal.recordingOffsetMs)}` : ''}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400 flex-shrink-0">
                        {f.durationMs ? fmtClock(f.durationMs) : fmtBytes(f.size)}
                      </span>
                    )}
                    {f.recorded && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 uppercase flex-shrink-0"
                        title="Recorded in the app during class">rec</span>
                    )}
                    {fileWorkLabel(f) && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 flex-shrink-0 max-w-[130px] truncate"
                        title={`Student marked this file for: ${fileWorkLabel(f)}`}>📖 {fileWorkLabel(f)}</span>
                    )}
                    {/* This file's own grade: a green score once saved, a
                        "Review" button until then. Either opens the form. */}
                    <button
                      onClick={() => toggleFileReview(f.key)}
                      aria-pressed={openFiles.has(f.key)}
                      title={f.review
                        ? `Reviewed ${fmtWhen(f.review.reviewedAt)}${f.review.reviewedBy?.name ? ` by ${f.review.reviewedBy.name}` : ''} — click to edit`
                        : 'Give this file its own marks and feedback'}
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                        f.review
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : openFiles.has(f.key)
                            ? 'bg-teal-600 text-white'
                            : 'border border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                    >
                      {f.review
                        ? `✓ ${f.review.marks != null ? `${f.review.marks}${f.review.totalMarks != null ? `/${f.review.totalMarks}` : ''}` : 'Reviewed'}`
                        : openFiles.has(f.key) ? 'Close' : 'Review'}
                    </button>
                    {f.kind !== 'verbal' && (
                      <button onClick={() => download(f)} title="Download"
                        className="text-gray-400 hover:text-gray-700 text-xs flex-shrink-0">⤓</button>
                    )}
                  </div>
                  {/* The mentor's note from "Heard in class" — usually the
                      question the student answered out loud. */}
                  {f.kind === 'verbal' && f.verbal?.note && (
                    <p className="mx-2.5 mb-2 -mt-0.5 ml-[3.25rem] px-2 py-1 rounded bg-amber-50 text-[11px] text-amber-900 whitespace-pre-wrap">
                      <span className="font-semibold">Mentor's question:</span> {f.verbal.note}
                    </p>
                  )}
                  </div>
                  {preview?.key === f.key && (
                    <div className="mt-1.5 px-2.5 py-2 rounded-lg bg-black/5">
                      {preview.kind === 'audio'
                        ? <audio src={preview.url} controls autoPlay className="w-full" />
                        : <video src={preview.url} controls autoPlay playsInline className="w-full rounded-lg bg-black max-h-64" />}
                    </div>
                  )}
                  {/* Saved feedback stays readable under the file; the form
                      replaces it while open. */}
                  {f.review?.notes && !openFiles.has(f.key) && (
                    <p className="mt-1 ml-6 text-[11px] text-emerald-800 whitespace-pre-wrap [overflow-wrap:anywhere]">💬 {f.review.notes}</p>
                  )}
                  {openFiles.has(f.key) && (
                    <FileReview
                      file={f}
                      submission={s}
                      apiFetch={apiFetch}
                      basePath={basePath}
                      classId={classId}
                      btn={btn}
                      onUpdated={onUpdated}
                      onDirtyChange={markFileDirty}
                      onClose={() => toggleFileReview(f.key)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Overall review */}
          <div className="mt-4 rounded-lg bg-white border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase">Overall review</p>
              {markedFiles.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500">
                    Files add up to <b className="text-gray-900">{filesMarks}{filesTotal != null ? ` / ${filesTotal}` : ''}</b>
                    {' '}({markedFiles.length} of {s.files.length} marked)
                  </span>
                  <button type="button" disabled={busy}
                    onClick={() => { setMarks(str(filesMarks)); setTotal(str(filesTotal)); setTouched(true); setFormError('') }}
                    title="Copy the files' total into the overall marks"
                    className="text-[10px] font-semibold px-2 py-0.5 rounded border border-teal-200 text-teal-700 hover:bg-teal-50 disabled:opacity-50">
                    Use total
                  </button>
                </div>
              )}
            </div>
            {allGraded && s.status !== 'reviewed' && (
              <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 mb-2">
                Every file is graded — press <b>Mark reviewed</b> to finish this submission.
              </p>
            )}

            <div className="mb-2.5">
              <div className="flex items-end gap-2">
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold" htmlFor={`m-${s._id}`}>Marks</label>
                  <input id={`m-${s._id}`} type="text" inputMode="decimal" autoComplete="off" value={marks}
                    onChange={(e) => { const v = acceptNum(e.target.value); if (v !== null) { setMarks(v); setFormError(''); setConfirmBare(false) } }}
                    onBlur={() => setTouched(true)} aria-invalid={!!marksErrs.marks}
                    placeholder="—" disabled={busy} className={`block ${inputCls(marksErrs.marks)}`} />
                </div>
                <span className="text-gray-300 pb-2">/</span>
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold" htmlFor={`t-${s._id}`}>Out of</label>
                  <input id={`t-${s._id}`} type="text" inputMode="decimal" autoComplete="off" value={totalMarks}
                    onChange={(e) => { const v = acceptNum(e.target.value); if (v !== null) { setTotal(v); setFormError('') } }}
                    onBlur={() => setTouched(true)} aria-invalid={!!marksErrs.total}
                    placeholder="—" disabled={busy} className={`block ${inputCls(marksErrs.total)}`} />
                </div>
              </div>
              {(marksErrs.marks || marksErrs.total) && (
                <p role="alert" className="text-[11px] text-red-600 mt-1">⚠ {marksErrs.marks || marksErrs.total}</p>
              )}
            </div>

            <textarea ref={notesRef} value={notes} rows={2} maxLength={MAX_OVERALL_NOTES} disabled={busy}
              onChange={(e) => { setNotes(e.target.value); setNotesError(''); setConfirmBare(false) }}
              aria-invalid={!!notesError}
              placeholder={gradedFiles.length ? 'Overall feedback for the student (each file has its own above)…' : 'Feedback for the student…'}
              className={`w-full text-sm text-gray-900 bg-white border rounded-lg px-2.5 py-2 focus:outline-none disabled:bg-gray-50 ${
                notesError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-teal-400'}`} />
            {notesError && <p role="alert" className="text-[11px] text-red-600 mt-0.5">⚠ {notesError}</p>}

            {/* Corrected files back to the student */}
            <div className="mt-2.5">
              <input ref={fileRef} type="file" multiple accept={REVIEW_ACCEPT} className="hidden"
                onChange={(e) => { uploadCorrected(e.target.files); e.target.value = '' }} />
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => fileRef.current?.click()} disabled={busy || s.mentorFiles.length >= MAX_REVIEW_FILES}
                  title={s.mentorFiles.length >= MAX_REVIEW_FILES ? `At most ${MAX_REVIEW_FILES} files` : 'Send a marked-up copy back to the student'}
                  className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  {uploading ? 'Uploading…' : '+ Attach corrected file'}
                </button>
                {s.mentorFiles.map((f) => (
                  <span key={f.key} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200">
                    <span className="truncate max-w-[140px]">{f.name}</span>
                    <button onClick={() => removeCorrected(f.key)} className="text-indigo-400 hover:text-red-500">×</button>
                  </span>
                ))}
              </div>
            </div>

            {confirmBare && (
              <div role="alert" className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11px] text-amber-900">
                No marks or feedback yet — the student will only see "Reviewed".
                <div className="flex gap-2 mt-1.5">
                  <button type="button" onClick={() => save('reviewed', { skipBareCheck: true })} disabled={busy}
                    className="px-2.5 py-1 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50">
                    Mark reviewed anyway
                  </button>
                  <button type="button" onClick={() => { setConfirmBare(false); notesRef.current?.focus() }}
                    className="px-2.5 py-1 rounded border border-amber-300 font-semibold hover:bg-amber-100">
                    Add feedback
                  </button>
                </div>
              </div>
            )}
            {formError && (
              <p role="alert" className="mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">⚠ {formError}</p>
            )}

            <div className="flex gap-2 mt-3 flex-wrap">
              <button onClick={() => save('reviewed')} disabled={busy}
                title="Finish — the student sees the marks and feedback"
                className={`px-3 py-2 rounded-lg ${btn} text-white text-xs font-semibold disabled:bg-gray-300`}>
                {saving ? 'Saving…' : '✓ Mark reviewed'}
              </button>
              {s.status === 'submitted' && (
                <button onClick={() => save(null)} disabled={busy}
                  title="Save without sending — the student can't see it yet"
                  className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">
                  Save draft
                </button>
              )}
              <button onClick={() => save('changes_requested')} disabled={busy}
                title="Send it back — the student sees your feedback and can add or replace files"
                className="px-3 py-2 rounded-lg border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50 disabled:opacity-50">
                Ask for changes
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              {s.status === 'submitted' && 'Save draft keeps your overall marks and feedback hidden from the student. '}
              "Ask for changes" needs feedback so the student knows what to fix.
            </p>

            <div className="flex items-center gap-3 flex-wrap mt-1">
              {s.reviewedAt && (
                <p className="text-[10px] text-gray-400">
                  Reviewed {fmtWhen(s.reviewedAt)}{s.reviewedBy?.name ? ` by ${s.reviewedBy.name}` : ''}
                </p>
              )}
              {dirty && !saving && <span className="text-[10px] font-semibold text-amber-700">● Unsaved changes</span>}
              {notice && <span role="status" className="text-[11px] font-semibold text-emerald-700">✓ {notice}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Marks and feedback for ONE file of a submission — a student's photo of
// question 3, say, graded apart from their voice note for question 4. Saves
// through the file-review endpoint, which hands back the whole submission so
// the parent row (and the page's list) update in one go. Leaving every field
// empty and saving clears the file's review.
function FileReview({ file: f, submission: s, apiFetch, basePath, classId, btn, onUpdated, onDirtyChange, onClose }) {
  const r = f.review || {}
  const [marks, setMarks] = useState(str(r.marks))
  const [total, setTotal] = useState(str(r.totalMarks))
  const [notes, setNotes] = useState(r.notes || '')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState('')

  // Same rule as the overall form: adopt server values only when THEY changed,
  // never on a mere re-render, so typed-but-unsaved marks survive a refresh.
  const lastServer = useRef({ marks: r.marks, totalMarks: r.totalMarks, notes: r.notes })
  useEffect(() => {
    const prev = lastServer.current
    if (prev.marks !== r.marks)           setMarks(str(r.marks))
    if (prev.totalMarks !== r.totalMarks) setTotal(str(r.totalMarks))
    if (prev.notes !== r.notes)           setNotes(r.notes || '')
    lastServer.current = { marks: r.marks, totalMarks: r.totalMarks, notes: r.notes }
  }, [r.marks, r.totalMarks, r.notes])

  const dirty = !sameNum(marks, r.marks) || !sameNum(total, r.totalMarks) || notes.trim() !== (r.notes || '').trim()
  useEffect(() => { onDirtyChange?.(f.key, dirty) }, [onDirtyChange, f.key, dirty])
  useEffect(() => () => onDirtyChange?.(f.key, false), [onDirtyChange, f.key])

  const errs = validateMarks(marks, total, { finishing: true })
  const shown = touched ? errs : {}

  const save = async () => {
    if (saving) return
    setTouched(true)
    if (errs.marks || errs.total) return
    setSaving(true)
    setError('')
    try {
      const d = await apiFetch(`${basePath}/${classId}/submissions/${s._id}/file-review`, {
        method: 'POST',
        body: JSON.stringify({
          key: f.key,
          marks: marks === '' ? null : Number(marks),
          totalMarks: total === '' ? null : Number(total),
          notes: notes.trim(),
        }),
      })
      onUpdated(d.submission)
      onClose?.()
    } catch (e) {
      setError(e.message || 'Could not save the review')
    } finally {
      setSaving(false)
    }
  }

  const empty = marks === '' && total === '' && !notes.trim()

  return (
    <div className="mt-1.5 ml-6 rounded-lg bg-white border border-teal-200 p-2.5">
      <p className="text-[10px] font-bold text-teal-700 uppercase mb-1.5 truncate" title={f.name}>
        Review · {f.name}
      </p>
      <div className="mb-2">
        <div className="flex items-end gap-2">
          <div>
            <label className="text-[10px] text-gray-400 font-semibold" htmlFor={`fm-${s._id}-${f.key}`}>Marks</label>
            <input id={`fm-${s._id}-${f.key}`} type="text" inputMode="decimal" autoComplete="off" value={marks}
              onChange={(e) => { const v = acceptNum(e.target.value); if (v !== null) { setMarks(v); setError('') } }}
              onBlur={() => setTouched(true)} aria-invalid={!!shown.marks}
              placeholder="—" disabled={saving} className={`block ${inputCls(shown.marks, 'w-16')}`} />
          </div>
          <span className="text-gray-300 pb-2">/</span>
          <div>
            <label className="text-[10px] text-gray-400 font-semibold" htmlFor={`ft-${s._id}-${f.key}`}>Out of</label>
            <input id={`ft-${s._id}-${f.key}`} type="text" inputMode="decimal" autoComplete="off" value={total}
              onChange={(e) => { const v = acceptNum(e.target.value); if (v !== null) { setTotal(v); setError('') } }}
              onBlur={() => setTouched(true)} aria-invalid={!!shown.total}
              placeholder="—" disabled={saving} className={`block ${inputCls(shown.total, 'w-16')}`} />
          </div>
        </div>
        {(shown.marks || shown.total) && (
          <p role="alert" className="text-[11px] text-red-600 mt-1">⚠ {shown.marks || shown.total}</p>
        )}
      </div>
      <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setError('') }} rows={2} maxLength={MAX_FILE_NOTES} disabled={saving}
        placeholder="Feedback on this file…"
        className="w-full text-sm text-gray-900 bg-white border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-teal-400 disabled:bg-gray-50" />
      {error && <p role="alert" className="text-[11px] text-red-600 mt-0.5">⚠ {error}</p>}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button onClick={save} disabled={saving || (empty && !f.review)}
          className={`px-3 py-1.5 rounded-lg ${btn} text-white text-xs font-semibold disabled:bg-gray-300`}>
          {saving ? 'Saving…' : empty && f.review ? 'Clear review' : '✓ Save'}
        </button>
        <button onClick={onClose} disabled={saving}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">
          Cancel
        </button>
        {r.reviewedAt && (
          <span className="text-[10px] text-gray-400">
            Reviewed {fmtWhen(r.reviewedAt)}{r.reviewedBy?.name ? ` by ${r.reviewedBy.name}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
