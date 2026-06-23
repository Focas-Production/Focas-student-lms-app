import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

// Worker is served from /public. Safe to set more than once.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

// Renders a single PDF page to a canvas (no download/print affordance).
function PdfPage({ pdf, pageNum, containerWidth }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    pdf.getPage(pageNum).then(page => {
      if (cancelled) return
      const dpr          = Math.min(window.devicePixelRatio || 1, 3)
      const baseViewport = page.getViewport({ scale: 1 })
      const scale        = (containerWidth || 600) / baseViewport.width
      const viewport     = page.getViewport({ scale: scale * dpr })
      const canvas       = canvasRef.current
      if (!canvas) return
      canvas.width  = viewport.width
      canvas.height = viewport.height
      canvas.style.width  = `${Math.round(viewport.width  / dpr)}px`
      canvas.style.height = `${Math.round(viewport.height / dpr)}px`
      page.render({ canvasContext: canvas.getContext('2d'), viewport })
    })
    return () => { cancelled = true }
  }, [pdf, pageNum, containerWidth])
  return (
    <canvas ref={canvasRef} className="block mb-3 shadow-sm rounded mx-auto"
      onContextMenu={e => e.preventDefault()} style={{ userSelect: 'none', maxWidth: '100%' }} />
  )
}

// Full-screen, view-only PDF viewer. Blocks right-click, copy and Ctrl+P/S/C so
// the document can be read but not easily saved or printed.
export default function PdfViewer({ blobUrl, title, onClose }) {
  const [pdfDoc,   setPdfDoc]   = useState(null)
  const [numPages, setNumPages] = useState(0)
  const [width,    setWidth]    = useState(600)
  const [error,    setError]    = useState('')
  const containerRef = useRef(null)

  useEffect(() => {
    function blockShortcuts(e) {
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'c'].includes(e.key.toLowerCase())) {
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
    return () => { cancelled = true; try { task?.destroy() } catch { /* ignore */ } }
  }, [blobUrl])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900" onContextMenu={e => e.preventDefault()}>
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 flex-shrink-0 select-none">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
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
            <PdfPage key={i + 1} pdf={pdfDoc} pageNum={i + 1} containerWidth={width - 24} />
          ))
        )}
      </div>
    </div>
  )
}
