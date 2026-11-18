// Rotate (90° steps) and crop a photo before it is uploaded — My Details
// documents. Phone-first: full screen on phones, big touch handles. Works on
// a File and hands back a JPEG Blob — or null when nothing was changed, so
// the caller uploads the original untouched. Same logic as the admin copy
// (admin-lms/src/components/ImageEditModal.jsx).
import { useEffect, useRef, useState } from 'react'

const FULL = { x: 0, y: 0, w: 1, h: 1 }
const MIN = 0.05            // smallest crop side, as a share of the picture
const MAX_SIDE = 2000       // long side of the saved picture, px (same as the upload shrink)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// The whole picture turned by `rot` degrees (0/90/180/270), on a canvas.
function rotatedCanvas(img, rot, maxSide = Infinity) {
  const iw = img.naturalWidth, ih = img.naturalHeight
  const scale = Math.min(1, maxSide / Math.max(iw, ih))
  const w = Math.round(iw * scale), h = Math.round(ih * scale)
  const turned = rot % 180 !== 0
  const c = document.createElement('canvas')
  c.width = turned ? h : w
  c.height = turned ? w : h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'                       // transparent PNG → white, not black, in the JPEG
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((rot * Math.PI) / 180)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  return c
}

export default function ImageEditModal({ file, title = 'Rotate / crop', saveLabel = 'Upload', onCancel, onSave }) {
  const [img, setImg] = useState(null)
  const [error, setError] = useState('')
  const [rot, setRot] = useState(0)
  const [crop, setCrop] = useState(FULL)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef(null)
  const boxRef = useRef(null)
  const drag = useRef(null)

  useEffect(() => {
    // `live` guards against a load that was cancelled (file changed / React
    // dev double-run): revoking its URL makes it "fail", which isn't real.
    let live = true
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => { if (live) { setImg(i); setError('') } }
    i.onerror = () => { if (live) setError('This picture could not be opened') }
    i.src = url
    return () => { live = false; URL.revokeObjectURL(url) }
  }, [file])

  // Preview: the turned picture, small enough to fit the window.
  useEffect(() => {
    if (!img || !canvasRef.current) return
    const src = rotatedCanvas(img, rot, 1400)
    const c = canvasRef.current
    c.width = src.width; c.height = src.height
    c.getContext('2d').drawImage(src, 0, 0)
  }, [img, rot])

  const turn = (d) => { setRot(r => (r + d + 360) % 360); setCrop(FULL) }

  // Pointer → share of the picture (0..1).
  const point = (e) => {
    const r = boxRef.current.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }
  }

  function down(e, mode) {
    e.preventDefault(); e.stopPropagation()
    // Not cropped yet: the box covers the whole picture, so "move" would do
    // nothing — a drag anywhere draws a new box instead.
    if (mode === 'move' && crop.w >= 0.999 && crop.h >= 0.999) mode = 'new'
    boxRef.current.setPointerCapture(e.pointerId)
    const p = point(e)
    drag.current = { mode, start: p, crop: { ...crop } }
    if (mode === 'new') setCrop({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  function move(e) {
    const d = drag.current
    if (!d) return
    const p = point(e)
    const c = d.crop
    if (d.mode === 'move') {
      setCrop({ ...c, x: clamp(c.x + p.x - d.start.x, 0, 1 - c.w), y: clamp(c.y + p.y - d.start.y, 0, 1 - c.h) })
      return
    }
    // 'new' and the corners: one corner stays put (the anchor), the other follows the pointer
    const anchor = d.mode === 'new' ? d.start : {
      x: d.mode.includes('w') ? c.x + c.w : c.x,
      y: d.mode.includes('n') ? c.y + c.h : c.y,
    }
    setCrop({ x: Math.min(anchor.x, p.x), y: Math.min(anchor.y, p.y), w: Math.abs(p.x - anchor.x), h: Math.abs(p.y - anchor.y) })
  }

  function up() {
    if (!drag.current) return
    drag.current = null
    setCrop(c => (c.w < MIN || c.h < MIN ? FULL : c))   // a click or a tiny box = no crop
  }

  const changed = rot !== 0 || crop.x > 0.001 || crop.y > 0.001 || crop.w < 0.999 || crop.h < 0.999

  async function save() {
    setSaving(true); setError('')
    try {
      if (!changed) { await onSave(null); return }
      const full = rotatedCanvas(img, rot)
      const sx = Math.round(crop.x * full.width), sy = Math.round(crop.y * full.height)
      const sw = Math.max(1, Math.round(crop.w * full.width)), sh = Math.max(1, Math.round(crop.h * full.height))
      const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh))
      const out = document.createElement('canvas')
      out.width = Math.round(sw * scale); out.height = Math.round(sh * scale)
      out.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height)
      const blob = await new Promise(res => out.toBlob(res, 'image/jpeg', 0.88))
      if (!blob) throw new Error('Could not make the picture')
      await onSave(blob)
    } catch (e) { setError(e.message); setSaving(false) }
  }

  // the visible square sits inside a bigger invisible finger target
  const handle = 'absolute w-9 h-9 flex items-center justify-center touch-none'
  const dot = <span className="w-4 h-4 bg-white border-2 border-indigo-600 rounded-sm shadow" />
  const grid = 'linear-gradient(to right, transparent 33%, rgba(255,255,255,.35) 33%, rgba(255,255,255,.35) calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, rgba(255,255,255,.35) 66%, rgba(255,255,255,.35) calc(66% + 1px), transparent calc(66% + 1px)), linear-gradient(to bottom, transparent 33%, rgba(255,255,255,.35) 33%, rgba(255,255,255,.35) calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, rgba(255,255,255,.35) 66%, rgba(255,255,255,.35) calc(66% + 1px), transparent calc(66% + 1px))'
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center sm:p-4" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
      <div className="bg-white w-full h-full sm:h-auto sm:max-w-2xl sm:max-h-[94vh] sm:rounded-2xl flex flex-col shadow-xl">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-base font-bold text-gray-900">{title}</p>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="Close" className="w-10 h-10 -mr-2 text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        <div className="p-5 flex-1 min-h-0 overflow-hidden bg-gray-900 flex items-center justify-center">
          {error && !img && <p className="text-sm text-rose-300 text-center">{error}</p>}
          {!img && !error && <p className="text-sm text-gray-300">Loading…</p>}
          {img && (
            <div ref={boxRef} className="relative select-none touch-none cursor-crosshair"
              onPointerDown={e => down(e, 'new')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              <canvas ref={canvasRef} className="block max-w-full max-h-[calc(100dvh-260px)] sm:max-h-[60vh] w-auto h-auto" />
              {/* dim outside the box, clipped to the picture */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute" style={{
                  left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                }} />
              </div>
              <div className="absolute border-2 border-white cursor-move"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={e => down(e, 'move')}>
                <span className="absolute inset-0 pointer-events-none" style={{ backgroundImage: grid }} />
                <span className={`${handle} -left-[18px] -top-[18px] cursor-nwse-resize`} onPointerDown={e => down(e, 'nw')}>{dot}</span>
                <span className={`${handle} -right-[18px] -top-[18px] cursor-nesw-resize`} onPointerDown={e => down(e, 'ne')}>{dot}</span>
                <span className={`${handle} -left-[18px] -bottom-[18px] cursor-nesw-resize`} onPointerDown={e => down(e, 'sw')}>{dot}</span>
                <span className={`${handle} -right-[18px] -bottom-[18px] cursor-nwse-resize`} onPointerDown={e => down(e, 'se')}>{dot}</span>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-gray-100 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <button type="button" disabled={!img || saving} onClick={() => turn(-90)} className="h-11 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-40">⟲ Left</button>
            <button type="button" disabled={!img || saving} onClick={() => turn(90)} className="h-11 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-40">⟳ Right</button>
            <button type="button" disabled={!img || saving || !changed} onClick={() => { setRot(0); setCrop(FULL) }} className="h-11 rounded-xl border border-gray-200 text-sm text-gray-500 disabled:opacity-40">Reset</button>
          </div>
          <p className="text-xs text-gray-400 text-center">Drag on the photo to cut out just the document · drag the box to move it</p>
          {error && img && <p className="text-sm text-rose-600 text-center" role="alert">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={saving} onClick={onCancel} className="h-11 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700">Cancel</button>
            <button type="button" disabled={!img || saving} onClick={save} className="h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">{saving ? 'Please wait…' : saveLabel}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
