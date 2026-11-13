import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import ClashCard from './ClashCard.jsx'

// In-app replacement for the browser's "localhost says…" confirm when a booking
// puts someone in two places at once (server code PERSON_CLASH). A card slides
// in at the top-right, lists the clashes person by person, and waits for
// "Save anyway" or "Don't save". Esc = don't save.
//
// Called from plain code (saveWithClashCheck), not from a component, so the
// card renders into its own small React root. Asks are queued: a grid save that
// hits several clashes shows them one after another, never two cards at once.

let root = null
let queue = Promise.resolve()

export function askClashConfirm(opts) {
  const p = queue.then(() => new Promise((resolve) => {
    if (!root) {
      const el = document.createElement('div')
      document.body.appendChild(el)
      root = createRoot(el)
    }
    const done = (ok) => { root.render(null); resolve(ok) }
    root.render(createElement(ClashCard, { ...opts, onDone: done }))
  }))
  queue = p.catch(() => {})
  return p
}
