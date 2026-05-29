import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import { apiFetch } from '../../api'

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

const LEVEL_GRADIENT = {
  Foundation:   'from-green-400 to-emerald-500',
  Intermediate: 'from-yellow-400 to-orange-500',
  Final:        'from-purple-500 to-indigo-600',
}
const LEVEL_COLORS = {
  Foundation:   'bg-green-100 text-green-700',
  Intermediate: 'bg-yellow-100 text-yellow-700',
  Final:        'bg-purple-100 text-purple-700',
}

const TS_TYPE_LABELS = {
  chapter_wise:  'Chapter Wise',
  segment_wise:  'Segment Wise',
  full_test:     'Full Test',
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
  const videoRef    = useRef(null)
  const cachedRef   = useRef(null)
  const watchedRef  = useRef(initialProgress?.watchedSeconds || 0)
  const iframeRef   = useRef(null)
  const seekDoneRef = useRef(false)
  const lastPos     = initialProgress?.lastPosition || 0

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
        cachedRef.current = url
        setStreamUrl(url); setOpen(true)
      }
    } catch (e) {
      setUrlError(e.message || 'Unable to load video. Please try again.')
    } finally {
      setLoadingUrl(false)
    }
  }

  function doSeek() {
    const v = videoRef.current
    if (!v || seekDoneRef.current || lastPos < 5) return
    v.currentTime = lastPos
    seekDoneRef.current = true
  }

  const savePos = useCallback(async (position, token, watched) => {
    const lastPosition   = Math.floor(position || 0)
    const watchedSeconds = Math.floor(watched ?? watchedRef.current)
    if (lastPosition < 1 && watchedSeconds < 1) return
    watchedRef.current = Math.max(watchedRef.current, watchedSeconds)
    const body = JSON.stringify({ contentId: item._id, productId, lastPosition, watchedSeconds: watchedRef.current })
    if (token) {
      fetch(`${import.meta.env.VITE_API_BASE}/api/purchase/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'ngrok-skip-browser-warning': 'true' },
        body, keepalive: true,
      }).catch(() => {})
    } else {
      apiFetch('/api/purchase/progress', { method: 'POST', body }).catch(() => {})
    }
  }, [item._id, productId])

  useEffect(() => {
    if (!open || !streamUrl?.includes('iframe.mediadelivery.net')) return
    const openedAt = Date.now()
    return () => {
      const elapsed = Math.floor((Date.now() - openedAt) / 1000)
      const watched = Math.max(elapsed, watchedRef.current)
      if (watched > 5) { watchedRef.current = watched; savePos(0, null, watched) }
    }
  }, [open, streamUrl, savePos])

  useEffect(() => {
    function onVisibilityChange() {
      if (!document.hidden) return
      const v = videoRef.current
      if (v && v.currentTime > 1) {
        savePos(v.currentTime, localStorage.getItem('student_token'))
      } else if (watchedRef.current > 1) {
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
  function handlePause() { const v = videoRef.current; if (v) savePos(v.currentTime, null) }
  function handleEnded() { const v = videoRef.current; savePos(v?.duration || lastPos, null) }

  const resumeLabel = lastPos >= 5 ? `Resume ${fmtTime(lastPos)}` : null
  const watchedMin  = watchedRef.current > 60 ? Math.round(watchedRef.current / 60) : null

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden bg-white">
      <button onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${open ? 'bg-indigo-600' : 'bg-indigo-100'}`}>
          {loadingUrl
            ? <svg className="w-4 h-4 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
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
            {resumeLabel && !open && !loadingUrl && <span className="text-xs text-indigo-500 font-semibold flex-shrink-0">▶ {resumeLabel}</span>}
            {watchedMin && !resumeLabel && !loadingUrl && <span className="text-xs text-green-500 font-medium flex-shrink-0">✓ {watchedMin}m</span>}
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
              <iframe ref={iframeRef} src={streamUrl} className="w-full" style={{ height: '300px', border: 'none' }}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
            </div>
          : <div className="border-t border-gray-100 bg-black select-none">
              <video ref={videoRef} key={streamUrl} src={streamUrl} controls preload="metadata"
                className="w-full max-h-[300px]"
                controlsList="nodownload noremoteplayback noplaybackrate"
                disablePictureInPicture
                onContextMenu={e => e.preventDefault()}
                onLoadedMetadata={doSeek} onCanPlay={doSeek}
                onTimeUpdate={handleTimeUpdate} onPause={handlePause} onEnded={handleEnded}>
                Your browser does not support the video tag.
              </video>
            </div>
      )}
    </div>
  )
}

function PdfPage({ pdf, pageNum, containerWidth }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    pdf.getPage(pageNum).then(page => {
      if (cancelled) return
      // Render at devicePixelRatio resolution so text stays sharp on retina/mobile screens
      const dpr          = Math.min(window.devicePixelRatio || 1, 3)
      const baseViewport = page.getViewport({ scale: 1 })
      const scale        = (containerWidth || 600) / baseViewport.width
      const viewport     = page.getViewport({ scale: scale * dpr })
      const canvas       = canvasRef.current
      if (!canvas) return
      canvas.width  = viewport.width
      canvas.height = viewport.height
      // CSS size stays at logical pixels — browser scales up from the hi-res canvas
      canvas.style.width  = `${Math.round(viewport.width  / dpr)}px`
      canvas.style.height = `${Math.round(viewport.height / dpr)}px`
      page.render({ canvasContext: canvas.getContext('2d'), viewport })
    })
    return () => { cancelled = true }
  }, [pdf, pageNum, containerWidth])
  return (
    <canvas ref={canvasRef} className="block mb-3 shadow-sm rounded"
      onContextMenu={e => e.preventDefault()} style={{ userSelect: 'none', maxWidth: '100%' }} />
  )
}

function PdfViewer({ blobUrl, title, onClose }) {
  const [pdfDoc,   setPdfDoc]   = useState(null)
  const [numPages, setNumPages] = useState(0)
  const [width,    setWidth]    = useState(600)
  const [error,    setError]    = useState('')
  const containerRef = useRef(null)

  useEffect(() => {
    function blockShortcuts(e) {
      if ((e.ctrlKey || e.metaKey) && ['p','s','c'].includes(e.key.toLowerCase())) {
        e.preventDefault(); e.stopPropagation(); return false
      }
    }
    document.addEventListener('keydown', blockShortcuts, true)
    return () => document.removeEventListener('keydown', blockShortcuts, true)
  }, [])

  useEffect(() => {
    function measure() {
      if (containerRef.current) setWidth(containerRef.current.clientWidth || 600)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    let cancelled = false; let task
    async function load() {
      try {
        task = pdfjsLib.getDocument(blobUrl)
        const pdf = await task.promise
        if (!cancelled) { setPdfDoc(pdf); setNumPages(pdf.numPages) }
      } catch (e) {
        if (!cancelled) setError('Unable to load PDF — ' + (e?.message || ''))
      }
    }
    load()
    return () => { cancelled = true; try { task?.destroy() } catch (_) {} }
  }, [blobUrl])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900" onContextMenu={e => e.preventDefault()}>
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 flex-shrink-0 select-none">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
          <span className="text-white text-sm font-medium truncate max-w-[220px]">{title}</span>
          {numPages > 0 && <span className="text-gray-400 text-xs ml-1">{numPages} pages</span>}
        </div>
        <button onClick={onClose}
          className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white transition-colors flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto px-3 py-4 bg-gray-700"
        style={{ userSelect: 'none', WebkitUserSelect: 'none' }} onCopy={e => e.preventDefault()}>
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
            <PdfPage key={i+1} pdf={pdfDoc} pageNum={i+1} containerWidth={width - 24} />
          ))
        )}
      </div>
    </div>
  )
}

function PdfItem({ item, badge }) {
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
      const res = await fetch(data.url, storedToken ? { headers: { Authorization: `Bearer ${storedToken}` } } : undefined)
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
            ? <svg className="w-4 h-4 text-red-500 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            : <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" /></svg>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{item.title}</p>
          {item.description && <p className="text-xs text-gray-400 truncate">{item.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.size > 0 && <span className="text-xs text-gray-400">{fmtSize(item.size)}</span>}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge?.color || 'text-red-600 bg-red-50 group-hover:bg-red-100'}`}>
            {badge?.label || 'PDF'}
          </span>
          <svg className="w-4 h-4 text-gray-400 group-hover:text-red-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </div>
      </button>
      {open && blobUrl && <PdfViewer blobUrl={blobUrl} title={item.title} onClose={closeModal} />}
    </>
  )
}

// Test series row: question paper + optional Answer Key button below
function TestSeriesItem({ item }) {
  const [answerLoading, setAnswerLoading] = useState(false)
  const [answerBlobUrl, setAnswerBlobUrl] = useState(null)
  const [answerOpen,    setAnswerOpen]    = useState(false)

  function closeAnswer() {
    setAnswerOpen(false)
    if (answerBlobUrl) setTimeout(() => { URL.revokeObjectURL(answerBlobUrl); setAnswerBlobUrl(null) }, 300)
  }

  async function openAnswer() {
    if (answerBlobUrl) { setAnswerOpen(true); return }
    setAnswerLoading(true)
    try {
      const data        = await apiFetch(`/api/purchase/answer-url/${item._id}`)
      const token       = localStorage.getItem('student_token')
      const res         = await fetch(data.url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      if (!res.ok) throw new Error('Unable to open answer PDF.')
      setAnswerBlobUrl(URL.createObjectURL(await res.blob()))
      setAnswerOpen(true)
    } catch {
      alert('Unable to open answer PDF. Please try again.')
    } finally {
      setAnswerLoading(false)
    }
  }

  return (
    <div className="space-y-1">
      <PdfItem item={item} badge={{ label: 'Question Paper', color: 'text-rose-700 bg-rose-50 group-hover:bg-rose-100' }} />
      {item.answerSize > 0 && (
        <button onClick={openAnswer} disabled={answerLoading}
          className="w-full flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-100 rounded-xl hover:bg-green-100 transition-colors text-left disabled:opacity-60">
          {answerLoading
            ? <svg className="w-3.5 h-3.5 text-green-500 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            : <svg className="w-3.5 h-3.5 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 8a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/></svg>
          }
          <span className="text-xs font-semibold text-green-700">
            {answerLoading ? 'Loading…' : 'View Answer Key'}
          </span>
          <span className="ml-auto text-[10px] text-green-500 font-medium">PDF</span>
        </button>
      )}
      {answerOpen && answerBlobUrl && (
        <PdfViewer blobUrl={answerBlobUrl} title={`${item.title} — Answer Key`} onClose={closeAnswer} />
      )}
    </div>
  )
}

// Group items: subject → folder → items
function groupBySubjectFolder(items) {
  const subjectOrder = []
  const bySubject = {}
  for (const item of items) {
    const subj = item.subject || 'General'
    if (!bySubject[subj]) { bySubject[subj] = {}; subjectOrder.push(subj) }
    const fold = item.folder?.trim() || ''
    if (!bySubject[subj][fold]) bySubject[subj][fold] = []
    bySubject[subj][fold].push(item)
  }
  return subjectOrder.map(subj => ({
    subject: subj,
    folders: Object.entries(bySubject[subj]).map(([folder, items]) => ({ folder, items })),
  }))
}

function FolderGroup({ folder, items, renderItem }) {
  const hasFolderName = folder.trim().length > 0
  return (
    <div className={hasFolderName ? 'ml-0' : ''}>
      {hasFolderName && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          <span className="text-xs font-bold text-gray-700">{folder}</span>
          <span className="text-xs text-gray-400">({items.length})</span>
        </div>
      )}
      <div className={`space-y-2 ${hasFolderName ? 'ml-4 border-l-2 border-amber-100 pl-3' : ''}`}>
        {items.map(item => renderItem(item))}
      </div>
    </div>
  )
}

function SubjectSection({ subject, folders, renderItem }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 bg-indigo-100 rounded flex items-center justify-center flex-shrink-0">
          <svg className="w-3 h-3 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
          </svg>
        </div>
        <h2 className="text-sm font-bold text-gray-800">{subject}</h2>
        <span className="text-xs text-gray-400">({folders.reduce((s, f) => s + f.items.length, 0)})</span>
      </div>
      <div className="space-y-4">
        {folders.map(({ folder, items }) => (
          <FolderGroup key={folder || '__root__'} folder={folder} items={items} renderItem={renderItem} />
        ))}
      </div>
    </div>
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
  const [activeTab,  setActiveTab]  = useState('lecture')
  const [activeTSType, setActiveTSType] = useState('chapter_wise')

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

  // Split content by category (default old content → lecture)
  const lectures     = content.filter(c => !c.category || c.category === 'lecture')
  const questionBank = content.filter(c => c.category === 'question_bank')
  const testSeries   = content.filter(c => c.category === 'test_series')

  // Available test series types in this course
  const tsTypesAvailable = [...new Set(testSeries.map(c => c.testSeriesType).filter(Boolean))]
  const tsFiltered = testSeries.filter(c => c.testSeriesType === activeTSType || !c.testSeriesType)

  const videoCount  = lectures.filter(c => c.type === 'video').length
  const pdfCount    = lectures.filter(c => c.type === 'pdf').length + questionBank.length + testSeries.length

  const gradient = LEVEL_GRADIENT[courseInfo?.level] || 'from-indigo-500 to-purple-600'
  const badge    = LEVEL_COLORS[courseInfo?.level]   || 'bg-indigo-100 text-indigo-700'

  const tabs = [
    { key: 'lecture',      label: 'Lectures',      count: lectures.length },
    { key: 'question_bank',label: 'Question Bank', count: questionBank.length },
    { key: 'test_series',  label: 'Test Series',   count: testSeries.length },
  ].filter(t => t.count > 0)

  // Ensure activeTab is valid after content loads
  useEffect(() => {
    if (tabs.length && !tabs.find(t => t.key === activeTab)) {
      setActiveTab(tabs[0].key)
    }
  }, [tabs.length])

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
              <p className="text-white font-bold text-lg leading-none">{questionBank.length}</p>
              <p className="text-white/70 text-xs mt-0.5">Q. Bank</p>
            </div>
            <div className="bg-white/20 rounded-xl px-3 py-2 text-center">
              <p className="text-white font-bold text-lg leading-none">{testSeries.length}</p>
              <p className="text-white/70 text-xs mt-0.5">Tests</p>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pt-4">
        {/* Category tabs */}
        {!loading && tabs.length > 0 && (
          <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                  activeTab === t.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {t.label} ({t.count})
              </button>
            ))}
          </div>
        )}

        {/* Loading skeleton */}
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

        {/* Error state */}
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

        {/* Empty state */}
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

        {/* ── LECTURES ── */}
        {!loading && !loadError && activeTab === 'lecture' && lectures.length > 0 && (
          <div className="space-y-6">
            {groupBySubjectFolder(lectures).map(({ subject, folders }) => (
              <SubjectSection
                key={subject}
                subject={subject}
                folders={folders}
                renderItem={item =>
                  item.type === 'video'
                    ? <VideoItem key={item._id} item={item} productId={productId} initialProgress={progress[item._id]} />
                    : <PdfItem key={item._id} item={item} />
                }
              />
            ))}
          </div>
        )}

        {/* ── QUESTION BANK ── */}
        {!loading && !loadError && activeTab === 'question_bank' && questionBank.length > 0 && (
          <div className="space-y-6">
            {groupBySubjectFolder(questionBank).map(({ subject, folders }) => (
              <SubjectSection
                key={subject}
                subject={subject}
                folders={folders}
                renderItem={item => (
                  <PdfItem key={item._id} item={item}
                    badge={{ label: 'Q. Bank', color: 'text-amber-700 bg-amber-50 group-hover:bg-amber-100' }} />
                )}
              />
            ))}
          </div>
        )}

        {/* ── TEST SERIES ── */}
        {!loading && !loadError && activeTab === 'test_series' && testSeries.length > 0 && (
          <div>
            {/* Sub-tabs for test series type */}
            {tsTypesAvailable.length > 1 && (
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                {tsTypesAvailable.map(t => (
                  <button key={t} onClick={() => setActiveTSType(t)}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap flex-shrink-0 ${
                      activeTSType === t ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    {TS_TYPE_LABELS[t] || t}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-6">
              {groupBySubjectFolder(tsTypesAvailable.length > 1 ? tsFiltered : testSeries).map(({ subject, folders }) => (
                <SubjectSection
                  key={subject}
                  subject={subject}
                  folders={folders}
                  renderItem={item => <TestSeriesItem key={item._id} item={item} />}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
