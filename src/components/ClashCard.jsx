import { useEffect } from 'react'

// The card askClashConfirm() shows — see clashConfirm.js.

const MAX_PER_PERSON = 5

// '…is already hosting "Title" (Room 1 · Track 1, 7:00 pm–10:00 pm)'
//   → { where: 'Room 1 · Track 1, 7:00 pm–10:00 pm', title: 'Title' }
function splitLine(text = '') {
  const m = text.match(/"(.*)" \(([^()]*)\)\s*$/)
  return m ? { where: m[2], title: m[1] } : { where: text, title: '' }
}

// One group per person: the mentor first, then students, in server order.
function groupByPerson(clashes) {
  const groups = new Map()
  for (const c of clashes || []) {
    const key = `${c.kind}|${c.userId || c.name}`
    const g = groups.get(key) || { kind: c.kind, name: c.name || (c.kind === 'host' ? 'The mentor' : 'A student'), items: [] }
    g.items.push(splitLine(c.text))
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => (a.kind === 'host' ? 0 : 1) - (b.kind === 'host' ? 0 : 1))
}

export default function ClashCard({ clashes, message, context, onDone }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onDone(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  const groups = groupByPerson(clashes)

  return (
    <div role="alertdialog" aria-labelledby="clash-title"
      className="fixed top-4 right-4 z-[70] w-[min(28rem,calc(100vw-2rem))] bg-white rounded-2xl shadow-2xl border border-amber-200 overflow-hidden animate-[clashIn_.18s_ease-out]">
      <style>{'@keyframes clashIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}'}</style>
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-2 bg-amber-50 border-b border-amber-100">
        <span className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-600 text-base shrink-0">⚠</span>
        <div className="flex-1 min-w-0">
          <p id="clash-title" className="text-sm font-bold text-gray-900">Booked in two places at the same time</p>
          {context && <p className="text-[11px] text-gray-500 truncate" title={context}>{context}</p>}
        </div>
        <button type="button" onClick={() => onDone(false)} aria-label="Close" title="Close (don't save)"
          className="flex items-center justify-center w-8 h-8 rounded-full bg-white border border-gray-300 text-gray-700 text-base font-bold leading-none shadow-sm shrink-0 hover:bg-gray-100 hover:text-gray-900 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400">✕</button>
      </div>

      <div className="px-4 py-3 max-h-[50vh] overflow-y-auto space-y-2.5">
        {groups.length ? groups.map((g, i) => (
          <div key={i}>
            <p className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
              <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                g.kind === 'host' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>
                {g.kind === 'host' ? 'Mentor' : 'Student'}
              </span>
              {g.name}
              <span className="font-normal text-gray-400">· already {g.kind === 'host' ? 'teaching' : 'in'}</span>
            </p>
            <ul className="mt-1 ml-1 space-y-0.5">
              {g.items.slice(0, MAX_PER_PERSON).map((it, j) => (
                <li key={j} className="text-[11px] text-gray-600 flex gap-1.5" title={it.title}>
                  <span className="text-amber-400">•</span>{it.where}
                </li>
              ))}
              {g.items.length > MAX_PER_PERSON && (
                <li className="text-[11px] text-gray-400 ml-3">…and {g.items.length - MAX_PER_PERSON} more</li>
              )}
            </ul>
          </div>
        )) : (
          <p className="text-xs text-gray-600 whitespace-pre-line">{message}</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/60">
        <button type="button" onClick={() => onDone(false)}
          className="px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white text-gray-600 text-xs font-semibold hover:bg-gray-50">
          Don't save
        </button>
        <button type="button" onClick={() => onDone(true)}
          className="px-3.5 py-1.5 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600">
          Save anyway
        </button>
      </div>
    </div>
  )
}
