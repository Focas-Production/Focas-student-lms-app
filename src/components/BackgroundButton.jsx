import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import {
  useVideoBackground, OFF, BLUR_LIGHT, BLUR_STRONG, CUSTOM, PRESET_PREFIX,
} from '../hooks/useVideoBackground'
import { BACKGROUND_PRESETS, fileToBackgroundDataUrl } from '../utils/backgroundPresets'

// The host's "Background" control: a bottom-bar button that opens Meet's
// Backgrounds tab — off, two strengths of blur, a few preset backgrounds, and
// the mentor's own image. Must live inside <LiveKitRoom> to reach the camera.
//
// Button and panel are one component on purpose: the choice is the only state
// they share, and keeping it here means LiveRoom doesn't have to thread it
// down through the control row.
//
// Left usable while the camera is off: the choice sticks, so turning the camera
// on later comes up already blurred rather than flashing the room first.

const TILE = 54

export default function BackgroundButton() {
  const { cameraTrack } = useLocalParticipant()
  const {
    choice, choose, customImage, saveCustomImage, busy, error, setError,
  } = useVideoBackground({ cameraTrack, enabled: true })
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const fileRef = useRef(null)

  // Close on Escape or a click anywhere else, the way the rest of the bar's
  // popovers behave.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const onPick = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''            // so picking the same file twice still fires
    if (!file) return
    try {
      saveCustomImage(await fileToBackgroundDataUrl(file))
    } catch (err) {
      setError(err.message || 'That image could not be used.')
    }
  }, [saveCustomImage, setError])

  const on = choice !== OFF
  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="lk-button"
        onClick={() => setOpen((v) => !v)}
        title={
          error ? `${error} Open to try again.`
            : on ? 'Background is on — click to change it or turn it off'
              : 'Background — blur or replace the room behind you. It runs on this computer, so it uses some CPU.'
        }
        aria-label="Background effects"
        aria-expanded={open}
        aria-haspopup="dialog"
        style={
          error ? { backgroundColor: '#b45309', color: '#fff' }
            : on ? { backgroundColor: '#0d9488', color: '#fff' }
              : undefined
        }
      >
        <span aria-hidden="true">{error ? '⚠' : '🌫'}</span>
        <span className="focas-ctl-label focas-ctl-label-wide">
          {busy ? '…' : on ? 'Background on' : 'Background'}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Backgrounds"
          style={{
            position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 40,
            // Wide enough for all five background tiles on one row; the guard
            // keeps it on screen if the bar is ever near a narrow right edge.
            width: 330, maxWidth: 'calc(100vw - 24px)',
            padding: 12, borderRadius: 10, textAlign: 'left',
            background: '#1f2227', border: '1px solid rgba(255,255,255,0.14)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)', color: '#e8eaed',
          }}
        >
          <Section label="Blur">
            <Tile selected={choice === OFF} onClick={() => choose(OFF)} label="Off">
              <span style={{ fontSize: 20 }} aria-hidden="true">🚫</span>
            </Tile>
            <Tile selected={choice === BLUR_LIGHT} onClick={() => choose(BLUR_LIGHT)} label="Slight">
              <Dots blur={1.4} />
            </Tile>
            <Tile selected={choice === BLUR_STRONG} onClick={() => choose(BLUR_STRONG)} label="Strong">
              <Dots blur={3.2} />
            </Tile>
          </Section>

          <Section label="Backgrounds">
            {BACKGROUND_PRESETS.map((p) => (
              <Tile
                key={p.id}
                selected={choice === PRESET_PREFIX + p.id}
                onClick={() => choose(PRESET_PREFIX + p.id)}
                label={p.label}
                background={p.src
                  ? `center/cover url(${p.src})`
                  : `linear-gradient(150deg, ${p.stops[0]}, ${p.stops[1]})`}
              />
            ))}
            <Tile
              selected={choice === CUSTOM && !!customImage}
              onClick={() => (customImage ? choose(CUSTOM) : fileRef.current?.click())}
              label={customImage ? 'Yours' : 'Upload'}
              background={customImage ? `center/cover url(${customImage})` : undefined}
            >
              {!customImage && <span style={{ fontSize: 20 }} aria-hidden="true">＋</span>}
            </Tile>
          </Section>

          {customImage && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{
                background: 'none', border: 0, padding: 0, marginTop: 2,
                color: '#5eead4', fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              Replace your image
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onPick}
            style={{ display: 'none' }}
          />

          {error && (
            <p style={{ margin: '10px 0 0', fontSize: 12, color: '#fca5a5' }}>{error}</p>
          )}
          <p style={{ margin: '10px 0 0', fontSize: 11, color: '#9aa0a6', lineHeight: 1.45 }}>
            Runs on this computer. If the class turns choppy, switch back to Off.
          </p>
        </div>
      )}
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#9aa0a6', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
    </div>
  )
}

function Tile({ selected, onClick, label, background, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      style={{
        width: TILE, padding: 0, border: 0, background: 'none',
        cursor: 'pointer', color: '#e8eaed',
      }}
    >
      <span
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: TILE, height: TILE, borderRadius: 8,
          background: background || '#2c3035',
          outline: selected ? '2px solid #2dd4bf' : '1px solid rgba(255,255,255,0.12)',
          outlineOffset: selected ? 1 : 0,
        }}
      >
        {children}
      </span>
      <span style={{ display: 'block', fontSize: 10, marginTop: 4, color: '#bdc1c6' }}>{label}</span>
    </button>
  )
}

// A tiny stand-in for "a blurred person", so the two blur strengths read as
// different at a glance without rendering a live camera preview in each tile.
function Dots({ blur }) {
  return (
    <span aria-hidden="true" style={{ filter: `blur(${blur}px)`, lineHeight: 1 }}>
      <span style={{ display: 'block', width: 12, height: 12, borderRadius: '50%', background: '#cbd5e1', margin: '0 auto' }} />
      <span style={{ display: 'block', width: 22, height: 12, borderRadius: '11px 11px 0 0', background: '#cbd5e1', marginTop: 3 }} />
    </span>
  )
}
