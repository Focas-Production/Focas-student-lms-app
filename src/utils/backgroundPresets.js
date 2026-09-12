// Preset backgrounds for the live-class background panel.
//
// These are drawn in the browser rather than shipped as image files, which
// keeps two problems away: no megabytes of photos in the repo, and no stock
// photo licensing to worry about. Gradients also happen to sit better behind a
// talking head than a busy photo does — nothing competes with the mentor.
//
// To add real photo presets, drop files in public/backgrounds/ and add entries
// with a `src` instead of `stops`; the panel handles both.

// Ceiling for a mentor's uploaded image.
const W = 1280
const H = 720

// Presets are generated smaller and as JPEG on purpose. A smooth gradient
// upscales losslessly, and as a 720p PNG each one came out at 1.2MB of data:
// URL held in memory — for four presets that is megabytes to save a few
// kilobytes of banding nobody can see behind a person.
const PRESET_W = 854
const PRESET_H = 480

export const BACKGROUND_PRESETS = [
  { id: 'slate', label: 'Slate', stops: ['#475569', '#0f172a'] },
  { id: 'teal', label: 'Teal', stops: ['#0f766e', '#134e4a'] },
  { id: 'warm', label: 'Warm', stops: ['#c9b394', '#6b5740'] },
  { id: 'light', label: 'Light', stops: ['#f1f5f9', '#94a3b8'] },
]

const cache = new Map()

/**
 * The preset as a data: URL, drawn once and reused. Returns '' if canvas is
 * unavailable, which the caller treats as "preset not offered".
 */
export function presetDataUrl(id) {
  if (cache.has(id)) return cache.get(id)
  const preset = BACKGROUND_PRESETS.find((p) => p.id === id)
  if (!preset) return ''
  if (preset.src) {
    cache.set(id, preset.src)
    return preset.src
  }
  let url
  try {
    const canvas = document.createElement('canvas')
    canvas.width = PRESET_W
    canvas.height = PRESET_H
    const ctx = canvas.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, PRESET_W * 0.45, PRESET_H)
    grad.addColorStop(0, preset.stops[0])
    grad.addColorStop(1, preset.stops[1])
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, PRESET_W, PRESET_H)
    // A soft vignette keeps the edges from looking like a flat colour swatch.
    const vignette = ctx.createRadialGradient(
      PRESET_W / 2, PRESET_H / 2, PRESET_H * 0.2,
      PRESET_W / 2, PRESET_H / 2, PRESET_H * 0.85,
    )
    vignette.addColorStop(0, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, 'rgba(0,0,0,0.28)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, PRESET_W, PRESET_H)
    url = canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    url = ''
  }
  cache.set(id, url)
  return url
}

/**
 * Shrinks a user-picked file to something sane and returns it as a JPEG data
 * URL. Uploads go into localStorage, which is only a few MB, so a 4MB phone
 * photo has to come down before it is stored.
 */
export function fileToBackgroundDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('That file is not an image.'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('That image could not be read.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That image could not be read.'))
      img.onload = () => {
        try {
          const scale = Math.min(1, W / img.width, H / img.height)
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(img.width * scale))
          canvas.height = Math.max(1, Math.round(img.height * scale))
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        } catch {
          reject(new Error('That image could not be used.'))
        }
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
