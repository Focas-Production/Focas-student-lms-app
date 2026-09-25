import { useCallback, useEffect, useRef, useState } from 'react'
import { presetDataUrl } from '../utils/backgroundPresets'

// Background effects for the host's camera, the way Meet's "Backgrounds" tab
// works: the frames are segmented on the host's own machine and the background
// is blurred or replaced before anything is encoded, so students receive an
// already-processed picture. Nothing reaches the server or the database: the
// choice (and a mentor's own image) lives in this browser's localStorage.
//
// Students get it too, with two differences (see `forStudent`):
//  - blur and the presets only, no uploaded image. A photo of yourself as the
//    "background" would keep looking present after walking away, which is
//    exactly what the camera rule is there to catch.
//  - a watchdog. Students are on whatever laptop or phone they have, so if the
//    effect drags their video down to a slideshow it switches itself off
//    rather than leave them choppy for the rest of the class.

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
// Separate so a browser that has been both mentor and student never carries a
// host-only choice (an uploaded image) into a student's room.
const KEY_STUDENT = 'focas.live.bg.student'

// Watchdog: sample what the encoder is actually sending every few seconds, and
// give up after this many struggling samples in a row (~20s). The first sample
// lands after the model has loaded, so the start-up spike doesn't count.
const WATCH_EVERY_MS = 5000
const WATCH_STRIKES = 4
// A student camera is captured at up to 30fps; below this it reads as frozen.
const WATCH_MIN_FPS = 10

// Self-hosted so a class never waits on jsdelivr/googleapis — the package
// otherwise pulls the wasm and model from those CDNs. Copies live in
// student/public/mediapipe (see that folder's README).
const ASSET_PATHS = {
  tasksVisionFileSet: '/mediapipe/wasm',
  modelAssetPath: '/mediapipe/selfie_segmenter.tflite',
}

// Chrome/Edge take a fast path; Safari 16.4+ and recent Firefox fall back to a
// canvas pipeline that works but costs more CPU. Anything older has neither.
const UNSUPPORTED = 'This browser is too old for background effects. Updating it should fix this.'
const FAILED = 'The background effect could not start on this device.'
const TOO_SLOW = 'Your device could not keep up with the background effect, so it was turned off to keep your video smooth.'

const read = (key, fallback) => {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

/** Turns a stored choice into the options the processor wants, or null for off. */
function resolveChoice(choice, customImage, allowCustom) {
  if (choice === OFF) return null
  if (BLUR_RADII[choice]) return { mode: 'background-blur', blurRadius: BLUR_RADII[choice] }
  if (choice === CUSTOM) {
    return allowCustom && customImage ? { mode: 'virtual-background', imagePath: customImage } : null
  }
  if (choice.startsWith(PRESET_PREFIX)) {
    const url = presetDataUrl(choice.slice(PRESET_PREFIX.length))
    return url ? { mode: 'virtual-background', imagePath: url } : null
  }
  return null
}

/** A stored choice this user is still allowed to have, else OFF. */
function sanitize(choice, forStudent) {
  if (choice === OFF || BLUR_RADII[choice]) return choice
  if (choice === CUSTOM) return forStudent ? OFF : choice
  if (choice.startsWith(PRESET_PREFIX) && presetDataUrl(choice.slice(PRESET_PREFIX.length))) return choice
  return OFF
}

/**
 * @param cameraTrack the local camera TrackPublication from useLocalParticipant
 * @param enabled     false turns the hook off entirely
 * @param forStudent  no uploaded image + the performance watchdog (see top)
 */
export function useVideoBackground({ cameraTrack, enabled, forStudent = false }) {
  const key = forStudent ? KEY_STUDENT : KEY
  const allowCustom = !forStudent
  const [choice, setChoice] = useState(() => (enabled ? sanitize(read(key, OFF), forStudent) : OFF))
  const [customImage, setCustomImage] = useState(() => (enabled && allowCustom ? read(KEY_CUSTOM, '') : ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The processor outlives any single camera track: toggling the camera off and
  // on hands us a brand new LocalVideoTrack, and we re-attach this same one
  // rather than paying the model load again.
  const processorRef = useRef(null)

  useEffect(() => {
    if (!enabled) return
    try { localStorage.setItem(key, choice) } catch { /* private window */ }
  }, [choice, key, enabled])

  useEffect(() => {
    if (!enabled) return undefined
    const track = cameraTrack?.track
    if (!track) return undefined

    let cancelled = false
    const run = async () => {
      const wanted = resolveChoice(choice, customImage, allowCustom)
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
  }, [choice, customImage, allowCustom, cameraTrack, enabled])

  // Student watchdog. Reads the encoder's own report rather than guessing from
  // the hardware: "cpu" is the browser saying it is shedding quality because
  // the machine is overloaded, and a frame rate this low is the effect not
  // keeping up. Bandwidth trouble is left alone — turning the effect off
  // would not fix a bad connection. A camera that is off, or a layer nobody
  // is watching (dynacast pauses it), reports nothing and counts for nothing.
  useEffect(() => {
    if (!enabled || !forStudent || choice === OFF || busy) return undefined
    const track = cameraTrack?.track
    if (!track?.getSenderStats) return undefined

    let stopped = false
    let strikes = 0
    const id = setInterval(async () => {
      if (track.isMuted || !track.getProcessor()) { strikes = 0; return }
      let layers
      try { layers = await track.getSenderStats() } catch { return }
      if (stopped) return
      const live = layers.filter((l) => l.framesPerSecond > 0)
      if (!live.length) return
      const fps = Math.max(...live.map((l) => l.framesPerSecond))
      const cpuBound = live.some((l) => l.qualityLimitationReason === 'cpu')
      strikes = fps < WATCH_MIN_FPS || cpuBound ? strikes + 1 : 0
      if (strikes >= WATCH_STRIKES) {
        stopped = true
        clearInterval(id)
        setError(TOO_SLOW)
        setChoice(OFF)
      }
    }, WATCH_EVERY_MS)
    return () => { stopped = true; clearInterval(id) }
  }, [enabled, forStudent, choice, busy, cameraTrack])

  // Stores the mentor's own image. It lives in localStorage, so it stays on
  // this browser — a mentor who moves machines picks their background again.
  const saveCustomImage = useCallback((dataUrl) => {
    if (!allowCustom) return
    setError('')
    try {
      localStorage.setItem(KEY_CUSTOM, dataUrl)
    } catch {
      setError('That image was too large to save. Try a smaller one.')
      return
    }
    setCustomImage(dataUrl)
    setChoice(CUSTOM)
  }, [allowCustom])

  const choose = useCallback((next) => {
    setError('')
    setChoice(sanitize(next, forStudent))
  }, [forStudent])

  return {
    choice, choose, customImage, saveCustomImage, busy, error, setError,
    allowCustom, active: choice !== OFF,
  }
}

export default useVideoBackground
