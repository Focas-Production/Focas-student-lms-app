import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RoomEvent, Track } from 'livekit-client'
import {
  CarouselLayout, Chat, ConnectionStateToast, ControlBar, FocusLayout, GridLayout,
  LayoutContextProvider, ParticipantTile, RoomAudioRenderer, TrackLoop,
  isTrackReference, useCreateLayoutContext, usePinnedTracks, useTracks,
} from '@livekit/components-react'

// The class stage — LiveKit's prebuilt <VideoConference> re-assembled from the
// same primitives, with one difference: the FOCUS layout (someone is sharing
// a screen or is pinned).
//
// The prebuilt one puts the other participants in a narrow column beside the
// share (three faces visible, the rest scroll), or — if you move that column
// to a strip under the share — leaves big black bars either side, because a
// 16:9 share can't fill an area that's wider than 16:9. Neither suits a class
// of ten.
//
// So this measures the stage and the share's real aspect ratio, gives the
// share exactly the width it needs at full height, and lays the students out
// in whatever is left:
//   side  — a grid beside the share, as many columns as lets everyone fit
//           without scrolling (tiles grow when the class is small)
//   strip — a horizontal row under the share when there's no side room
//           (small windows, very wide shares)
//   solo  — just the share (the minimized corner window)
// Grid mode (nobody focused) is LiveKit's own auto-grid, unchanged.
//
// extraControls — the caller's own buttons for the bottom control bar, laid
// out in the same row as LiveKit's (mic, camera, share, chat, leave). Anything
// a participant acts on during class belongs down here, not floating over the
// stage where it covers the tiles' own controls.
export default function ClassStage({ compact = false, extraControls = null }) {
  const [widgetState, setWidgetState] = useState({ showChat: false, unreadMessages: 0, showSettings: false })
  const lastAutoFocused = useRef(null)
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  )
  const layoutContext = useCreateLayoutContext()
  const focusTrack = usePinnedTracks(layoutContext)?.[0]
  const others = tracks.filter((t) => !sameRef(t, focusTrack))

  // Auto-focus a screen share when it starts and clear it when it ends; keep a
  // pinned placeholder pointing at the live track once it's published. Same
  // rules as the prebuilt component.
  useEffect(() => {
    const shares = tracks.filter(isTrackReference).filter((t) => t.publication.source === Track.Source.ScreenShare)
    const dispatch = layoutContext.pin.dispatch
    if (shares.some((t) => t.publication.isSubscribed) && lastAutoFocused.current === null) {
      dispatch?.({ msg: 'set_pin', trackReference: shares[0] })
      lastAutoFocused.current = shares[0]
    } else if (
      lastAutoFocused.current
      && !shares.some((t) => t.publication.trackSid === lastAutoFocused.current?.publication?.trackSid)
    ) {
      dispatch?.({ msg: 'clear_pin' })
      lastAutoFocused.current = null
    }
    if (focusTrack && !isTrackReference(focusTrack)) {
      const updated = tracks.find((t) => t.participant.identity === focusTrack.participant.identity && t.source === focusTrack.source)
      if (updated !== focusTrack && isTrackReference(updated)) dispatch?.({ msg: 'set_pin', trackReference: updated })
    }
  }, [tracks, focusTrack, layoutContext])

  return (
    <div className="lk-video-conference">
      <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
        <div className="lk-video-conference-inner">
          {focusTrack ? (
            <FocusStage focusTrack={focusTrack} others={others} compact={compact} />
          ) : (
            <div className="lk-grid-layout-wrapper">
              <GridLayout tracks={tracks}><ParticipantTile /></GridLayout>
            </div>
          )}
          {/* One row: LiveKit's bar plus the caller's buttons (styles in LiveRoom's LIVE_LAYOUT_CSS) */}
          <div className="focas-control-row">
            <ControlBar controls={{ chat: true, settings: false }} />
            {extraControls && <div className="focas-extra-controls">{extraControls}</div>}
          </div>
        </div>
        <Chat style={{ display: widgetState.showChat ? 'grid' : 'none' }} />
      </LayoutContextProvider>
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  )
}

// components-core's isEqualTrackRef, which the React package doesn't export.
function sameRef(a, b) {
  if (!a || !b) return false
  if (isTrackReference(a) && isTrackReference(b)) return a.publication.trackSid === b.publication.trackSid
  return a.participant.identity === b.participant.identity && a.source === b.source
}

const GAP = 8          // --lk-grid-gap (0.5rem)
const PAD = 8          // .lk-focus-layout padding
const MIN_SIDE = 230   // narrower than this and a side grid isn't worth it
const MIN_TILE_W = 110 // below this, faces are unreadable — scroll instead
const TILE_RATIO = 16 / 10

function FocusStage({ focusTrack, others, compact }) {
  const wrapRef = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [videoAr, setVideoAr] = useState(null)

  // Stage size, live — the window resizes, the chat opens, the strip appears.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setBox((b) => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The share's real aspect ratio, from the <video> once frames arrive (a
  // window share can be any shape, and can change when the window is resized).
  // Until then, the publication's advertised dimensions, then 16:9.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    let video = null
    const read = () => { if (video?.videoWidth && video?.videoHeight) setVideoAr(video.videoWidth / video.videoHeight) }
    const attach = () => {
      const v = el.querySelector('.focas-focus-main video')
      if (v === video) return
      video?.removeEventListener('resize', read)
      video?.removeEventListener('loadedmetadata', read)
      video = v
      if (v) {
        v.addEventListener('resize', read)
        v.addEventListener('loadedmetadata', read)
        requestAnimationFrame(read)
      }
    }
    const mo = new MutationObserver(attach)
    mo.observe(el, { childList: true, subtree: true })
    requestAnimationFrame(attach)
    return () => {
      mo.disconnect()
      video?.removeEventListener('resize', read)
      video?.removeEventListener('loadedmetadata', read)
    }
  }, [focusTrack])

  const dims = focusTrack?.publication?.dimensions
  const ar = videoAr || (dims?.width && dims?.height ? dims.width / dims.height : 16 / 9)

  const W = Math.max(0, box.w - PAD * 2)
  const H = Math.max(0, box.h - PAD * 2)
  const n = others.length
  let mode = 'solo'
  let columns = 'minmax(0, 1fr)'
  let rows = 'minmax(0, 1fr)'
  let sideCols = 1
  if (!compact && n > 0 && W > 0 && H > 0) {
    // Whichever arrangement shows the share LARGER wins: a side column takes
    // width, a strip takes height — which one hurts less depends on the
    // share's shape and the window's. (Strip height mirrors the CSS clamp.)
    const stripH = Math.min(132, Math.max(88, window.innerHeight * 0.16))
    const sideShare = fit(ar, W - MIN_SIDE - GAP, H)
    const stripShare = fit(ar, W, H - stripH - GAP)
    if (sideShare.w > 0 && sideShare.w * sideShare.h >= stripShare.w * stripShare.h) {
      mode = 'side'
      const sideW = Math.round(W - sideShare.w - GAP)   // ≥ MIN_SIDE by construction
      columns = `minmax(0, 1fr) ${sideW}px`
      sideCols = pickCols(n, sideW, H)
    } else {
      mode = 'strip'
      rows = `minmax(0, 1fr) ${Math.round(stripH)}px`
    }
  }

  return (
    <div ref={wrapRef} className="lk-focus-layout-wrapper">
      <div
        className="lk-focus-layout focas-focus"
        data-mode={mode}
        style={{ gridTemplateColumns: columns, gridTemplateRows: rows }}
      >
        <div className="focas-focus-main">
          <FocusLayout trackRef={focusTrack} />
        </div>
        {mode === 'side' && (
          <div className="focas-side-grid" style={{ gridTemplateColumns: `repeat(${sideCols}, minmax(0, 1fr))` }}>
            <TrackLoop tracks={others}><ParticipantTile /></TrackLoop>
          </div>
        )}
        {mode === 'strip' && (
          <CarouselLayout tracks={others} orientation="horizontal"><ParticipantTile /></CarouselLayout>
        )}
      </div>
    </div>
  )
}

// Largest w×h box of aspect `ar` that fits inside maxW×maxH (0×0 if no room).
function fit(ar, maxW, maxH) {
  if (maxW <= 0 || maxH <= 0) return { w: 0, h: 0 }
  const w = Math.min(maxW, maxH * ar)
  return { w, h: w / ar }
}

// Fewest columns that let all n tiles fit in w×h without scrolling — so tiles
// are as large as possible. If nothing fits, use the most columns that keep
// tiles readable and let the grid scroll.
function pickCols(n, w, h) {
  const maxCols = Math.max(1, Math.floor((w + GAP) / (MIN_TILE_W + GAP)))
  for (let c = 1; c <= maxCols; c++) {
    const tileW = (w - GAP * (c - 1)) / c
    const rowsN = Math.ceil(n / c)
    const total = rowsN * (tileW / TILE_RATIO) + GAP * (rowsN - 1)
    if (total <= h) return c
  }
  return maxCols
}
