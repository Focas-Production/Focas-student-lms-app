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

const KIND_ICON = { audio: '🎙', video: '🎬', pdf: '📕', image: '🖼', doc: '📄', other: '📎' }

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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
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

function SubmissionRow({ submission: s, open, onToggle, apiFetch, basePath, classId, btn, onUpdated, onError }) {
  const [marks, setMarks]         = useState(s.marks ?? '')
  const [totalMarks, setTotal]    = useState(s.totalMarks ?? '')
  const [notes, setNotes]         = useState(s.mentorNotes || '')
  const [saving, setSaving]       = useState(false)
  const [preview, setPreview]     = useState(null)  // { key, url, kind, name }
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

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
    if (prev.marks !== s.marks)             setMarks(s.marks ?? '')
    if (prev.totalMarks !== s.totalMarks)   setTotal(s.totalMarks ?? '')
    if (prev.mentorNotes !== s.mentorNotes) setNotes(s.mentorNotes || '')
    lastServer.current = { marks: s.marks, totalMarks: s.totalMarks, mentorNotes: s.mentorNotes }
  }, [s.marks, s.totalMarks, s.mentorNotes])

  const chip = STATUS_CHIP[s.status] || STATUS_CHIP.submitted

  const fileUrl = async (key, download = false) => {
    const d = await apiFetch(
      `${basePath}/${classId}/submissions/${s._id}/file?key=${encodeURIComponent(key)}${download ? '&download=1' : ''}`,
    )
    return d
  }

  // Audio and video play inline — a mentor reviewing 30 voice notes shouldn't
  // have to open 30 browser tabs. Everything else opens in a new tab.
  const openFile = async (f) => {
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
      onError?.(e.message || 'Could not open the file')
    }
  }

  const download = async (f) => {
    try {
      const d = await fileUrl(f.key, true)
      window.open(d.url, '_blank', 'noopener')
    } catch (e) {
      onError?.(e.message || 'Could not download the file')
    }
  }

  const save = async (status) => {
    setSaving(true)
    onError?.('')
    try {
      const d = await apiFetch(`${basePath}/${classId}/submissions/${s._id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          marks: marks === '' ? null : Number(marks),
          totalMarks: totalMarks === '' ? null : Number(totalMarks),
          mentorNotes: notes,
          ...(status ? { status } : {}),
        }),
      })
      onUpdated(d.submission)
    } catch (e) {
      onError?.(e.message || 'Could not save the review')
    } finally {
      setSaving(false)
    }
  }

  // Corrected files go back the same way student work comes in: presign → PUT
  // straight to R2 → commit metadata.
  const uploadCorrected = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setUploading(true)
    onError?.('')
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
        if (!res.ok) throw new Error(`Upload failed (${res.status})`)
      }
      const d = await apiFetch(`${basePath}/${classId}/submissions/${s._id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          files: uploads.map((u) => ({ key: u.key, name: u.name, contentType: u.contentType, size: u.size })),
        }),
      })
      onUpdated(d.submission)
    } catch (e) {
      onError?.(e.message || 'Could not upload the file')
    } finally {
      setUploading(false)
    }
  }

  const removeCorrected = async (key) => {
    if (!confirm('Remove this file?')) return
    try {
      const d = await apiFetch(`${basePath}/${classId}/submissions/${s._id}/review-file`, {
        method: 'DELETE', body: JSON.stringify({ key }),
      })
      onUpdated(d.submission)
    } catch (e) {
      onError?.(e.message || 'Could not remove the file')
    }
  }

  return (
    <div className={`rounded-xl border ${open ? 'border-gray-300' : 'border-gray-200'} overflow-hidden`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
        <span className="text-gray-400 text-xs">{open ? '▾' : '▸'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{s.studentName || 'Student'}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${chip.cls}`}>{chip.label}</span>
            {s.submittedDuringClass && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 uppercase"
                title="Handed in while the class was live">in class</span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {s.files.length} file{s.files.length === 1 ? '' : 's'}
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
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-gray-100 bg-gray-50/60">
          {s.note && (
            <div className="mt-3 rounded-lg bg-white border border-gray-200 p-2.5">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Student's note</p>
              <p className="text-xs text-gray-700 whitespace-pre-wrap">{s.note}</p>
            </div>
          )}

          <div className="mt-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Submitted work</p>
            <div className="space-y-1.5">
              {s.files.map((f) => (
                <div key={f.key}>
                  <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white border border-gray-200">
                    <span>{KIND_ICON[f.kind] || '📎'}</span>
                    <button onClick={() => openFile(f)} className="text-xs text-gray-900 font-medium truncate flex-1 text-left hover:underline">
                      {f.name}
                    </button>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                      {f.durationMs ? fmtClock(f.durationMs) : fmtBytes(f.size)}
                    </span>
                    {f.recorded && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 uppercase flex-shrink-0"
                        title="Recorded in the app during class">rec</span>
                    )}
                    <button onClick={() => download(f)} title="Download"
                      className="text-gray-400 hover:text-gray-700 text-xs flex-shrink-0">⤓</button>
                  </div>
                  {preview?.key === f.key && (
                    <div className="mt-1.5 px-2.5 py-2 rounded-lg bg-black/5">
                      {preview.kind === 'audio'
                        ? <audio src={preview.url} controls autoPlay className="w-full" />
                        : <video src={preview.url} controls autoPlay playsInline className="w-full rounded-lg bg-black max-h-64" />}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Review */}
          <div className="mt-4 rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Your review</p>

            <div className="flex items-end gap-2 mb-2.5">
              <div>
                <label className="text-[10px] text-gray-400 font-semibold">Marks</label>
                <input type="number" min="0" step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)}
                  placeholder="—" disabled={saving}
                  className="mt-0.5 w-20 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-teal-400" />
              </div>
              <span className="text-gray-300 pb-2">/</span>
              <div>
                <label className="text-[10px] text-gray-400 font-semibold">Out of</label>
                <input type="number" min="1" step="0.5" value={totalMarks} onChange={(e) => setTotal(e.target.value)}
                  placeholder="—" disabled={saving}
                  className="mt-0.5 w-20 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-teal-400" />
              </div>
            </div>

            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={4000} disabled={saving}
              placeholder="Feedback for the student…"
              className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-teal-400 disabled:bg-gray-50" />

            {/* Corrected files back to the student */}
            <div className="mt-2.5">
              <input ref={fileRef} type="file" multiple accept={REVIEW_ACCEPT} className="hidden"
                onChange={(e) => { uploadCorrected(e.target.files); e.target.value = '' }} />
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => fileRef.current?.click()} disabled={uploading || saving}
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

            <div className="flex gap-2 mt-3 flex-wrap">
              <button onClick={() => save('reviewed')} disabled={saving}
                className={`px-3 py-2 rounded-lg ${btn} text-white text-xs font-semibold disabled:bg-gray-300`}>
                {saving ? 'Saving…' : '✓ Mark reviewed'}
              </button>
              <button onClick={() => save(null)} disabled={saving}
                className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">
                Save draft
              </button>
              <button onClick={() => save('changes_requested')} disabled={saving}
                title="Send it back so the student can add or replace files"
                className="px-3 py-2 rounded-lg border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50 disabled:opacity-50">
                Ask for changes
              </button>
            </div>

            {s.reviewedAt && (
              <p className="text-[10px] text-gray-400 mt-2">
                Reviewed {fmtWhen(s.reviewedAt)}{s.reviewedBy?.name ? ` by ${s.reviewedBy.name}` : ''}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
