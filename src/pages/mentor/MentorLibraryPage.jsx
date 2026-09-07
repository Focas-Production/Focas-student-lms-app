import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../../api'
import PdfViewer from '../../components/PdfViewer'
import ContentGroups from '../../components/ContentGroups'

// Read-only library for mentors: every question-bank PDF and every test paper
// (with its answer key) across all levels. Files open in the canvas PdfViewer,
// which has no download / print affordance — the same viewer students get.

const TABS = [['question_bank', 'Question Bank'], ['test_series', 'Test Series']]
const LEVELS = ['Foundation', 'Intermediate', 'Final']
const NO_LEVEL = 'Other'
const LEVEL_STYLE = {
  Foundation:   'bg-green-100 text-green-700',
  Intermediate: 'bg-yellow-100 text-yellow-700',
  Final:        'bg-purple-100 text-purple-700',
  [NO_LEVEL]:   'bg-gray-100 text-gray-600',
}
const TS_TYPE_LABELS = {
  chapter_wise: 'Chapter-wise',
  segment_wise: 'Subject-wise',
  full_test:    'Full Test',
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${Math.round(bytes / 1e3)} KB`
}

export default function MentorLibraryPage() {
  const [items, setItems] = useState(null)       // null while loading
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState('question_bank')
  const [level, setLevel] = useState('')         // '' = all levels
  const [tsType, setTsType] = useState('')       // '' = all test types
  const [query, setQuery] = useState('')
  const [viewer, setViewer] = useState(null)     // { blobUrl, title }
  const [loadingKey, setLoadingKey] = useState('') // `${id}:view` | `${id}:answer` while fetching
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/mentor/library')
      .then(d => setItems(d.items || []))
      .catch(e => { setItems([]); setLoadError(e.message || 'Failed to load library') })
  }, [])

  const inTab = useMemo(() => (items || []).filter(c => c.category === tab), [items, tab])

  const levelOptions = useMemo(() => {
    const present = LEVELS.filter(l => inTab.some(c => c.level === l))
    if (inTab.some(c => !c.level)) present.push(NO_LEVEL)
    return present
  }, [inTab])

  const tsTypes = useMemo(
    () => (tab === 'test_series' ? Object.keys(TS_TYPE_LABELS).filter(t => inTab.some(c => c.testSeriesType === t)) : []),
    [inTab, tab]
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inTab.filter(c => {
      if (level && (c.level || NO_LEVEL) !== level) return false
      if (tsType && c.testSeriesType !== tsType) return false
      if (q && !`${c.title} ${c.subject} ${c.folder || ''} ${c.unit || ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [inTab, level, tsType, query])

  // Level is the top grouping; ContentGroups handles subject → chapter → unit.
  const byLevel = useMemo(() => {
    const map = new Map()
    for (const c of visible) {
      const k = c.level || NO_LEVEL
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(c)
    }
    return [...LEVELS, NO_LEVEL].filter(k => map.has(k)).map(k => ({ level: k, items: map.get(k) }))
  }, [visible])

  const onTab = (v) => { setTab(v); setLevel(''); setTsType(''); setError('') }

  // Fetch the short-lived view URL, pull the bytes into a blob and hand it to the
  // canvas viewer — the PDF never becomes a navigable / saveable URL in the browser.
  const openPdf = async (item, which) => {
    if (loadingKey) return
    setLoadingKey(`${item._id}:${which}`); setError('')
    try {
      const endpoint = which === 'answer' ? 'answer-key' : 'view'
      const { url } = await apiFetch(`/api/mentor/library/${item._id}/${endpoint}`)
      const token = localStorage.getItem('student_token')
      const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      if (!res.ok) throw new Error('Unable to open document. Please try again.')
      setViewer({
        blobUrl: URL.createObjectURL(await res.blob()),
        title: which === 'answer' ? `${item.title} — Answer Key` : item.title,
      })
    } catch (e) {
      setError(e.message || 'Document not available')
    } finally { setLoadingKey('') }
  }

  const closeViewer = () => setViewer(v => { if (v?.blobUrl) URL.revokeObjectURL(v.blobUrl); return null })

  const searching = query.trim().length > 0
  const emptyTabMessage = tab === 'question_bank' ? 'No question bank PDFs have been uploaded yet.' : 'No test papers have been uploaded yet.'

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Library</h1>
        <p className="text-gray-400 text-sm mt-1">
          Every question bank and test paper across all levels. View only — files can't be downloaded or printed.
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 mb-4">
        {TABS.map(([v, l]) => {
          const n = (items || []).filter(c => c.category === v).length
          return (
            <button key={v} onClick={() => onTab(v)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                tab === v ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
              }`}>
              {l}{items !== null && <span className={`ml-1.5 text-xs ${tab === v ? 'text-teal-100' : 'text-gray-400'}`}>{n}</span>}
            </button>
          )
        })}
      </div>

      {/* Filters */}
      {items !== null && inTab.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
          <div className="flex flex-wrap gap-2 flex-1 min-w-0">
            {levelOptions.length > 1 && (
              <Chips value={level} onChange={setLevel}
                options={[['', 'All levels'], ...levelOptions.map(l => [l, l])]} />
            )}
            {tsTypes.length > 1 && (
              <Chips value={tsType} onChange={setTsType} activeClass="bg-rose-600 text-white"
                options={[['', 'All types'], ...tsTypes.map(t => [t, TS_TYPE_LABELS[t]])]} />
            )}
          </div>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search title, subject, chapter…"
            className="w-full sm:w-64 px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-teal-400" />
        </div>
      )}

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-700 font-medium">{error}</div>
      )}

      {items === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading library…</div>
      ) : loadError ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">Couldn't load the library</p>
          <p className="text-gray-400 text-sm">{loadError}</p>
        </div>
      ) : !inTab.length ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">Nothing here yet</p>
          <p className="text-gray-400 text-sm">{emptyTabMessage}</p>
        </div>
      ) : !visible.length ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">No files match</p>
          <p className="text-gray-400 text-sm">Try a different level, type or search term.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {byLevel.map(({ level: lv, items: lvItems }) => (
            <section key={lv}>
              {!level && (
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${LEVEL_STYLE[lv]}`}>{lv}</span>
                  <span className="text-xs text-gray-400">{lvItems.length} file{lvItems.length > 1 ? 's' : ''}</span>
                </div>
              )}
              {/* Re-mount on search so matching subjects/chapters open up; collapsed otherwise. */}
              <ContentGroups key={searching ? `q:${query}` : 'all'} items={lvItems} defaultOpen={searching}
                renderItem={item => (
                  <LibraryRow key={item._id} item={item} loadingKey={loadingKey} onOpen={openPdf} />
                )} />
            </section>
          ))}
        </div>
      )}

      {viewer && (
        <PdfViewer blobUrl={viewer.blobUrl} title={viewer.title} onClose={closeViewer}
          badge={<span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-700 text-gray-300 px-2 py-1 rounded-lg">View only</span>} />
      )}
    </div>
  )
}

function Chips({ value, onChange, options, activeClass = 'bg-teal-600 text-white' }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-colors ${
            value === v ? activeClass : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>{l}</button>
      ))}
    </div>
  )
}

// One PDF: title + meta, then view buttons (question paper / answer key for tests).
function LibraryRow({ item, loadingKey, onOpen }) {
  const isTest    = item.category === 'test_series'
  const viewing   = loadingKey === `${item._id}:view`
  const answering = loadingKey === `${item._id}:answer`
  const busy      = !!loadingKey

  const meta = []
  if (isTest) {
    meta.push(`${item.testDuration || 0} min · ${item.totalMarks || 0} marks`)
    if (item.testSeriesType) meta.push(TS_TYPE_LABELS[item.testSeriesType] || item.testSeriesType)
  }
  if (item.size > 0) meta.push(fmtSize(item.size))

  return (
    <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isTest ? 'bg-rose-100' : 'bg-amber-100'}`}>
          <svg className={`w-4 h-4 ${isTest ? 'text-rose-600' : 'text-amber-600'}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 break-words leading-snug">{item.title}</p>
          {item.description && <p className="text-xs text-gray-400 break-words mt-0.5">{item.description}</p>}
          {meta.length > 0 && <p className="text-xs text-gray-400 mt-0.5">{meta.join(' · ')}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2.5 sm:pl-12">
        <button onClick={() => onOpen(item, 'view')} disabled={busy}
          className="inline-flex items-center gap-1 text-xs font-semibold bg-teal-100 text-teal-700 rounded-lg px-3 py-1.5 hover:bg-teal-200 disabled:opacity-50">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {viewing ? 'Opening…' : isTest ? 'View Question Paper' : 'View PDF'}
        </button>
        {isTest && (item.hasAnswerKey ? (
          <button onClick={() => onOpen(item, 'answer')} disabled={busy}
            className="inline-flex items-center gap-1 text-xs font-semibold bg-emerald-100 text-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-200 disabled:opacity-50">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
            </svg>
            {answering ? 'Opening…' : 'View Answer Key'}
          </button>
        ) : (
          <span className="text-xs text-gray-300">No answer key</span>
        ))}
      </div>
    </div>
  )
}
