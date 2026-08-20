import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api'
import useMediaRecorder, { isRecordingSupported } from '../hooks/useMediaRecorder'

// Hand work in for a live class: record a voice note or a video answer right
// here, or attach files from the device. Used in two places with the same code:
//
//   • inside the LiveKit room overlay while the class is running (`embedded`),
//     where it must render above a fixed full-screen video stage; and
//   • from the class card on the Live Classes page, for finishing up inside the
//     after-class window.
//
// Uploads go browser → R2 directly on a presigned URL; only metadata is posted
// back to our server. That's what makes a 200 MB video answer viable.
//
// `cameraControls` (optional, supplied only in-room) lets the panel hand the
// camera back to the browser before recording and restore the class video after.
// On mobile only one consumer can hold the camera, so without this a video
// recording either fails outright or kills the student's class video.

const MAX_FILES = 8
const LIMITS = {           // mirrors MAX_BYTES in classSubmissionController.js
  audio: 25 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  image: 15 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  doc: 25 * 1024 * 1024,
  other: 15 * 1024 * 1024,
}
const MAX_VIDEO_MS = 15 * 60 * 1000
const MAX_AUDIO_MS = 10 * 60 * 1000

// What the file picker offers. Deliberately broad — a student hands in whatever
// they have — but still an allow-list, matching the server's.
const ACCEPT = [
  'audio/*', 'video/*', 'image/*', 'application/pdf',
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.rtf', '.txt', '.csv', '.zip',
].join(',')

const KIND_BY_EXT = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', ppt: 'doc', pptx: 'doc', xls: 'doc', xlsx: 'doc',
  odt: 'doc', rtf: 'doc', txt: 'doc', csv: 'doc',
  zip: 'other',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', heic: 'image', heif: 'image', gif: 'image',
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', aac: 'audio', amr: 'audio',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', '3gp': 'video',
}

// Some browsers report an empty type for files picked from cloud storage, so
// fall back to the extension rather than rejecting a legitimate document.
function kindOf(file) {
  const t = (file.type || '').split(';')[0].toLowerCase()
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('image/')) return 'image'
  if (t === 'application/pdf') return 'pdf'
  const ext = (file.name || '').split('.').pop()?.toLowerCase()
  return KIND_BY_EXT[ext] || 'other'
}

// The server keys its allow-list on content type, so a file the browser typed as
// '' needs one inferred before it's sent.
const EXT_TYPE = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', gif: 'image/gif',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', amr: 'audio/amr',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
}
function typeOf(file) {
  const t = (file.type || '').split(';')[0].toLowerCase()
  if (t) return t
  const ext = (file.name || '').split('.').pop()?.toLowerCase()
  return EXT_TYPE[ext] || ''
}

const fmtBytes = (b) => {
  if (!b) return '0 KB'
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}
const fmtClock = (ms) => {
  const s = Math.floor((ms || 0) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const KIND_ICON = { audio: '🎙', video: '🎬', pdf: '📕', image: '🖼', doc: '📄', other: '📎' }

// PUT straight to R2 with progress. XHR rather than fetch because upload
// progress is the whole point on a 200 MB video — a spinner with no percentage
// on a slow phone connection reads as "frozen" and students give up on it.
function putToR2(uploadUrl, file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl, true)
    if (file.type) xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'))
    xhr.onabort = () => reject(new Error('Upload cancelled'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}

export default function SubmitWorkPanel({
  classId, classTitle, embedded = false, onClose, onCountChange, cameraControls,
}) {
  const [data, setData]       = useState(null)   // { submission, canSubmit, closedReason }
  const [queue, setQueue]     = useState([])     // staged files not yet uploaded
  const [note, setNote]       = useState('')
  const [busy, setBusy]       = useState(false)
  const [progress, setProgress] = useState(null) // { index, total, pct, name }
  const [error, setError]     = useState('')
  const [okMsg, setOkMsg]     = useState('')
  const [tab, setTab]         = useState('files') // files | voice | video
  const fileInputRef = useRef(null)
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/api/live-classes/${classId}/submissions/mine`)
      setData(d)
      setNote(d.submission?.note || '')
      onCountChange?.(d.submission?.files?.length || 0)
    } catch (e) {
      setError(e.message || 'Could not load your submission')
      setData({ submission: null, canSubmit: false })
    }
  }, [classId, onCountChange])

  useEffect(() => { load() }, [load])
  useEffect(() => () => abortRef.current?.abort(), [])

  const submitted = data?.submission
  const attached = submitted?.files?.length || 0
  const slotsLeft = Math.max(0, MAX_FILES - attached - queue.length)
  // "Reviewed" shows the marks but is NOT a lock: while the class window is open
  // the student may keep handing work in (it goes back to the mentor's queue).
  // Only removing already-graded files is blocked until then — the server
  // enforces the same rule.
  const locked = submitted?.status === 'reviewed'
  const canSubmit = !!data?.canSubmit

  const addFiles = (fileList) => {
    setError(''); setOkMsg('')
    const incoming = Array.from(fileList || [])
    if (!incoming.length) return

    const accepted = []
    for (const f of incoming) {
      if (accepted.length >= slotsLeft) {
        setError(`You can attach at most ${MAX_FILES} files to a class`)
        break
      }
      const kind = kindOf(f)
      const type = typeOf(f)
      if (!type) {
        setError(`${f.name}: this file type isn't accepted`)
        continue
      }
      if (f.size > LIMITS[kind]) {
        setError(`${f.name} is ${fmtBytes(f.size)} — the limit for ${kind} files is ${Math.round(LIMITS[kind] / 1048576)}MB`)
        continue
      }
      accepted.push({ file: f, kind, contentType: type, durationMs: 0, recorded: false })
    }
    if (accepted.length) setQueue((q) => [...q, ...accepted])
  }

  const stageRecording = (result) => {
    if (!slotsLeft) { setError(`You can attach at most ${MAX_FILES} files to a class`); return }
    setQueue((q) => [...q, {
      file: result.file,
      kind: result.kind,
      contentType: (result.file.type || '').split(';')[0],
      durationMs: result.durationMs,
      recorded: true,
    }])
    setOkMsg(result.kind === 'audio' ? 'Voice note ready to submit' : 'Video ready to submit')
    setTab('files')
  }

  const removeStaged = (idx) => setQueue((q) => q.filter((_, i) => i !== idx))

  // presign → PUT each file → commit metadata. Files are uploaded one at a time:
  // a phone pushing three videos in parallel starves each stream and makes the
  // progress bar meaningless.
  const submit = async () => {
    if (!queue.length && note === (submitted?.note || '')) {
      setError('Record something or choose a file first')
      return
    }
    setBusy(true); setError(''); setOkMsg('')
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      if (queue.length) {
        const { uploads } = await apiFetch(`/api/live-classes/${classId}/submissions/presign`, {
          method: 'POST',
          body: JSON.stringify({
            files: queue.map((q) => ({
              name: q.file.name, contentType: q.contentType, size: q.file.size,
              durationMs: q.durationMs, recorded: q.recorded,
            })),
          }),
        })

        for (let i = 0; i < uploads.length; i++) {
          setProgress({ index: i, total: uploads.length, pct: 0, name: queue[i].file.name })
          await putToR2(uploads[i].uploadUrl, queue[i].file,
            (p) => setProgress({ index: i, total: uploads.length, pct: Math.round(p * 100), name: queue[i].file.name }),
            ctrl.signal)
        }

        await apiFetch(`/api/live-classes/${classId}/submissions`, {
          method: 'POST',
          body: JSON.stringify({
            note,
            files: uploads.map((u, i) => ({
              key: u.key, name: u.name, contentType: u.contentType, size: u.size,
              durationMs: queue[i].durationMs, recorded: queue[i].recorded,
            })),
          }),
        })
        setQueue([])
        setOkMsg('Submitted to your mentor ✓')
      } else {
        await apiFetch(`/api/live-classes/${classId}/submissions/note`, {
          method: 'PATCH', body: JSON.stringify({ note }),
        })
        setOkMsg('Note saved ✓')
      }
      await load()
    } catch (e) {
      setError(e.message || 'Could not submit')
    } finally {
      setProgress(null)
      setBusy(false)
      abortRef.current = null
    }
  }

  const removeSubmitted = async (key) => {
    if (!confirm('Remove this file from your submission?')) return
    setBusy(true); setError('')
    try {
      await apiFetch(`/api/live-classes/${classId}/submissions/file`, {
        method: 'DELETE', body: JSON.stringify({ key }),
      })
      await load()
    } catch (e) {
      setError(e.message || 'Could not remove the file')
    } finally { setBusy(false) }
  }

  const openFile = async (key) => {
    try {
      const d = await apiFetch(`/api/live-classes/${classId}/submissions/file?key=${encodeURIComponent(key)}`)
      window.open(d.url, '_blank', 'noopener')
    } catch (e) {
      setError(e.message || 'Could not open the file')
    }
  }

  // ── chrome ──
  const shell = embedded
    ? 'w-full h-full flex flex-col bg-white'
    : 'bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col'

  const body = (
    <div className={shell} onClick={(e) => e.stopPropagation()}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900">Submit your work</p>
          <p className="text-xs text-gray-400 truncate">{classTitle}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-1">×</button>
      </div>

      <div className="p-4 overflow-y-auto flex-1">
        {data === null ? (
          <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
        ) : (
          <>
            {locked && (
              <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                <p className="text-xs font-bold text-emerald-800">Reviewed by your mentor</p>
                {submitted.marks != null && (
                  <p className="text-sm font-bold text-emerald-900 mt-1">
                    {submitted.marks}{submitted.totalMarks != null ? ` / ${submitted.totalMarks}` : ''} marks
                  </p>
                )}
                {submitted.mentorNotes && <p className="text-xs text-emerald-800 mt-1 whitespace-pre-wrap">{submitted.mentorNotes}</p>}
                {canSubmit && (
                  <p className="text-[11px] text-emerald-700 mt-1.5">
                    You can still submit more work — new files go back to your mentor for review.
                  </p>
                )}
              </div>
            )}

            {!locked && submitted?.status === 'changes_requested' && (
              <div className="mb-3 rounded-xl bg-amber-50 border border-amber-200 p-3">
                <p className="text-xs font-bold text-amber-800">Your mentor asked for changes</p>
                {submitted.mentorNotes && <p className="text-xs text-amber-800 mt-1 whitespace-pre-wrap">{submitted.mentorNotes}</p>}
              </div>
            )}

            {!canSubmit && !locked && data?.closedReason && (
              <div className="mb-3 rounded-xl bg-gray-50 border border-gray-200 p-3">
                <p className="text-xs font-semibold text-gray-600">{data.closedReason}</p>
              </div>
            )}

            {/* Files the mentor sent back */}
            {!!submitted?.mentorFiles?.length && (
              <div className="mb-3">
                <p className="text-[11px] font-bold text-gray-400 uppercase mb-1.5">From your mentor</p>
                <div className="space-y-1.5">
                  {submitted.mentorFiles.map((f) => (
                    <button key={f.key} onClick={() => openFile(f.key)}
                      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100">
                      <span>{KIND_ICON[f.kind] || '📎'}</span>
                      <span className="text-xs text-indigo-900 font-medium truncate flex-1">{f.name}</span>
                      <span className="text-[10px] text-indigo-400">open</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Already submitted */}
            {attached > 0 && (
              <div className="mb-4">
                <p className="text-[11px] font-bold text-gray-400 uppercase mb-1.5">
                  Submitted ({attached}/{MAX_FILES})
                </p>
                <div className="space-y-1.5">
                  {submitted.files.map((f) => (
                    <div key={f.key} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50">
                      <span>{KIND_ICON[f.kind] || '📎'}</span>
                      <button onClick={() => openFile(f.key)} className="text-xs text-gray-900 font-medium truncate flex-1 text-left hover:underline">
                        {f.name}
                      </button>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">
                        {f.durationMs ? fmtClock(f.durationMs) : fmtBytes(f.size)}
                      </span>
                      {canSubmit && !locked && (
                        <button onClick={() => removeSubmitted(f.key)} disabled={busy}
                          title="Remove this file"
                          className="text-gray-300 hover:text-red-500 text-lg leading-none disabled:opacity-40">×</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canSubmit && (
              <>
                {/* Mode picker */}
                <div className="flex gap-1.5 mb-3 p-1 bg-gray-100 rounded-xl">
                  {[
                    { k: 'files', label: '📎 Files' },
                    { k: 'voice', label: '🎙 Voice' },
                    { k: 'video', label: '🎬 Video' },
                  ].map((t) => (
                    <button key={t.k} onClick={() => setTab(t.k)} disabled={busy}
                      className={`flex-1 text-xs font-semibold py-2 rounded-lg transition disabled:opacity-50 ${
                        tab === t.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab === 'files' && (
                  <div>
                    <input ref={fileInputRef} type="file" multiple accept={ACCEPT} className="hidden"
                      onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
                    <button onClick={() => fileInputRef.current?.click()} disabled={busy || !slotsLeft}
                      className="w-full py-6 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 text-sm font-semibold hover:border-teal-400 hover:text-teal-600 disabled:opacity-50">
                      {slotsLeft ? '+ Choose files or take a photo' : 'File limit reached'}
                    </button>
                    <p className="text-[10px] text-gray-400 mt-1.5 text-center">
                      PDF, Word, PowerPoint, images, audio, video · up to {MAX_FILES} files
                    </p>
                  </div>
                )}

                {tab === 'voice' && (
                  <RecorderBox mode="audio" maxBytes={LIMITS.audio} maxDurationMs={MAX_AUDIO_MS}
                    disabled={busy || !slotsLeft} onDone={stageRecording} cameraControls={cameraControls} />
                )}

                {tab === 'video' && (
                  <RecorderBox mode="video" maxBytes={LIMITS.video} maxDurationMs={MAX_VIDEO_MS}
                    disabled={busy || !slotsLeft} onDone={stageRecording} cameraControls={cameraControls} />
                )}

                {/* Staged, not yet uploaded */}
                {!!queue.length && (
                  <div className="mt-4">
                    <p className="text-[11px] font-bold text-gray-400 uppercase mb-1.5">Ready to submit ({queue.length})</p>
                    <div className="space-y-1.5">
                      {queue.map((q, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-teal-200 bg-teal-50">
                          <span>{KIND_ICON[q.kind] || '📎'}</span>
                          <span className="text-xs text-gray-900 font-medium truncate flex-1">{q.file.name}</span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {q.durationMs ? fmtClock(q.durationMs) : fmtBytes(q.file.size)}
                          </span>
                          {!busy && (
                            <button onClick={() => removeStaged(i)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <label className="text-[11px] font-bold text-gray-400 uppercase">Note for your mentor (optional)</label>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} disabled={busy}
                    placeholder="Anything you want to explain about your work…"
                    className="mt-1 w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400 disabled:bg-gray-50" />
                </div>
              </>
            )}

            {progress && (
              <div className="mt-4">
                <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                  <span className="truncate pr-2">Uploading {progress.name}</span>
                  <span className="flex-shrink-0">{progress.index + 1}/{progress.total} · {progress.pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500 transition-all" style={{ width: `${progress.pct}%` }} />
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
            {okMsg && <p className="text-xs text-emerald-600 font-semibold mt-3">{okMsg}</p>}
          </>
        )}
      </div>

      {canSubmit && (
        <div className="px-4 py-3 border-t border-gray-100 flex gap-2 flex-shrink-0">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
            Close
          </button>
          <button onClick={submit} disabled={busy || (!queue.length && note === (submitted?.note || ''))}
            className="flex-1 px-4 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400">
            {busy ? 'Submitting…' : queue.length ? `Submit ${queue.length} file${queue.length > 1 ? 's' : ''}` : 'Save note'}
          </button>
        </div>
      )}
    </div>
  )

  if (embedded) return body
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      {body}
    </div>
  )
}

// Record → preview → keep or retake. Kept in this file because it only exists to
// serve the panel and shares its size limits.
//
// `cameraControls` is supplied only when this renders inside a live class. A
// phone can hand its camera and mic to exactly one consumer, so recording while
// LiveKit holds them either fails with NotReadableError or kills the student's
// class video. We release LiveKit's capture first and restore it afterwards —
// which is also literally what the student wants: turn the camera off in class,
// record the answer, come back.
function RecorderBox({ mode, maxBytes, maxDurationMs, disabled, onDone, cameraControls }) {
  const videoRef = useRef(null)
  const [handoff, setHandoff] = useState(false)   // we turned their class devices off

  const onBeforeStart = useCallback(async () => {
    if (!cameraControls?.release) return
    const released = await cameraControls.release({ camera: mode === 'video', mic: true })
    setHandoff(!!released)
  }, [cameraControls, mode])

  const onAfterStop = useCallback(() => {
    if (!handoff || !cameraControls?.restore) return
    setHandoff(false)
    // Fire-and-forget: failing to re-enable the class camera must not break the
    // recording the student just made. They can always re-enable it by hand.
    Promise.resolve(cameraControls.restore()).catch(() => {})
  }, [handoff, cameraControls])

  const rec = useMediaRecorder({ mode, maxBytes, maxDurationMs, onBeforeStart, onAfterStop })

  // Live preview while recording video — students frame a sheet against the
  // camera, and doing that blind is hopeless.
  useEffect(() => {
    if (mode !== 'video' || !videoRef.current) return
    videoRef.current.srcObject = rec.stream || null
  }, [rec.stream, mode])

  if (!isRecordingSupported()) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center">
        <p className="text-xs text-gray-500">
          Recording isn’t supported on this browser. Use the <b>Files</b> tab to attach a
          {mode === 'audio' ? ' voice recording' : ' video'} instead.
        </p>
      </div>
    )
  }

  const pct = Math.min(100, Math.round((rec.elapsedMs / maxDurationMs) * 100))

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      {mode === 'video' && (rec.isRecording || rec.isPaused || rec.state === 'starting') && (
        <video ref={videoRef} autoPlay muted playsInline
          className="w-full rounded-lg bg-black mb-3 max-h-52 object-contain" />
      )}

      {rec.result ? (
        <div>
          {mode === 'audio' ? (
            <audio src={rec.result.url} controls className="w-full" />
          ) : (
            <video src={rec.result.url} controls playsInline className="w-full rounded-lg bg-black max-h-52" />
          )}
          <p className="text-[11px] text-gray-400 mt-2 text-center">
            {fmtClock(rec.result.durationMs)} · {fmtBytes(rec.result.file.size)}
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={rec.reset} disabled={disabled}
              className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">
              Retake
            </button>
            <button onClick={() => { onDone(rec.result); rec.reset() }} disabled={disabled}
              className="flex-1 px-3 py-2 rounded-xl bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400">
              Use this {mode === 'audio' ? 'voice note' : 'video'}
            </button>
          </div>
        </div>
      ) : rec.isRecording || rec.isPaused ? (
        <div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className={`w-2.5 h-2.5 rounded-full ${rec.isPaused ? 'bg-amber-400' : 'bg-red-500 animate-pulse'}`} />
            <span className="text-lg font-bold text-gray-900 tabular-nums">{fmtClock(rec.elapsedMs)}</span>
            <span className="text-[11px] text-gray-400">{fmtBytes(rec.bytes)}</span>
          </div>
          <div className="h-1 bg-gray-200 rounded-full overflow-hidden mb-3">
            <div className={`h-full transition-all ${pct > 90 ? 'bg-red-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex gap-2">
            <button onClick={rec.cancel}
              className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={rec.isPaused ? rec.resume : rec.pause}
              className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50">
              {rec.isPaused ? 'Resume' : 'Pause'}
            </button>
            <button onClick={rec.stop}
              className="flex-1 px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700">
              ■ Stop
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center">
          <button onClick={rec.start} disabled={disabled || rec.state === 'starting'}
            className="w-full py-5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400">
            {rec.state === 'starting'
              ? 'Starting…'
              : mode === 'audio' ? '🎙 Start recording' : '🎬 Start video'}
          </button>
          <p className="text-[10px] text-gray-400 mt-2">
            Up to {Math.round(maxDurationMs / 60000)} min · {Math.round(maxBytes / 1048576)}MB max
          </p>
          {cameraControls && (
            <p className="text-[10px] text-amber-600 mt-1">
              Your class {mode === 'video' ? 'camera and mic' : 'mic'} will switch off while you
              record, and switch back on when you finish.
            </p>
          )}
        </div>
      )}

      {rec.error && <p className="text-xs text-red-500 mt-2">{rec.error}</p>}
    </div>
  )
}
