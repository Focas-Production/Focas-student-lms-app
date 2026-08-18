import { useCallback, useEffect, useRef, useState } from 'react'

// In-browser recorder for class submissions: a voice note (audio only) or a
// video answer (camera + mic). Wraps MediaRecorder with the things that actually
// bite in production:
//
//  • Codec negotiation — Chrome/Firefox/Android produce webm/opus, Safari and
//    iOS only ever produce mp4. Hard-coding either one silently fails on half
//    the devices, so we probe isTypeSupported and fall back to the browser default.
//  • Hard size ceiling — a student recording a 40-minute video would blow past
//    the server's limit and only find out after uploading it. We stop at the cap
//    and tell them, keeping what was recorded so far.
//  • Deterministic teardown — every exit path (stop, cancel, unmount, error)
//    stops the MediaStream tracks. A leaked track keeps the camera light on and,
//    on mobile, blocks LiveKit from reacquiring the camera afterwards.
//
// Camera contention matters here: on mobile, only one consumer can hold the
// camera at a time. The caller is expected to release the LiveKit camera before
// starting a video recording — see the `onBeforeStart`/`onAfterStop` hooks.

// Preference order per mode. First supported type wins; '' means "let the
// browser choose", which is the correct last resort rather than an error.
const CANDIDATES = {
  audio: [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',             // Safari / iOS
    'audio/ogg;codecs=opus',
    '',
  ],
  video: [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',             // Safari / iOS
    '',
  ],
}

function pickMimeType(mode) {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of CANDIDATES[mode]) {
    if (t === '') return ''
    try {
      if (MediaRecorder.isTypeSupported(t)) return t
    } catch {
      // isTypeSupported throws on some older WebViews — treat as unsupported.
    }
  }
  return ''
}

// The extension has to match what was actually recorded, or the server's
// content-type allow-list and the student's file manager disagree about the file.
function extFor(mimeType, mode) {
  const t = (mimeType || '').toLowerCase()
  if (t.includes('mp4'))  return mode === 'audio' ? 'm4a' : 'mp4'
  if (t.includes('ogg'))  return 'ogg'
  if (t.includes('webm')) return 'webm'
  return mode === 'audio' ? 'm4a' : 'mp4'
}

export const isRecordingSupported = () =>
  typeof MediaRecorder !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

// Video at ~1 Mbps / 720p keeps a 5-minute answer near 40 MB — well inside the
// server's 200 MB ceiling — while staying legible for handwritten work held up
// to the camera. Audio at 64 kbps is transparent for speech.
const VIDEO_CONSTRAINTS = {
  width:  { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
  facingMode: 'environment',   // rear camera on phones — usually pointed at the sheet
}
const BITRATES = {
  audio: { audioBitsPerSecond: 64_000 },
  video: { audioBitsPerSecond: 64_000, videoBitsPerSecond: 1_000_000 },
}

/**
 * @param {object}   opts
 * @param {'audio'|'video'} opts.mode
 * @param {number}   opts.maxBytes         stop automatically at this size
 * @param {number}   opts.maxDurationMs    stop automatically at this length
 * @param {Function} opts.onBeforeStart    awaited before getUserMedia — used to
 *                                         release the LiveKit camera on mobile
 * @param {Function} opts.onAfterStop      called once the device is released
 */
export default function useMediaRecorder({
  mode = 'audio',
  maxBytes = 25 * 1024 * 1024,
  maxDurationMs = 15 * 60 * 1000,
  onBeforeStart,
  onAfterStop,
} = {}) {
  const [state, setState]       = useState('idle')  // idle | starting | recording | paused | stopped
  const [elapsedMs, setElapsed] = useState(0)
  const [bytes, setBytes]       = useState(0)
  const [result, setResult]     = useState(null)    // { file, url, durationMs, kind }
  const [error, setError]       = useState('')
  const [stream, setStream]     = useState(null)    // live preview source for video

  const recorderRef = useRef(null)
  const chunksRef   = useRef([])
  const streamRef   = useRef(null)
  const startedRef  = useRef(0)
  const pausedMsRef = useRef(0)
  const pauseAtRef  = useRef(0)
  const tickRef     = useRef(null)
  const resultUrlRef = useRef(null)
  // Set when we stop ourselves (cap hit) so onstop knows why.
  const autoStopRef = useRef('')
  const mountedRef  = useRef(true)

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const clearTick = () => {
    clearInterval(tickRef.current)
    tickRef.current = null
  }

  // One teardown path used by unmount and by every terminal transition, so the
  // camera can never survive this component.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTick()
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop()
        }
      } catch { /* already torn down */ }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    }
  }, [])

  const start = useCallback(async () => {
    if (state === 'recording' || state === 'starting') return
    setError('')
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    resultUrlRef.current = null
    setResult(null)
    setBytes(0)
    setElapsed(0)
    chunksRef.current = []
    pausedMsRef.current = 0
    autoStopRef.current = ''

    if (!isRecordingSupported()) {
      setError('Recording isn’t supported on this browser. You can still upload a file.')
      return
    }

    setState('starting')
    try {
      // Hand the camera back before we ask for it — on mobile the second
      // getUserMedia would otherwise fail or silently kill the class video.
      if (onBeforeStart) await onBeforeStart()

      const media = await navigator.mediaDevices.getUserMedia(
        mode === 'video'
          ? { audio: true, video: VIDEO_CONSTRAINTS }
          : { audio: true },
      )
      // Unmounted (or cancelled) while the permission prompt was open.
      if (!mountedRef.current) {
        media.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = media
      setStream(media)

      const mimeType = pickMimeType(mode)
      const rec = new MediaRecorder(media, {
        ...(mimeType ? { mimeType } : {}),
        ...BITRATES[mode],
      })
      recorderRef.current = rec

      rec.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return
        chunksRef.current.push(e.data)
        const total = chunksRef.current.reduce((s, c) => s + c.size, 0)
        setBytes(total)
        // Stop AT the ceiling rather than letting the server reject it later.
        if (total >= maxBytes && rec.state === 'recording') {
          autoStopRef.current = 'size'
          try { rec.stop() } catch { /* raced a manual stop */ }
        }
      }

      rec.onerror = (e) => {
        setError(e?.error?.message || 'Recording failed')
        autoStopRef.current = 'error'
        try { if (rec.state !== 'inactive') rec.stop() } catch { /* noop */ }
      }

      rec.onstop = () => {
        clearTick()
        const type = rec.mimeType || pickMimeType(mode) || (mode === 'audio' ? 'audio/webm' : 'video/webm')
        const blob = new Blob(chunksRef.current, { type })
        chunksRef.current = []

        // Duration measured from the wall clock minus paused time — Blob
        // metadata for a MediaRecorder stream is unreliable (webm from Chrome
        // reports Infinity), and the server only uses this for display.
        const durationMs = Math.max(0, Date.now() - startedRef.current - pausedMsRef.current)

        releaseStream()
        onAfterStop?.()

        if (!mountedRef.current) return

        if (!blob.size) {
          setError('Nothing was recorded — check microphone permission and try again.')
          setState('idle')
          return
        }

        const baseType = type.split(';')[0]
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        const file = new File(
          [blob],
          `${mode === 'audio' ? 'voice-note' : 'video-answer'}-${stamp}.${extFor(type, mode)}`,
          { type: baseType },
        )
        const url = URL.createObjectURL(blob)
        resultUrlRef.current = url

        setResult({ file, url, durationMs, kind: mode, recorded: true })
        setState('stopped')
        if (autoStopRef.current === 'size') {
          setError(`Reached the ${Math.round(maxBytes / 1048576)}MB limit — recording stopped and saved.`)
        }
      }

      // 1s timeslices give us a live size readout and cap the data lost if the
      // tab is killed mid-recording.
      rec.start(1000)
      startedRef.current = Date.now()
      setState('recording')

      tickRef.current = setInterval(() => {
        if (recorderRef.current?.state === 'paused') return
        const ms = Date.now() - startedRef.current - pausedMsRef.current
        setElapsed(ms)
        if (ms >= maxDurationMs && recorderRef.current?.state === 'recording') {
          autoStopRef.current = 'duration'
          try { recorderRef.current.stop() } catch { /* noop */ }
        }
      }, 200)
    } catch (err) {
      releaseStream()
      onAfterStop?.()
      if (!mountedRef.current) return
      setState('idle')
      // Permission errors are the common case and deserve a plain explanation
      // rather than the browser's raw string.
      const name = err?.name || ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError(mode === 'video'
          ? 'Camera/microphone access was blocked. Allow it in your browser settings to record.'
          : 'Microphone access was blocked. Allow it in your browser settings to record.')
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setError(mode === 'video' ? 'No camera was found on this device.' : 'No microphone was found on this device.')
      } else if (name === 'NotReadableError') {
        setError('Your camera or mic is in use by another app. Close it and try again.')
      } else {
        setError(err?.message || 'Could not start recording')
      }
    }
  }, [state, mode, maxBytes, maxDurationMs, onBeforeStart, onAfterStop, releaseStream])

  const stop = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    autoStopRef.current = ''
    try { rec.stop() } catch { /* already stopping */ }
  }, [])

  const pause = useCallback(() => {
    const rec = recorderRef.current
    if (rec?.state !== 'recording') return
    try {
      rec.pause()
      pauseAtRef.current = Date.now()
      setState('paused')
    } catch { /* pause unsupported on this browser — ignore, keep recording */ }
  }, [])

  const resume = useCallback(() => {
    const rec = recorderRef.current
    if (rec?.state !== 'paused') return
    try {
      rec.resume()
      pausedMsRef.current += Date.now() - pauseAtRef.current
      setState('recording')
    } catch { /* noop */ }
  }, [])

  // Abandon the take entirely: stop the device, drop the data, reset to idle.
  const cancel = useCallback(() => {
    clearTick()
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      // Neutralise onstop so it doesn't publish a result for a cancelled take.
      rec.onstop = () => { releaseStream(); onAfterStop?.() }
      try { rec.stop() } catch { /* noop */ }
    } else {
      releaseStream()
      onAfterStop?.()
    }
    recorderRef.current = null
    chunksRef.current = []
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    setResult(null)
    setState('idle')
    setElapsed(0)
    setBytes(0)
    setError('')
  }, [releaseStream, onAfterStop])

  // Drop the finished take but stay ready to record another.
  const reset = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    setResult(null)
    setState('idle')
    setElapsed(0)
    setBytes(0)
    setError('')
  }, [])

  return {
    state, elapsedMs, bytes, result, error, stream,
    isRecording: state === 'recording',
    isPaused: state === 'paused',
    start, stop, pause, resume, cancel, reset,
    supported: isRecordingSupported(),
  }
}
