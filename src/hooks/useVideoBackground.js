import { useCallback, useEffect, useRef, useState } from 'react'
import { presetDataUrl } from '../utils/backgroundPresets'

// Background effects for the host's camera, the way Meet's "Backgrounds" tab
// works: the frames are segmented on the host's own machine and the background
// is blurred or replaced before anything is encoded, so students receive an
// already-processed picture.
//
// Deliberately host-only. Students render as 360p thumbnails, so segmenting
// their frames would burn CPU on something nobody can see.

export const OFF = 'off'
export const BLUR_LIGHT = 'blur-light'
export const BLUR_STRONG = 'blur-strong'
export const CUSTOM = 'custom'
export const PRESET_PREFIX = 'preset:'

// Meet's two blur steps sit roughly here. Past ~20 the edges of hair and
// glasses start dissolving, so strong stops short of that.
const BLUR_RADII = { [BLUR_LIGHT]: 6, [BLUR_STRONG]: 18 }

const KEY = 'focas.live.bg'
const KEY_CUSTOM = 'focas.live.bg.custom'

// Self-hosted so a class never waits on jsdelivr/googleapis — the package
// otherwise pulls the wasm and model from those CDNs. Copies live in
// student/public/mediapipe (see that folder's README).
const ASSET_PATHS = {
  tasksVisionFileSet: '/mediapipe/wasm',
  modelAssetPath: '/mediapipe/selfie_segmenter.tflite',
}

const UNSUPPORTED = 'Background effects need Chrome or Edge on a laptop or desktop.'
const FAILED = 'The background effect could not start on this device.'

const read = (key, fallback) => {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

/** Turns a stored choice into the options the processor wants, or null for off. */
function resolveChoice(choice, customImage) {
  if (choice === OFF) return null
  if (BLUR_RADII[choice]) return { mode: 'background-blur', blurRadius: BLUR_RADII[choice] }
  if (choice === CUSTOM) {
    return customImage ? { mode: 'virtual-background', imagePath: customImage } : null
  }
  if (choice.startsWith(PRESET_PREFIX)) {
    const url = presetDataUrl(choice.slice(PRESET_PREFIX.length))
    return url ? { mode: 'virtual-background', imagePath: url } : null
  }
  return null
}

/**
 * @param cameraTrack the local camera TrackPublication from useLocalParticipant
 * @param enabled     false for students — the hook then does nothing at all
 */
export function useVideoBackground({ cameraTrack, enabled }) {
  const [choice, setChoice] = useState(() => (enabled ? read(KEY, OFF) : OFF))
  const [customImage, setCustomImage] = useState(() => (enabled ? read(KEY_CUSTOM, '') : ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The processor outlives any single camera track: toggling the camera off and
  // on hands us a brand new LocalVideoTrack, and we re-attach this same one
  // rather than paying the model load again.
  const processorRef = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(KEY, choice) } catch { /* private window */ }
  }, [choice])

  useEffect(() => {
    if (!enabled) return undefined
    const track = cameraTrack?.track
    if (!track) return undefined

    let cancelled = false
    const run = async () => {
      const wanted = resolveChoice(choice, customImage)
      setBusy(true)
      try {
        if (!wanted) {
          // Off means off: tear the pipeline down so it stops costing CPU,
          // rather than leaving it running in passthrough. stopProcessor
          // destroys the processor, so the ref has to go with it.
          if (track.getProcessor()) await track.stopProcessor()
          processorRef.current = null
          if (!cancelled) setError('')
          return
        }
        if (!processorRef.current) {
          // Loaded on first use only — this import drags in MediaPipe, which
          // is far too big to sit in the bundle every student downloads.
          const mod = await import('@livekit/track-processors')
          if (cancelled) return
          if (!mod.supportsBackgroundProcessors()) {
            setError(UNSUPPORTED)
            setChoice(OFF)
            return
          }
          processorRef.current = mod.BackgroundProcessor({ ...wanted, assetPaths: ASSET_PATHS })
        } else {
          // Switching in place avoids the flash of raw room you get from
          // tearing the processor down and building a new one.
          await processorRef.current.switchTo(wanted)
        }
        if (cancelled) return
        if (track.getProcessor() !== processorRef.current) {
          await track.setProcessor(processorRef.current)
        }
        if (!cancelled) setError('')
      } catch {
        if (cancelled) return
        // A failed processor can leave the track half-wired; drop it so the
        // next attempt builds a clean one instead of reusing the broken one.
        processorRef.current = null
        setError(FAILED)
        setChoice(OFF)
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [choice, customImage, cameraTrack, enabled])

  // Stores the mentor's own image. It lives in localStorage, so it stays on
  // this browser — a mentor who moves machines picks their background again.
  const saveCustomImage = useCallback((dataUrl) => {
    setError('')
    try {
      localStorage.setItem(KEY_CUSTOM, dataUrl)
    } catch {
      setError('That image was too large to save. Try a smaller one.')
      return
    }
    setCustomImage(dataUrl)
    setChoice(CUSTOM)
  }, [])

  const choose = useCallback((next) => {
    setError('')
    setChoice(next)
  }, [])

  return {
    choice, choose, customImage, saveCustomImage, busy, error, setError,
    active: choice !== OFF,
  }
}

export default useVideoBackground
