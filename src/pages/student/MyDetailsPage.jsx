// Student → My Details. The admission form Foundation students fill once,
// as five short steps that fit a phone screen:
//   1 Contact · 2 Address · 3 School · 4 Documents · 5 Review & submit
// Each "Next" checks that step and saves it as a draft, so nothing typed is
// lost if the student closes the app halfway. Documents upload the moment
// they're picked. After submitting, the page opens on the Review step, which
// doubles as a summary with an Edit link per section; if the office asked for
// a re-upload it opens on Documents instead.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../api'
import DetailsDocCard from '../../components/DetailsDocCard'
import {
  phoneForInput, notifyDetailsChanged, validateStep, INDIAN_STATES,
} from '../../lib/studentDetails'

const BASE = '/api/student-details/me'

const STEPS = [
  { key: 'contact', title: 'Contact',   heading: 'Contact numbers',  sub: 'Your number and your parent’s — both on WhatsApp.' },
  { key: 'address', title: 'Address',   heading: 'Home address',     sub: 'Where you live now.' },
  { key: 'school',  title: 'School',    heading: 'School details',   sub: 'The school you study in.' },
  { key: 'docs',    title: 'Documents', heading: 'Documents',        sub: 'A clear photo or a PDF of each.' },
  { key: 'review',  title: 'Review',    heading: 'Check and submit', sub: 'Make sure everything is right.' },
]

// Which field belongs to which step — used to open on the first unfinished one.
const MISSING_STEP = {
  'Student WhatsApp number': 0, 'Parent name': 0, 'Parent WhatsApp number': 0,
  Address: 1, City: 1, State: 1, Pincode: 1,
  'School name': 2, 'School city': 2, Board: 2, 'Board name': 2, 'Subjects taken': 2,
}

// Most students are in Tamil Nadu: an empty state starts there, still changeable.
const DEFAULT_STATE = 'Tamil Nadu'

function toForm(d) {
  return {
    studentPhone: phoneForInput(d.studentPhone),
    parentName:   d.parentName,
    parentPhone:  phoneForInput(d.parentPhone),
    address: { ...d.address, state: d.address.state || DEFAULT_STATE },
    school:  { ...d.school, subjects: [...d.school.subjects] },
  }
}

function startStep(d) {
  if (d.locked) return 4
  if (d.status === 'needs_fix') return 3
  if (d.submittedAt) return 4
  const steps = d.missing.map(m => MISSING_STEP[m] ?? 3)
  return steps.length ? Math.min(...steps) : 4
}

const scrollTop = () => {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
}

// text-base on phones: iOS zooms the page into any input under 16px.
const inputBase = 'w-full h-12 px-3.5 rounded-xl border bg-white text-base sm:text-sm text-gray-900 outline-none transition focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-gray-300'
const inputCls = (err) => `${inputBase} ${err ? 'border-rose-400 bg-rose-50/40' : 'border-gray-200'}`

function Field({ id, label, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      {children}
      {error
        ? <p id={`${id}-err`} className="text-xs text-rose-600 mt-1.5" role="alert">{error}</p>
        : hint && <p className="text-xs text-gray-400 mt-1.5">{hint}</p>}
    </div>
  )
}

function PhoneInput({ id, value, onChange, error }) {
  return (
    <div className={`flex items-stretch rounded-xl border overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 ${error ? 'border-rose-400' : 'border-gray-200'}`}>
      <span className="px-3 flex items-center bg-gray-50 text-gray-500 text-base sm:text-sm border-r border-gray-200">+91</span>
      <input id={id} type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="10-digit mobile"
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
        value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
        className="flex-1 min-w-0 h-12 px-3.5 text-base sm:text-sm outline-none bg-white" />
    </div>
  )
}

function Stepper({ step, maxReached, onJump }) {
  return (
    <div>
      {/* Each bar sits in a 40px-tall button so a finger can hit it. */}
      <div className="flex gap-1.5 -my-4">
        {STEPS.map((s, i) => (
          <button key={s.key} type="button" disabled={i > maxReached} onClick={() => onJump(i)}
            aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === step ? 'step' : undefined}
            className="flex-1 h-10 flex items-center disabled:cursor-default">
            <span className={`block w-full h-1.5 rounded-full transition-colors ${i <= step ? 'bg-indigo-600' : i <= maxReached ? 'bg-indigo-200' : 'bg-gray-200'}`} />
          </button>
        ))}
      </div>
      <p className="text-xs font-semibold text-indigo-600 mt-2">Step {step + 1} of {STEPS.length} · {STEPS[step].title}</p>
    </div>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <span className="text-sm text-gray-500 flex-shrink-0">{label}</span>
      <span className={`text-sm text-right break-words min-w-0 ${value ? 'text-gray-900 font-medium' : 'text-rose-500'}`}>{value || 'Not filled'}</span>
    </div>
  )
}

function SummaryCard({ title, onEdit, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-bold text-gray-900">{title}</p>
        {onEdit && <button type="button" onClick={onEdit} className="text-sm font-semibold text-indigo-600 h-10 px-3 -mr-3 -my-2">Edit</button>}
      </div>
      <div className="divide-y divide-gray-50">{children}</div>
    </div>
  )
}

const STATUS_CARD = {
  submitted: { icon: '⏳', cls: 'bg-indigo-50 border-indigo-100 text-indigo-900', title: 'Submitted', text: 'The FOCAS Edu office will check your documents. You can still correct your details here.' },
  approved:  { icon: '✅', cls: 'bg-emerald-50 border-emerald-100 text-emerald-900', title: 'All approved', text: 'Your details and documents are approved, so they can’t be changed here any more. To correct anything, contact the FOCAS Edu office.' },
  needs_fix: { icon: '⚠️', cls: 'bg-rose-50 border-rose-100 text-rose-900', title: 'Please upload again', text: 'The office could not accept a document. See the reason on the red card and upload it again.' },
}

export default function MyDetailsPage() {
  const [details, setDetails] = useState(null)
  const [options, setOptions] = useState(null)
  const [form, setForm]       = useState(null)
  const [step, setStep]       = useState(0)
  const [maxReached, setMax]  = useState(0)
  const [errors, setErrors]   = useState({})
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving]   = useState(false)
  const [saveError, setSaveError] = useState('')
  const [dirty, setDirty]     = useState(false)
  const [uploading, setUploading] = useState(0)    // documents uploading right now
  const [confirmed, setConfirmed] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)
  const [savedNote, setSavedNote] = useState(false)   // "Saved" after editing a submitted form
  const [otherSubject, setOtherSubject] = useState('')
  const formRef = useRef(null)

  useEffect(() => {
    apiFetch(BASE)
      .then(r => {
        const s = startStep(r.details)
        setDetails(r.details); setOptions(r.options); setForm(toForm(r.details))
        setStep(s); setMax(r.details.submittedAt ? STEPS.length - 1 : s)
      })
      .catch(err => setLoadError(err.message))
  }, [])

  // Closing the tab with unsaved typing or an upload running → browser asks first.
  useEffect(() => {
    if (!dirty && !uploading) return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty, uploading])

  const subjectChips = useMemo(() => {
    if (!options || !form) return []
    const extra = form.school.subjects.filter(s => !options.subjects.some(o => o.toLowerCase() === s.toLowerCase()))
    return [...options.subjects, ...extra]
  }, [options, form])

  if (loadError) {
    return (
      <div className="p-6 max-w-md mx-auto text-center">
        <p className="text-sm text-rose-600">{loadError}</p>
        <button onClick={() => window.location.reload()} className="mt-3 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Try again</button>
      </div>
    )
  }
  if (!details || !form) {
    return (
      <div className="px-4 py-6 max-w-xl mx-auto space-y-3 animate-pulse">
        <div className="h-6 w-40 bg-gray-200 rounded" />
        <div className="h-2 bg-gray-200 rounded-full" />
        <div className="h-48 bg-white rounded-2xl" />
      </div>
    )
  }
  if (!details.required) {
    return (
      <div className="p-6 text-sm text-gray-500 text-center">
        These details are only needed from Foundation students.{' '}
        <Link to="/student/profile" className="text-indigo-600 font-semibold">Back to profile</Link>
      </div>
    )
  }

  const locked = !!details.locked
  const cur = locked ? STEPS[STEPS.length - 1] : STEPS[step]

  const set = (path, value) => {
    setDirty(true); setSaveError(''); setSavedNote(false)
    setErrors(e => {
      if (!e[path]) return e
      const n = { ...e }; delete n[path]; return n
    })
    setForm(f => {
      const next = structuredClone(f)
      const parts = path.split('.')
      let c = next
      for (let i = 0; i < parts.length - 1; i++) c = c[parts[i]]
      c[parts.at(-1)] = value
      return next
    })
  }

  const hasSubject = (s) => form.school.subjects.some(x => x.toLowerCase() === s.toLowerCase())
  const toggleSubject = (s) => set('school.subjects', hasSubject(s) ? form.school.subjects.filter(x => x.toLowerCase() !== s.toLowerCase()) : [...form.school.subjects, s])
  const addOther = () => {
    const s = otherSubject.replace(/\s+/g, ' ').trim()
    if (!s) return
    if (!hasSubject(s)) set('school.subjects', [...form.school.subjects, s])
    setOtherSubject('')
  }

  const goTo = (i) => { setStep(i); setMax(m => Math.max(m, i)); setSaveError(''); scrollTop() }

  // Upload results carry the full details; keep what's being typed.
  const onUploaded = (d) => { setDetails(d); notifyDetailsChanged() }
  const onBusy = (b) => setUploading(n => Math.max(0, n + (b ? 1 : -1)))

  async function saveDraft() {
    const r = await apiFetch(BASE, { method: 'PUT', body: JSON.stringify({ ...form, submit: false }) })
    setDetails(r.details); setDirty(false); notifyDetailsChanged()
    return r.details
  }

  async function next() {
    setSaveError('')
    if (cur.key === 'docs') {
      if (uploading) { setSaveError('Please wait for the upload to finish.'); return }
      const missing = options.docTypes.filter(t => !details.docs[t.key])
      if (missing.length) { setSaveError(`Please upload: ${missing.map(t => t.label).join(', ')}`); return }
      goTo(step + 1)
      return
    }
    const e = validateStep(cur.key, form)
    setErrors(e)
    if (Object.keys(e).length) {
      // Focus the first wrong field so the keyboard opens right there.
      const first = Object.keys(e)[0].replace('.', '-')
      formRef.current?.querySelector(`#f-${first}`)?.focus()
      return
    }
    // Also save when a pre-filled default (the state) isn't on the server yet.
    if (dirty || form.address.state !== details.address.state) {
      setSaving(true)
      try { await saveDraft() } catch (err) { setSaveError(err.message); setSaving(false); return }
      setSaving(false)
    }
    goTo(step + 1)
  }

  async function submit() {
    setSaving(true); setSaveError('')
    try {
      const r = await apiFetch(BASE, { method: 'PUT', body: JSON.stringify({ ...form, submit: true }) })
      const wasSubmitted = !!details.submittedAt
      setDetails(r.details); setForm(toForm(r.details)); setDirty(false); notifyDetailsChanged()
      if (wasSubmitted) setSavedNote(true)
      else { setJustSubmitted(true); scrollTop() }
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── after first submit ──
  if (justSubmitted) {
    return (
      <div className="px-4 py-10 max-w-md mx-auto text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl">✓</div>
        <h1 className="text-xl font-bold text-gray-900 mt-4">Submitted!</h1>
        <p className="text-sm text-gray-500 mt-2">The FOCAS Edu office will check your documents. If anything needs to be uploaded again, you’ll see it here and on your home screen.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link to="/student" className="h-12 rounded-xl bg-indigo-600 text-white font-semibold flex items-center justify-center">Go to Home</Link>
          <button type="button" onClick={() => { setJustSubmitted(false); goTo(STEPS.length - 1) }} className="h-12 rounded-xl border border-gray-200 text-gray-700 font-semibold">See my details</button>
        </div>
      </div>
    )
  }

  const status = STATUS_CARD[details.status]
  const boardLabel = form.school.board === 'OTHER' ? form.school.boardOther : options.boards.find(b => b.key === form.school.board)?.label
  const stateOptions = form.address.state && !INDIAN_STATES.includes(form.address.state) ? [form.address.state, ...INDIAN_STATES] : INDIAN_STATES

  return (
    <div className="px-4 pb-12 pt-1 md:pt-8 max-w-xl mx-auto" ref={formRef}>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">My Details</h1>
        <p className="text-sm text-gray-500">Needed once for your FOCAS Edu admission records.</p>
      </div>

      {status && cur.key === 'review' && (
        <div className={`flex gap-3 border rounded-2xl p-4 mb-4 ${status.cls}`}>
          <span className="text-xl leading-none">{status.icon}</span>
          <div><p className="font-semibold text-sm">{status.title}</p><p className="text-sm opacity-80 mt-0.5">{status.text}</p></div>
        </div>
      )}

      {/* Approved = read-only summary: no stepper, no Edit links. */}
      {!locked && <Stepper step={step} maxReached={maxReached} onJump={goTo} />}

      <div className="mt-4 mb-4">
        <h2 className="text-lg font-bold text-gray-900">{locked ? 'Your details' : cur.heading}</h2>
        <p className="text-sm text-gray-500">{locked ? 'Approved by the FOCAS Edu office.' : cur.sub}</p>
      </div>

      <form onSubmit={e => { e.preventDefault(); if (cur.key === 'review') submit(); else next() }} noValidate>
        {cur.key === 'contact' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
            <Field id="f-studentPhone" label="Your WhatsApp number" error={errors.studentPhone} hint="Class updates come here">
              <PhoneInput id="f-studentPhone" value={form.studentPhone} onChange={v => set('studentPhone', v)} error={errors.studentPhone} />
            </Field>
            <Field id="f-parentName" label="Parent’s name" error={errors.parentName}>
              <input id="f-parentName" className={inputCls(errors.parentName)} autoComplete="off" maxLength={80}
                placeholder="Father / mother / guardian" value={form.parentName} onChange={e => set('parentName', e.target.value)} />
            </Field>
            <Field id="f-parentPhone" label="Parent’s WhatsApp number" error={errors.parentPhone} hint="Monthly progress reports are sent here">
              <PhoneInput id="f-parentPhone" value={form.parentPhone} onChange={v => set('parentPhone', v)} error={errors.parentPhone} />
            </Field>
          </div>
        )}

        {cur.key === 'address' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
            <Field id="f-address-line" label="House no., street, area" error={errors['address.line']}>
              <textarea id="f-address-line" rows={3} maxLength={300} autoComplete="street-address"
                className={`${inputCls(errors['address.line'])} h-auto py-3 resize-none`}
                value={form.address.line} onChange={e => set('address.line', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="f-address-city" label="City / town" error={errors['address.city']}>
                <input id="f-address-city" className={inputCls(errors['address.city'])} maxLength={60} autoComplete="address-level2"
                  value={form.address.city} onChange={e => set('address.city', e.target.value)} />
              </Field>
              <Field id="f-address-pincode" label="Pincode" error={errors['address.pincode']}>
                <input id="f-address-pincode" className={inputCls(errors['address.pincode'])} inputMode="numeric" maxLength={6} autoComplete="postal-code"
                  value={form.address.pincode} onChange={e => set('address.pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </Field>
            </div>
            <Field id="f-address-state" label="State" error={errors['address.state']}>
              <select id="f-address-state" className={inputCls(errors['address.state'])} value={form.address.state} onChange={e => set('address.state', e.target.value)}>
                <option value="">Choose your state</option>
                {stateOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        )}

        {cur.key === 'school' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
            <Field id="f-school-name" label="School name" error={errors['school.name']}>
              <input id="f-school-name" className={inputCls(errors['school.name'])} maxLength={120} placeholder="e.g. DAV Boys Senior Secondary School"
                value={form.school.name} onChange={e => set('school.name', e.target.value)} />
            </Field>
            <Field id="f-school-city" label="School city" error={errors['school.city']}>
              <input id="f-school-city" className={inputCls(errors['school.city'])} maxLength={60}
                value={form.school.city} onChange={e => set('school.city', e.target.value)} />
            </Field>
            <div>
              <p className="block text-sm font-semibold text-gray-700 mb-1.5">Board</p>
              <div id="f-school-board" tabIndex={-1} className="grid grid-cols-2 sm:grid-cols-3 gap-2 outline-none">
                {options.boards.map(b => {
                  const on = form.school.board === b.key
                  return (
                    <button key={b.key} type="button" onClick={() => set('school.board', b.key)} aria-pressed={on}
                      className={`h-11 rounded-xl border text-sm font-semibold transition ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200'}`}>
                      {b.label}
                    </button>
                  )
                })}
              </div>
              {errors['school.board'] && <p className="text-xs text-rose-600 mt-1.5" role="alert">{errors['school.board']}</p>}
            </div>
            {form.school.board === 'OTHER' && (
              <Field id="f-school-boardOther" label="Board name" error={errors['school.boardOther']}>
                <input id="f-school-boardOther" className={inputCls(errors['school.boardOther'])} maxLength={60}
                  value={form.school.boardOther} onChange={e => set('school.boardOther', e.target.value)} />
              </Field>
            )}
            <div>
              <p className="block text-sm font-semibold text-gray-700">Subjects taken</p>
              <p className="text-xs text-gray-400 mb-2">Tick all that you study now</p>
              <div id="f-school-subjects" tabIndex={-1} className="flex flex-wrap gap-2 outline-none">
                {subjectChips.map(s => {
                  const on = hasSubject(s)
                  return (
                    <button key={s} type="button" onClick={() => toggleSubject(s)} aria-pressed={on}
                      className={`px-3.5 h-9 rounded-full text-sm font-medium border transition ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {on && '✓ '}{s}
                    </button>
                  )
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <input className={inputCls(false)} maxLength={40} placeholder="Another subject" value={otherSubject}
                  onChange={e => setOtherSubject(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOther() } }} />
                <button type="button" onClick={addOther} disabled={!otherSubject.trim()}
                  className="px-5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-40">Add</button>
              </div>
              {errors['school.subjects'] && <p className="text-xs text-rose-600 mt-1.5" role="alert">{errors['school.subjects']}</p>}
            </div>
          </div>
        )}

        {cur.key === 'docs' && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-sky-50 border border-sky-100 p-3.5 text-sm text-sky-900">
              <p className="font-semibold">Tips for a clear photo</p>
              <p className="mt-0.5 text-sky-800">Keep the paper flat in good light, with all four corners inside the photo and no shadow over the text.</p>
            </div>
            {options.docTypes.map(t => (
              <DetailsDocCard key={t.key} type={t.key} label={t.label} doc={details.docs[t.key]} options={options}
                onUploaded={onUploaded} onBusy={onBusy} />
            ))}
          </div>
        )}

        {cur.key === 'review' && (
          <div className="space-y-3">
            <SummaryCard title="Contact numbers" onEdit={locked ? undefined : () => goTo(0)}>
              <SummaryRow label="Your WhatsApp" value={form.studentPhone && `+91 ${form.studentPhone}`} />
              <SummaryRow label="Parent" value={form.parentName} />
              <SummaryRow label="Parent WhatsApp" value={form.parentPhone && `+91 ${form.parentPhone}`} />
            </SummaryCard>
            <SummaryCard title="Home address" onEdit={locked ? undefined : () => goTo(1)}>
              <SummaryRow label="Address" value={form.address.line} />
              <SummaryRow label="City" value={form.address.city} />
              <SummaryRow label="State" value={form.address.state} />
              <SummaryRow label="Pincode" value={form.address.pincode} />
            </SummaryCard>
            <SummaryCard title="School details" onEdit={locked ? undefined : () => goTo(2)}>
              <SummaryRow label="School" value={form.school.name} />
              <SummaryRow label="City" value={form.school.city} />
              <SummaryRow label="Board" value={boardLabel} />
              <SummaryRow label="Subjects" value={form.school.subjects.join(', ')} />
            </SummaryCard>
            <SummaryCard title="Documents" onEdit={locked ? undefined : () => goTo(3)}>
              {options.docTypes.map(t => {
                const d = details.docs[t.key]
                const txt = !d ? null : d.status === 'approved' ? '✓ Approved' : d.status === 'rejected' ? '⚠ Upload again' : 'Uploaded'
                return <SummaryRow key={t.key} label={t.label} value={txt} />
              })}
            </SummaryCard>

            {!details.submittedAt && (
              <label className="flex items-start gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer">
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 w-5 h-5 accent-indigo-600 flex-shrink-0" />
                <span className="text-sm text-gray-700">I confirm these details are correct and the documents are mine.</span>
              </label>
            )}
          </div>
        )}

        {savedNote && <p className="mt-4 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">✓ Changes saved</p>}
        {saveError && <p className="mt-4 text-sm text-rose-600 bg-rose-50 rounded-xl px-3 py-2" role="alert">{saveError}</p>}

        {/* actions */}
        <div className="mt-5 flex gap-3">
          {step > 0 && !locked && (
            <button type="button" onClick={() => goTo(step - 1)} disabled={saving}
              className="h-12 px-5 rounded-xl border border-gray-200 bg-white text-gray-700 font-semibold disabled:opacity-50">Back</button>
          )}
          {cur.key !== 'review' ? (
            <button type="submit" disabled={saving || (cur.key === 'docs' && uploading > 0)}
              className="flex-1 h-12 rounded-xl bg-indigo-600 text-white font-semibold disabled:opacity-60">
              {saving ? 'Saving…' : cur.key === 'docs' && uploading ? 'Uploading…' : 'Next'}
            </button>
          ) : details.submittedAt ? (
            dirty ? (
              <button type="submit" disabled={saving} className="flex-1 h-12 rounded-xl bg-indigo-600 text-white font-semibold disabled:opacity-60">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            ) : (
              <Link to="/student" className="flex-1 h-12 rounded-xl bg-indigo-600 text-white font-semibold flex items-center justify-center">Done</Link>
            )
          ) : (
            <button type="submit" disabled={saving || !confirmed}
              className="flex-1 h-12 rounded-xl bg-indigo-600 text-white font-semibold disabled:opacity-50">
              {saving ? 'Submitting…' : 'Submit'}
            </button>
          )}
        </div>
        {step < STEPS.length - 1 && !details.submittedAt && (
          <p className="text-xs text-gray-400 text-center mt-3">Your answers are saved at every step — you can finish later.</p>
        )}
      </form>
    </div>
  )
}
