// Tiny synthesized sounds for live-class prompts — no audio asset to load or
// fail. Each note is [frequencyHz, startOffsetSec, volume?].
//
// Browsers create an AudioContext SUSPENDED unless the page has been clicked,
// and notes scheduled on a suspended context are silently lost. So the context
// is created and resumed on the user's first click/key on the page (they always
// click Join/Start before any of these can fire), and every play waits for
// resume() before scheduling.
let ctx = null

function getCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!ctx) ctx = new Ctx()
  return ctx
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    try { getCtx()?.resume?.() } catch { /* no audio */ }
  }
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true })
  window.addEventListener('keydown', unlock, { capture: true })
}

export async function playTones(notes) {
  try {
    const c = getCtx()
    if (!c) return
    if (c.state !== 'running') await c.resume()
    const t0 = c.currentTime + 0.02
    for (const [freq, at, vol = 0.22] of notes) {
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.34)
      osc.connect(gain).connect(c.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.36)
    }
  } catch {
    // Sound is a nicety — the on-screen prompt still shows.
  }
}

// One event can reach a page twice (the room push AND a poll that notices the
// same change) — ring once per key.
const rung = new Set()
export function once(key, play) {
  if (!key || rung.has(key)) return
  rung.add(key)
  play()
}

// "Your answer is needed": a bright rising three-note call, played twice.
export const playAsk = () => playTones([
  [659.25, 0, 0.26], [880, 0.14, 0.26], [1174.66, 0.28, 0.26],
  [659.25, 0.75, 0.22], [880, 0.89, 0.22], [1174.66, 1.03, 0.22],
])
// Gentle nudge while a question is still waiting.
export const playNudge = () => playTones([[880, 0, 0.18], [1174.66, 0.14, 0.18]])
// Done / accepted: a short upward pair.
export const playConfirmed = () => playTones([[784, 0, 0.24], [1046.5, 0.13, 0.26]])
// No / declined: a clear falling pair, twice — it must be heard over the class.
export const playDeclined = () => playTones([
  [880, 0, 0.3], [587.33, 0.18, 0.3],
  [880, 0.6, 0.28], [587.33, 0.78, 0.28],
])
