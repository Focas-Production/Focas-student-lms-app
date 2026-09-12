# MediaPipe assets for background blur

These are served as static files so a live class never waits on an external CDN.
`@livekit/track-processors` would otherwise fetch ~9MB of wasm from
`cdn.jsdelivr.net` and the segmentation model from `storage.googleapis.com` the
first time a mentor turns blur on — a slow or blocked fetch there means the
feature just fails mid-class.

The paths are wired up in `src/hooks/useVideoBackground.js` (`ASSET_PATHS`).

## Refreshing them

`wasm/` must match the `@mediapipe/tasks-vision` version that
`@livekit/track-processors` depends on, so re-copy it after any upgrade of
either package:

```sh
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.* public/mediapipe/wasm/
```

Only the SIMD build is kept. MediaPipe picks between `vision_wasm_internal.*`
and `vision_wasm_nosimd_internal.*` by compiling a tiny SIMD probe module and
fetches just the one it picked — and every browser that can run background blur
at all needs `MediaStreamTrackProcessor` (Chrome/Edge 94+), which is well past
the point where WASM SIMD became standard (Chrome 91). The nosimd pair is
another ~9MB that can never be requested here, so don't copy it back in. If a
browser ever did fall through to it, the button fails gracefully — amber ⚠,
blur switches itself off, class continues.

The model is versioned independently and rarely changes:

```sh
curl -L -o public/mediapipe/selfie_segmenter.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
```

Both files are committed. They are large but they are also the whole point of
having them local — do not gitignore them.
