import { useCallback, useEffect, useRef, useState } from 'react'

// Picture-in-picture for the live room — the Google Meet kind: a small
// always-on-top window that keeps floating when the mentor switches tabs or
// apps. (Not to be confused with "Minimize", which only shrinks the room to a
// corner of THIS page.)
//
// Engines, picked by what the browser offers:
//   document — Document Picture-in-Picture (Chrome / Edge 116+ on desktop). We
//              get a real window to render React into, so the pop-out carries
//              the stage video AND the controls (mic, camera, share, leave),
//              exactly like Meet's.
//   video    — classic <video>.requestPictureInPicture() (Safari, Chrome on
//              Android), or WebKit's presentation mode on iOS. Only the stage
//              video floats; controls stay in the tab.
//
// Auto mode (document engine only): with `autoEnabled`, we register the Media
// Session "enterpictureinpicture" action. Chrome fires it — no click needed —
// when the user switches away from a tab that is using the camera or mic, and
// closes that window itself when they come back. That's how Meet pops out on
// its own. Chrome's conditions (chrome/browser/picture_in_picture/
// auto_picture_in_picture_tab_helper.cc): page is https://, tab is capturing
// camera/mic (or audibly playing with high media engagement), the action is
// registered, no other PiP window exists anywhere, and the site's "Automatic
// picture-in-picture" setting isn't Block — in the default Ask state the
// window opens with an allow-once / always / never prompt inside it.
//
// Lifetime facts worth knowing (verified against Chromium's controller):
//   • The browser closes a document-PiP window ONLY when the opener navigates,
//     the tab closes, or the page calls close(). Hiding the tab does NOT.
//   • Chrome allows ONE PiP window browser-wide. Another tab opening its own
//     (Google Meet does so automatically) evicts ours — we detect that and say so.
//
// livekit-client knows about both engines: a video element inside the PiP
// window counts as visible, so remote video is NOT paused when the tab goes to
// the background (its usual adaptive-stream behaviour).
//
// `getStageVideo()` returns the <video> to float in video mode.

const HINTS = {
  // A close we didn't request while the tab was hidden is almost always an
  // eviction (one PiP window per browser); it could still be the user's ✕, so
  // the wording hedges.
  evicted:
    'Pop-out closed. If you didn’t close it yourself, another tab’s picture-in-picture (e.g. a Google Meet call, '
    + 'which pops out automatically) took over — Chrome allows only one. Close that and pop out again.',
  videoGone: 'Pop-out closed. If you didn’t close it yourself, the stage layout changed — pop out again to float the new stage.',
  insecure:  'Picture-in-picture only works over https (or localhost) — open the app on a secure address.',
  noSupport: "This browser can't float the class — use Chrome or Edge on a computer.",
  noVideo:   'Nothing on stage to float yet — turn on a camera or share a screen first.',
}

const hasWebkitPiP = () =>
  typeof HTMLVideoElement !== 'undefined' && 'webkitSetPresentationMode' in HTMLVideoElement.prototype

// `rearmKey`: bump it whenever the page's media player (see LiveRoom's
// LocalMediaProbe keep-alive) has just started — the handler is re-registered
// then. Chrome attaches a page's Media Session service to the tab's session
// only once that session exists, and it comes into being with the first
// player; a handler registered earlier is never seen by auto-PiP.
export function usePictureInPicture({ getStageVideo, autoEnabled = false, rearmKey = 0 } = {}) {
  const [pipWindow, setPipWindow] = useState(null)   // document mode: the Window
  const [pipVideo, setPipVideo]   = useState(null)   // video mode: the floated <video>
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  const canDocument   = typeof window !== 'undefined' && 'documentPictureInPicture' in window
  const canVideo      = typeof document !== 'undefined' && (!!document.pictureInPictureEnabled || hasWebkitPiP())
  const supported     = canDocument || canVideo
  const autoSupported = canDocument && typeof navigator !== 'undefined' && !!navigator.mediaSession?.setActionHandler
  // Chromium's AutoPictureInPictureTabHelper only considers https:// (and
  // file://) pages — http://localhost is a secure context for everything else,
  // but NOT for auto-PiP. The production site is https; dev servers usually
  // aren't, so surface this rather than look broken.
  const autoNeedsHttps = autoSupported && typeof location !== 'undefined'
    && location.protocol !== 'https:' && location.protocol !== 'file:'
  const active        = !!pipWindow || !!pipVideo
  const mode          = pipWindow ? 'document' : pipVideo ? 'video' : null

  // Latest handles for callbacks that can't see fresh state (unmount cleanup,
  // the media-session handler).
  const winRef  = useRef(null)
  const vidRef  = useRef(null)
  const busyRef = useRef(false)
  useEffect(() => { winRef.current = pipWindow }, [pipWindow])
  useEffect(() => { vidRef.current = pipVideo }, [pipVideo])
  // Set when WE close the window, so the close handler can tell our close apart
  // from the browser's (user hit ✕, evicted by another PiP, auto-PiP returned).
  const closingRef = useRef(false)
  // The open window was opened by auto-PiP — Chrome closes that one itself
  // when the tab is shown again, which must not read as an eviction.
  const autoRef = useRef(false)
  const hintTimer = useRef(null)
  useEffect(() => () => clearTimeout(hintTimer.current), [])

  const close = useCallback((reason = 'app') => {
    const v = vidRef.current
    if (!winRef.current && !v) return              // nothing open — no-op (StrictMode, double calls)
    closingRef.current = true
    console.info('[pip] closing', { reason })
    try { winRef.current?.close() } catch { /* already gone */ }
    if (v) {
      if (document.pictureInPictureElement === v) document.exitPictureInPicture().catch(() => {})
      else if (v.webkitPresentationMode === 'picture-in-picture') { try { v.webkitSetPresentationMode('inline') } catch { /* ignore */ } }
    }
  }, [])

  // Leaving the room (component unmount) takes the floating window with it.
  useEffect(() => () => close('room unmounted'), [close])

  // Show a hint for 12s of *visible* time: if the tab is hidden right now the
  // mentor can't see it, so the countdown starts when they come back.
  const showHint = useCallback((msg) => {
    setError(msg)
    clearTimeout(hintTimer.current)
    const startTimer = () => {
      hintTimer.current = setTimeout(() => setError((e) => (e === msg ? '' : e)), 12_000)
    }
    if (document.visibilityState === 'visible') { startTimer(); return }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', onVisible)
      startTimer()
    }
    document.addEventListener('visibilitychange', onVisible)
  }, [])

  // The window went away. If we didn't ask for it, say why — the mentor
  // otherwise just sees it vanish. Only when the tab was hidden at the time:
  // a close while they're looking at the room is their own ✕ click.
  const onClosedExternally = useCallback((engine) => {
    const byUs = closingRef.current
    const auto = autoRef.current
    const hidden = document.visibilityState === 'hidden'
    closingRef.current = false
    autoRef.current = false
    console.info('[pip] window closed', { engine, byUs, auto, mainTabVisibility: document.visibilityState })
    if (byUs || !hidden) return
    showHint(engine === 'video' ? HINTS.videoGone : HINTS.evicted)
  }, [showHint])

  const open = useCallback(async ({ width = 400, height = 300, auto = false } = {}) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      if (canDocument) {
        // Must be called straight from the click (transient activation) — no
        // awaits before this line. Auto-PiP calls are exempt from activation.
        const pw = await window.documentPictureInPicture.requestWindow({ width, height })
        copyStyles(document, pw.document)
        Object.assign(pw.document.body.style, {
          margin: '0', background: '#0b0b0f', overflow: 'hidden', height: '100vh',
        })
        // The window going away (✕, Esc, eviction, auto-PiP return) ends the mode.
        pw.addEventListener('pagehide', () => {
          setPipWindow((w) => (w === pw ? null : w))
          onClosedExternally('document')
        })
        closingRef.current = false
        autoRef.current = auto
        console.info(`[pip] opened (document mode${auto ? ', auto' : ''})`)
        setPipWindow(pw)
        return
      }
      if (canVideo) {
        const v = getStageVideo?.()
        if (!v) throw new Error(HINTS.noVideo)
        if (document.pictureInPictureEnabled && typeof v.requestPictureInPicture === 'function') {
          await v.requestPictureInPicture()
          v.addEventListener('leavepictureinpicture', () => {
            setPipVideo((cur) => (cur === v ? null : cur))
            onClosedExternally('video')
          }, { once: true })
        } else if (v.webkitSupportsPresentationMode?.('picture-in-picture')) {
          // iOS Safari
          v.webkitSetPresentationMode('picture-in-picture')
          const onMode = () => {
            if (v.webkitPresentationMode === 'picture-in-picture') return
            v.removeEventListener('webkitpresentationmodechanged', onMode)
            setPipVideo((cur) => (cur === v ? null : cur))
            onClosedExternally('video')
          }
          v.addEventListener('webkitpresentationmodechanged', onMode)
        } else {
          throw new Error(HINTS.noSupport)
        }
        closingRef.current = false
        console.info('[pip] opened (video mode — no Document PiP in this browser)')
        setPipVideo(v)
        return
      }
      throw new Error(window.isSecureContext === false ? HINTS.insecure : HINTS.noSupport)
    } catch (e) {
      // AbortError = the user dismissed the browser's own prompt; not an error.
      if (e?.name !== 'AbortError') setError(e?.message || 'Could not open picture-in-picture')
      console.warn('[pip] open failed', e)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [canDocument, canVideo, getStageVideo, onClosedExternally])

  // Auto-PiP: Chrome invokes this when the tab is hidden while we're using the
  // camera/mic. Registered once per enable/disable; the ref keeps it current.
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])
  useEffect(() => {
    if (!autoEnabled || !autoSupported) return undefined
    const unregister = () => { try { navigator.mediaSession.setActionHandler('enterpictureinpicture', null) } catch { /* ignore */ } }
    // Re-arm slightly after the player started: the "playing" event and the
    // browser-side player registration travel separately, and the handler must
    // land after the tab's media session exists.
    const t = setTimeout(() => {
      unregister()
      try {
        navigator.mediaSession.setActionHandler('enterpictureinpicture', () => {
          if (winRef.current) return             // already floating (manual) — leave it
          return openRef.current({ auto: true })
        })
        console.info('[pip] auto pop-out armed', { rearmKey })
      } catch {
        // action unknown to this browser
      }
    }, rearmKey ? 400 : 0)
    return () => { clearTimeout(t); unregister() }
  }, [autoEnabled, autoSupported, rearmKey])

  const toggle = useCallback(() => { if (active) close('toggle'); else open() }, [active, close, open])
  const clearError = useCallback(() => setError(''), [])

  return {
    supported, autoSupported, autoNeedsHttps, active, mode, pipWindow, busy, error,
    open, close, toggle, clearError,
  }
}

// The PiP document starts empty — bring the app's stylesheets across so the
// pop-out inherits the reset/fonts. Cross-origin sheets (whose rules we can't
// read) are re-linked instead.
function copyStyles(from, to) {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n')
      const style = to.createElement('style')
      style.textContent = css
      to.head.appendChild(style)
    } catch {
      if (sheet.href) {
        const link = to.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        to.head.appendChild(link)
      }
    }
  }
}

// For video-mode fallback: the biggest playing <video> on the stage — that's
// the focused tile (a screen share, or the speaker) in LiveKit's layout.
export function pickStageVideo(root) {
  if (!root) return null
  const vids = Array.from(root.querySelectorAll('video'))
    .filter((v) => v.srcObject && v.readyState >= 2 && !v.ended)
  vids.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))
  return vids[0] || null
}
