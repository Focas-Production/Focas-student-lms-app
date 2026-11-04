// One document slot on My Details (10th mark sheet / school ID card / photo).
// Empty → "Take photo" (phones open the camera) or "Choose file".
// Uploaded → thumbnail (photos) or PDF tile, status badge, Replace / View.
// Asked to re-upload → red card with the office's reason.
// Approved → locked; only the office can change it.
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api'
import { uploadDocument, fmtSize } from '../lib/studentDetails'

const BASE = '/api/student-details/me'

const HINTS = {
  marksheet10: 'All pages, every mark readable',
  schoolId:    'Front side — your name and photo visible',
  photo:       'Recent passport-size photo, plain background',
}

// Phones get a camera button; on a laptop it would just open the file picker twice over.
const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

const BADGE = {
  pending:  { text: 'Waiting for check', cls: 'bg-amber-100 text-amber-800' },
  approved: { text: 'Approved',          cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { text: 'Upload again',      cls: 'bg-rose-100 text-rose-700' },
}

function DocIcon({ type }) {
  const d = type === 'photo'
    ? 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
    : type === 'schoolId'
      ? 'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2'
      : 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
  return <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={d} /></svg>
}

export default function DetailsDocCard({ type, label, doc, options, onUploaded, onBusy }) {
  const cameraRef = useRef(null)
  const fileRef = useRef(null)
  const [progress, setProgress] = useState(null)   // null idle, 0–100 uploading
  const [error, setError] = useState('')
  const [thumb, setThumb] = useState(null)         // image URL for the preview
  const [thumbFailed, setThumbFailed] = useState(false)   // stop re-asking after a broken preview

  const isImage = doc && doc.contentType?.startsWith('image/')
  const locked = doc?.status === 'approved'
  const rejected = doc?.status === 'rejected'

  // Thumbnail for an image already on file (signed link, 5 min — fine for a preview).
  useEffect(() => {
    if (!isImage || thumb || thumbFailed) return
    let live = true
    apiFetch(`${BASE}/documents/${type}/view`).then(r => { if (live) setThumb(r.url) }).catch(() => {})
    return () => { live = false }
  }, [isImage, type, thumb, thumbFailed])

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setProgress(0); onBusy?.(true)
    try {
      const r = await uploadDocument(BASE, type, file, options, setProgress)
      setThumbFailed(false)
      setThumb(old => {
        if (old?.startsWith('blob:')) URL.revokeObjectURL(old)
        return file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      })
      onUploaded(r.details)
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null); onBusy?.(false)
    }
  }

  async function view() {
    const w = window.open('', '_blank')   // opened inside the click so it isn't blocked
    try {
      const r = await apiFetch(`${BASE}/documents/${type}/view`)
      if (w) w.location.href = r.url; else window.location.href = r.url
    } catch (err) { w?.close(); setError(err.message) }
  }

  const border = rejected ? 'border-rose-300 bg-rose-50/50'
    : locked ? 'border-emerald-200 bg-emerald-50/30'
    : doc ? 'border-gray-200 bg-white'
    : 'border-dashed border-gray-300 bg-gray-50/60'

  return (
    <div className={`rounded-2xl border-2 p-4 ${border}`}>
      <div className="flex gap-3">
        {/* preview tile */}
        <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center bg-white border border-gray-100 text-gray-400">
          {isImage && thumb
            ? <img src={thumb} alt="" className="w-full h-full object-cover" onError={() => { setThumb(null); setThumbFailed(true) }} />
            : doc?.contentType === 'application/pdf'
              ? <span className="text-xs font-bold text-rose-500">PDF</span>
              : <DocIcon type={type} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-gray-900 leading-tight">{label}</p>
            {doc && <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${BADGE[doc.status].cls}`}>{BADGE[doc.status].text}</span>}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{HINTS[type]}</p>
          {doc && (
            <div className="flex items-center gap-1 mt-1">
              <p className="text-xs text-gray-400 truncate min-w-0">{doc.name} · {fmtSize(doc.size)}</p>
              <button type="button" onClick={view} className="h-9 px-2.5 -my-2 text-xs font-semibold text-indigo-600 flex-shrink-0">View</button>
            </div>
          )}
        </div>
      </div>

      {rejected && doc.reason && (
        <div className="mt-3 rounded-xl bg-rose-100/70 px-3 py-2 text-sm text-rose-800">
          <span className="font-semibold">Office says:</span> {doc.reason}
        </div>
      )}

      {progress !== null ? (
        <div className="mt-4" aria-live="polite">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-1.5">Uploading… {progress}% — keep this page open</p>
        </div>
      ) : locked ? (
        <p className="mt-3 text-xs text-emerald-700">✓ Approved. To change it, contact the FOCAS Edu office.</p>
      ) : (
        <div className={`mt-4 grid gap-2 ${isTouch ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {isTouch && (
            <button type="button" onClick={() => cameraRef.current?.click()}
              className={`h-11 rounded-xl text-sm font-semibold ${doc && !rejected ? 'border border-gray-200 text-gray-700 bg-white' : 'bg-indigo-600 text-white'}`}>
              📷 {doc ? 'Retake' : 'Take photo'}
            </button>
          )}
          <button type="button" onClick={() => fileRef.current?.click()}
            className={`h-11 rounded-xl text-sm font-semibold ${!isTouch && (!doc || rejected) ? 'bg-indigo-600 text-white' : 'border border-gray-200 text-gray-700 bg-white'}`}>
            {doc ? 'Choose another file' : isTouch ? 'Choose file' : 'Choose photo or PDF'}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <input ref={fileRef} type="file" accept={options.allowedTypes.join(',')} className="hidden" onChange={pick} />
    </div>
  )
}
