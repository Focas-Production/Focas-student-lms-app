import { useLayoutEffect, useRef, useState } from 'react'

// A date picker that always reads and writes day/month/year (DD/MM/YYYY).
//
// Why not <input type="date">: the browser renders that in the machine's own
// locale, so an en-US Chrome shows 09/08/2026 for 8 September — there is no
// attribute or CSS that changes it. Our mentors and students read dates as
// date-month-year, so this field owns the display and gives back the same
// ISO value (YYYY-MM-DD) a native date input would, which keeps callers that
// build `${date}T${time}` unchanged.
//
// Typing: digits with slashes auto-inserted after the day and month; a
// hand-typed "8/9/2026" is accepted too. Only a complete, real date is
// committed (31/02 never is); an incomplete or bad entry reverts to the last
// good value on blur and is outlined red while it's wrong.
//
// The calendar popover is position:fixed so it isn't clipped by a scrolling
// modal body — the schedule form's date row sits at the bottom of one.

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' → local-midnight Date, or null
const fromIso = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  return Number.isNaN(d.getTime()) ? null : d
}
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// 'YYYY-MM-DD' → 'DD/MM/YYYY' ('' when unset)
const formatDMY = (iso) => {
  const d = fromIso(iso)
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : ''
}

// 'D/M/YYYY' or 'DD/MM/YYYY' → 'YYYY-MM-DD', or null when incomplete/invalid.
// Round-trips through Date so 31/02/2026 (which JS would roll into March) is
// rejected rather than silently moved.
const parseDMY = (text) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((text || '').trim())
  if (!m) return null
  const [day, month, year] = [+m[1], +m[2], +m[3]]
  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return toIso(d)
}

// Keep only digits and slashes, and drop a slash in as soon as the day or
// month segment is full — but only while the user is adding characters, so
// backspacing over an auto-slash doesn't put it straight back.
const mask = (raw, prev) => {
  let t = raw.replace(/[^\d/]/g, '').replace(/\/{2,}/g, '/').slice(0, 10)
  if (t.length > (prev || '').length && (/^\d{2}$/.test(t) || /^\d{1,2}\/\d{2}$/.test(t))) t += '/'
  return t
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function DateField({ value, onChange, className = '', required, placeholder = 'DD/MM/YYYY', ...rest }) {
  // `draft` is the text while the field is being typed into; null means "show
  // the committed value". Deriving the display this way (instead of syncing
  // state from `value` in an effect) means a pick from the calendar or an
  // outside reset shows up immediately with no extra render.
  const [draft, setDraft] = useState(null)
  const [open, setOpen]   = useState(false)
  const [view, setView]   = useState({ y: 0, m: 0 }) // month shown in the popover
  const wrap = useRef(null)
  const pop  = useRef(null)

  const shown = draft ?? formatDMY(value)
  const invalid = draft !== null && draft.length === 10 && !parseDMY(draft)

  const commit = (iso) => { if (iso !== value) onChange?.(iso) }

  const openPicker = () => {
    const base = fromIso(value) || new Date()
    setView({ y: base.getFullYear(), m: base.getMonth() })
    setOpen(true)
  }

  // Place the popover under (or, near the bottom of the screen, above) the
  // field, and follow it while anything scrolls. Written straight to the DOM
  // node rather than through state: it's pure layout, and re-rendering for it
  // would just be noise.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const a = wrap.current?.getBoundingClientRect()
      const p = pop.current
      if (!a || !p) return
      const w = p.offsetWidth, h = p.offsetHeight
      const below = a.bottom + 4 + h <= window.innerHeight
      p.style.top  = `${below ? a.bottom + 4 : Math.max(8, a.top - 4 - h)}px`
      p.style.left = `${Math.max(8, Math.min(a.left, window.innerWidth - w - 8))}px`
    }
    place()
    const onDown = (e) => {
      if (wrap.current?.contains(e.target) || pop.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 6 rows × 7 days, padded with the neighbouring months' days (greyed) so the
  // grid never jumps in height between months.
  const cells = []
  if (open) {
    const first = new Date(view.y, view.m, 1).getDay()
    for (let i = 0; i < 42; i++) cells.push(new Date(view.y, view.m, 1 - first + i))
  }
  const todayIso = toIso(new Date())
  const step = (n) => setView((v) => {
    const d = new Date(v.y, v.m + n, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const pick = (iso) => { commit(iso); setDraft(null); setOpen(false) }

  return (
    <div ref={wrap} className="relative">
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={`${className} pr-9 ${invalid ? 'border-red-400 focus:border-red-400' : ''}`}
        placeholder={placeholder}
        value={shown}
        required={required}
        aria-invalid={invalid || undefined}
        onFocus={() => setDraft(formatDMY(value))}
        onChange={(e) => {
          const t = mask(e.target.value, draft)
          setDraft(t)
          const iso = parseDMY(t)
          if (iso) commit(iso)
          else if (!t) commit('')
        }}
        onBlur={() => setDraft(null)}
      />
      <button type="button" onClick={() => (open ? setOpen(false) : openPicker())}
        aria-label="Open calendar" tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-teal-600 hover:bg-teal-50">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 11h18" />
        </svg>
      </button>

      {open && (
        <div ref={pop} role="dialog" aria-label="Choose a date"
          className="fixed z-20 w-[272px] rounded-xl border border-gray-200 bg-white shadow-lg p-3 select-none">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => step(-1)} aria-label="Previous month"
              className="h-7 w-7 rounded-lg text-gray-500 hover:bg-gray-100">‹</button>
            <p className="text-sm font-semibold text-gray-800">{MONTHS[view.m]} {view.y}</p>
            <button type="button" onClick={() => step(1)} aria-label="Next month"
              className="h-7 w-7 rounded-lg text-gray-500 hover:bg-gray-100">›</button>
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {WEEKDAYS.map((d) => <span key={d} className="text-[11px] font-bold text-gray-400">{d}</span>)}
            {cells.map((d) => {
              const iso = toIso(d)
              const inMonth = d.getMonth() === view.m
              const selected = iso === value
              return (
                <button key={iso} type="button" onClick={() => pick(iso)}
                  className={[
                    'mx-auto h-8 w-8 rounded-lg text-sm',
                    selected ? 'bg-teal-600 text-white font-semibold'
                      : inMonth ? 'text-gray-800 hover:bg-teal-50' : 'text-gray-300 hover:bg-gray-50',
                    iso === todayIso && !selected ? 'ring-1 ring-teal-400' : '',
                  ].join(' ')}>
                  {d.getDate()}
                </button>
              )
            })}
          </div>
          <div className="flex justify-between mt-2 pt-2 border-t border-gray-100">
            <button type="button" onClick={() => pick('')} className="text-xs font-semibold text-gray-500 hover:text-gray-800">Clear</button>
            <button type="button" onClick={() => pick(todayIso)} className="text-xs font-semibold text-teal-600 hover:text-teal-800">Today</button>
          </div>
        </div>
      )}
    </div>
  )
}
