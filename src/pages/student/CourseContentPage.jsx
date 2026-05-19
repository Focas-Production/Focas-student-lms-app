import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import { apiFetch } from '../../api'

// Worker served from /public — works in both dev and prod without Vite URL tricks
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

const LEVEL_GRADIENT = {
  Foundation:   'from-green-400 to-emerald-500',
  Intermediate: 'from-yellow-400 to-orange-500',
  Final:        'from-purple-500 to-indigo-600',
}
const LEVEL_COLORS = {
  Foundation: 'bg-green-100 text-green-700',
  Intermediate: 'bg-yellow-100 text-yellow-700',
  Final: 'bg-purple-100 text-purple-700',
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${Math.round(bytes / 1e3)} KB`
}

function fmtTime(sec) {
  if (!sec) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
}


function VideoItem({ item, productId, initialProgress }) {
  const [open,       setOpen]      = useState(false)
  const [streamUrl,  setStreamUrl] = useState(null)
  const [loadingUrl, setLoadingUrl] = useState(false)
  const [urlError,   setUrlError]  = useState('')
  const videoRef       = useRef(null)
  const cachedRef      = useRef(null)   // cached stream URL (prevents re-fetching token)
  const watchedRef     = useRef(initialProgress?.watchedSeconds || 0)
  const iframeRef      = useRef(null)
  const seekDoneRef = useRef(false)
  const lastPos     = initialProgress?.lastPosition || 0

  // Destroy hls.js and revoke any blob URL on unmount
  useEffect(() => () => {
    if (cachedRef.current?.startsWith('blob:')) URL.revokeObjectURL(cachedRef.current)
  }, [])


  async function toggle() {
    if (open) { videoRef.current?.pause(); setOpen(false); return }
    seekDoneRef.current = false
    if (cachedRef.current) { setStreamUrl(cachedRef.current); setOpen(true); return }
    setLoadingUrl(true); setUrlError('')
    try {
      const { url, embedUrl } = await apiFetch(`/api/purchase/stream-url/${item._id}`)

      if (embedUrl) {
        cachedRef.current = embedUrl
        setStreamUrl(embedUrl); setOpen(true)
      } else {
        // Legacy Bunny Storage: use <video src> directly with the pre-signed path URL.
        // Browser handles range requests natively — video starts immediately, no full download.
        cachedRef.current = url
        setStreamUrl(url); setOpen(true)
      }
    } catch (e) {
      setUrlError(e.message || 'Unable to load video. Please try again.')
    } finally {
      setLoadingUrl(false)
    }
  }

  // Seek to last position — called from both loadedmetadata and canplay (fallback)
  function doSeek() {
    const v = videoRef.current
    if (!v || seekDoneRef.current || lastPos < 5) return
    v.currentTime = lastPos
    seekDoneRef.current = true
  }

  // position = where they are in video (for resume), watched = cumulative seconds watched
  const savePos = useCallback(async (position, token, watched) => {
    const lastPosition   = Math.floor(position || 0)
    const watchedSeconds = Math.floor(watched  ?? watchedRef.current)
    if (lastPosition < 1 && watchedSeconds < 1) return
    watchedRef.current = Math.max(watchedRef.current, watchedSeconds)
    const body = JSON.stringify({
      contentId:      item._id,
      productId,
      lastPosition,
      watchedSeconds: watchedRef.current,
    })
    if (token) {
      // keepalive fetch — survives page unload (close tab / navigate away)
      fetch(`${import.meta.env.VITE_API_BASE}/api/purchase/progress`, {
        method: 'POST',
        headers: {
          'Content-Type':              'application/json',
          'Authorization':             `Bearer ${token}`,
          'ngrok-skip-browser-warning': 'true',
        },
        body,
        keepalive: true,
      }).catch(() => {})
    } else {
      apiFetch('/api/purchase/progress', { method: 'POST', body }).catch(() => {})
    }
  }, [item._id, productId])

  // Track watch time for Bunny Stream iframe — save only on close or tab hide (no periodic calls)
  useEffect(() => {
    if (!open || !streamUrl?.includes('iframe.mediadelivery.net')) return
    const openedAt = Date.now()
    return () => {
      const elapsed = Math.floor((Date.now() - openedAt) / 1000)
      const watched = Math.max(elapsed, watchedRef.current)
      if (watched > 5) {
        watchedRef.current = watched
        savePos(0, null, watched)  // position=0 → server skips lastPosition update
      }
    }
  }, [open, streamUrl, savePos])

  // Save when tab becomes hidden (close tab, switch app, lock phone)
  useEffect(() => {
    function onVisibilityChange() {
      if (!document.hidden) return
      const v = videoRef.current
      if (v && v.currentTime > 1) {
        // Native video: save actual position
        const token = localStorage.getItem('student_token')
        savePos(v.currentTime, token)
      } else if (watchedRef.current > 1) {
        // Iframe video: save watched seconds only
        savePos(0, null, watchedRef.current)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [savePos])

  function handleTimeUpdate() {
    const v = videoRef.current
    if (v) watchedRef.current = Math.max(watchedRef.current, Math.floor(v.currentTime))
  }
  function handlePause() {
    const v = videoRef.current
    if (v) savePos(v.currentTime, null)
  }
  function handleEnded() {
    const v = videoRef.current
    savePos(v?.duration || lastPos, null)
  }

  const resumeLabel = lastPos >= 5 ? `Resume ${fmtTime(lastPos)}` : null
  const watchedMin  = watchedRef.current > 60 ? Math.round(watchedRef.current / 60) : null

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden bg-white">
      <button onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${open ? 'bg-indigo-600' : 'bg-indigo-100'}`}>
          {loadingUrl
            ? <svg className="w-4 h-4 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            : <svg className={`w-4 h-4 ${open ? 'text-white' : 'text-indigo-600'}`} fill="currentColor" viewBox="0 0 20 20">

                {open
                  ? <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  : <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                }
              </svg>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{item.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {item.description && <p className="text-xs text-gray-400 truncate flex-1 min-w-0">{item.description}</p>}
            {resumeLabel && !open && !loadingUrl && (
              <span className="text-xs text-indigo-500 font-semibold flex-shrink-0">▶ {resumeLabel}</span>
            )}
            {watchedMin && !resumeLabel && !loadingUrl && (
              <span className="text-xs text-green-500 font-medium flex-shrink-0">✓ {watchedMin}m</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.size > 0 && <span className="text-xs text-gray-400">{fmtSize(item.size)}</span>}
          <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Video</span>
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {urlError && <p className="px-4 pb-3 text-xs text-red-500">{urlError}</p>}

      {open && streamUrl && (
        streamUrl.includes('iframe.mediadelivery.net')
          ? <div className="border-t border-gray-100 bg-black">
              <iframe
                ref={iframeRef}
                src={streamUrl}
                className="w-full"
                style={{ height: '300px', border: 'none' }}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          : <div className="border-t border-gray-100 bg-black select-none">
              <video
                ref={videoRef}
                key={streamUrl}
                src={streamUrl}
                controls
                preload="metadata"
                className="w-full max-h-[300px]"
                controlsList="nodownload noremoteplayback noplaybackrate"
                disablePictureInPicture
                onContextMenu={e => e.preventDefault()}
                onLoadedMetadata={doSeek}
                onCanPlay={doSeek}
                onTimeUpdate={handleTimeUpdate}
                onPause={handlePause}
                onEnded={handleEnded}
              >
                Your browser does not support the video tag.
              </video>
            </div>
      )}
    </div>
  )
}

// Renders a single PDF page onto a canvas element
function PdfPage({ pdf, pageNum, containerWidth }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    pdf.getPage(pageNum).then(page => {
      if (cancelled) return
      const baseViewport = page.getViewport({ scale: 1 })
      const scale        = (containerWidth || 600) / baseViewport.width
      const viewport     = page.getViewport({ scale })
      const canvas       = canvasRef.current
      if (!canvas) return
      canvas.width  = viewport.width
      canvas.height = viewport.height
      page.render({ canvasContext: canvas.getContext('2d'), viewport })
    })
    return () => { cancelled = true }
  }, [pdf, pageNum, containerWidth])

  return (
    <canvas
      ref={canvasRef}
      className="w-full block mb-3 shadow-sm rounded"
      onContextMenu={e => e.preventDefault()}
      style={{ userSelect: 'none' }}
    />
  )
}

// Full-screen PDF viewer using PDF.js canvas rendering
// No download button, no print option, no text selection, no native PDF toolbar
function PdfViewer({ blobUrl, title, onClose }) {
  const [pdfDoc,   setPdfDoc]   = useState(null)
  const [numPages, setNumPages] = useState(0)
  const [width,    setWidth]    = useState(600)
  const [error,    setError]    = useState('')
  const containerRef = useRef(null)

  // Block Ctrl+P (print) and Ctrl+S (save) inside the modal
  useEffect(() => {
    function blockShortcuts(e) {
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'c'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        e.stopPropagation()
        return false
      }
    }
    document.addEventListener('keydown', blockShortcuts, true)
    return () => document.removeEventListener('keydown', blockShortcuts, true)
  }, [])

  // Measure container width for correct canvas scale
  useEffect(() => {
    function measure() {
      if (containerRef.current) setWidth(containerRef.current.clientWidth || 600)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Load the PDF from the blob URL
  useEffect(() => {
    let cancelled = false
    let task
    async function load() {
      try {
        task = pdfjsLib.getDocument(blobUrl)
        const pdf = await task.promise
        if (!cancelled) { setPdfDoc(pdf); setNumPages(pdf.numPages) }
      } catch (e) {
        // Ignore cancellation errors from StrictMode double-invoke cleanup
        if (!cancelled) setError('Unable to load PDF — ' + (e?.message || ''))
      }
    }
    load()
    return () => { cancelled = true; try { task?.destroy() } catch (_) {} }
  }, [blobUrl])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-900"
      onContextMenu={e => e.preventDefault()}
    >
      {/* Toolbar — no download, no print */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 flex-shrink-0 select-none">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
          <span className="text-white text-sm font-medium truncate max-w-[220px]">{title}</span>
          {numPages > 0 && (
            <span className="text-gray-400 text-xs ml-1">{numPages} pages</span>
          )}
        </div>
        <button onClick={onClose}
          className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white transition-colors flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Canvas pages */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-3 py-4 bg-gray-700"
        style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        onCopy={e => e.preventDefault()}
      >
        {error ? (
          <div className="text-red-400 text-center py-12">{error}</div>
        ) : !pdfDoc ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <svg className="w-8 h-8 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <p className="text-gray-400 text-sm">Rendering PDF…</p>
          </div>
        ) : (
          Array.from({ length: numPages }, (_, i) => (
            <PdfPage key={i + 1} pdf={pdfDoc} pageNum={i + 1} containerWidth={width - 24} />
          ))
        )}
      </div>
    </div>
  )
}

function PdfItem({ item }) {
  const [loading, setLoading] = useState(false)
  const [blobUrl, setBlobUrl] = useState(null)
  const [open,    setOpen]    = useState(false)

  function closeModal() {
    setOpen(false)
    if (blobUrl) setTimeout(() => { URL.revokeObjectURL(blobUrl); setBlobUrl(null) }, 300)
  }

  async function openPdf() {
    if (blobUrl) { setOpen(true); return }
    setLoading(true)
    try {
      const data = await apiFetch(`/api/purchase/stream-url/${item._id}`)
      const storedToken = localStorage.getItem('student_token')
      const res = await fetch(data.url, storedToken
        ? { headers: { Authorization: `Bearer ${storedToken}` } }
        : undefined)
      if (!res.ok) throw new Error('Unable to open PDF. Please try again.')
      const blob = await res.blob()
      setBlobUrl(URL.createObjectURL(blob))
      setOpen(true)
    } catch {
      alert('Unable to open PDF. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button onClick={openPdf} disabled={loading}
        className="w-full flex items-center gap-3 px-4 py-3.5 bg-white border border-gray-100 rounded-xl hover:border-red-200 hover:bg-red-50 transition-colors text-left group disabled:opacity-60">
        <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-red-200 transition-colors">
          {loading
            ? <svg className="w-4 h-4 text-red-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            : <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
              </svg>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{item.title}</p>
          {item.description && <p className="text-xs text-gray-400 truncate">{item.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.size > 0 && <span className="text-xs text-gray-400">{fmtSize(item.size)}</span>}
          <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full group-hover:bg-red-100">PDF</span>
          <svg className="w-4 h-4 text-gray-400 group-hover:text-red-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </div>
      </button>

      {open && blobUrl && (
        <PdfViewer blobUrl={blobUrl} title={item.title} onClose={closeModal} />
      )}
    </>
  )
}

export default function CourseContentPage() {
  const { productId }  = useParams()
  const location       = useLocation()
  const navigate       = useNavigate()
  const courseInfo     = location.state?.item || null

  const [content,    setContent]    = useState([])
  const [progress,   setProgress]   = useState({})
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState('')
  const [activeTab,  setActiveTab]  = useState('all')

  useEffect(() => {
    Promise.all([
      apiFetch(`/api/purchase/content?productId=${productId}`),
      apiFetch(`/api/purchase/progress?productId=${productId}`),
    ])
      .then(([contentData, progressData]) => {
        setContent(contentData.content || [])
        setProgress(progressData.progress || {})
      })
      .catch(err => setLoadError(err.message || 'Failed to load course content'))
      .finally(() => setLoading(false))
  }, [productId])

  const subjects    = [...new Set(content.map(c => c.subject))]
  const videoCount  = content.filter(c => c.type === 'video').length
  const pdfCount    = content.filter(c => c.type === 'pdf').length
  const totalWatched = Object.values(progress).reduce((s, p) => s + (p.watchedSeconds || 0), 0)

  const filtered = activeTab === 'all'   ? content
                 : activeTab === 'video' ? content.filter(c => c.type === 'video')
                 : content.filter(c => c.type === 'pdf')

  const gradient = LEVEL_GRADIENT[courseInfo?.level] || 'from-indigo-500 to-purple-600'
  const badge    = LEVEL_COLORS[courseInfo?.level]   || 'bg-indigo-100 text-indigo-700'

  return (
    <div className="pb-8">
      {/* Header banner */}
      <div className={`bg-gradient-to-br ${gradient} px-4 pt-5 pb-6`}>
        <button onClick={() => navigate('/student/courses')}
          className="flex items-center gap-1.5 text-white/80 text-sm mb-4 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          My Courses
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white leading-tight">{courseInfo?.name || 'Course Content'}</h1>
            {courseInfo?.category && (
              <p className="text-white/70 text-sm mt-1">
                {courseInfo.category}{courseInfo.subCategory ? ` · ${courseInfo.subCategory}` : ''}
              </p>
            )}
          </div>
          {courseInfo?.level && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${badge}`}>
              {courseInfo.level}
            </span>
          )}
        </div>

        {!loading && (
          <div className="flex gap-3 mt-4">
            <div className="bg-white/20 rounded-xl px-3 py-2 text-center">
              <p className="text-white font-bold text-lg leading-none">{videoCount}</p>
              <p className="text-white/70 text-xs mt-0.5">Videos</p>
            </div>
            <div className="bg-white/20 rounded-xl px-3 py-2 text-center">
              <p className="text-white font-bold text-lg leading-none">{pdfCount}</p>
              <p className="text-white/70 text-xs mt-0.5">PDFs</p>
            </div>
            <div className="bg-white/20 rounded-xl px-3 py-2 text-center">
              <p className="text-white font-bold text-lg leading-none">{subjects.length}</p>
              <p className="text-white/70 text-xs mt-0.5">Subjects</p>
            </div>
            {totalWatched > 0 && (
              <div className="bg-white/20 rounded-xl px-3 py-2 text-center">
                <p className="text-white font-bold text-lg leading-none">{Math.round(totalWatched / 60)}</p>
                <p className="text-white/70 text-xs mt-0.5">Min watched</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-4 pt-4">
        {!loading && content.length > 0 && (
          <div className="flex gap-2 mb-5">
            {[
              { key: 'all',   label: `All (${content.length})` },
              { key: 'video', label: `Videos (${videoCount})` },
              { key: 'pdf',   label: `PDFs (${pdfCount})` },
            ].map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeTab === t.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[1,2,3,4].map(i => (
              <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3 animate-pulse">
                <div className="w-9 h-9 rounded-xl bg-gray-100 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-100 rounded w-2/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && loadError && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-gray-800 mb-1">Failed to load</h3>
            <p className="text-sm text-gray-400">{loadError}</p>
          </div>
        )}

        {!loading && !loadError && content.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-indigo-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-gray-800 mb-1">No content yet</h3>
            <p className="text-sm text-gray-400">Course materials will appear here once uploaded.</p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="space-y-6">
            {(activeTab === 'all' ? subjects : [...new Set(filtered.map(c => c.subject))]).map(subject => {
              const subjectItems = filtered.filter(c => c.subject === subject)
              if (subjectItems.length === 0) return null
              return (
                <div key={subject}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 bg-indigo-100 rounded flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                      </svg>
                    </div>
                    <h2 className="text-sm font-bold text-gray-800">{subject}</h2>
                    <span className="text-xs text-gray-400">({subjectItems.length})</span>
                  </div>
                  <div className="space-y-2">
                    {subjectItems.map(item => (
                      item.type === 'video'
                        ? <VideoItem key={item._id} item={item} productId={productId} initialProgress={progress[item._id]} />
                        : <PdfItem  key={item._id} item={item} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
