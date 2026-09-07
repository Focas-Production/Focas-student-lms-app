import { useState } from 'react'

// Collapsible subject → chapter → unit → file tree used by the student course page
// and the mentor library. `renderItem(item)` draws one file row; everything starts
// collapsed unless `defaultOpen` is set (used while a search filter is active).

// Group items: subject → folder → items
function groupBySubjectFolder(items) {
  const subjectOrder = []
  const bySubject = {}
  for (const item of items) {
    const subj = item.subject || 'General'
    if (!bySubject[subj]) { bySubject[subj] = {}; subjectOrder.push(subj) }
    const fold = item.folder?.trim() || ''
    if (!bySubject[subj][fold]) bySubject[subj][fold] = []
    bySubject[subj][fold].push(item)
  }
  return subjectOrder.map(subj => ({
    subject: subj,
    folders: Object.entries(bySubject[subj]).map(([folder, items]) => ({ folder, items })),
  }))
}

// Group a chapter's items by unit, preserving order; units with no name sort last.
function groupByUnit(items) {
  const map = new Map()
  for (const item of items) {
    const u = item.unit?.trim() || ''
    if (!map.has(u)) map.set(u, [])
    map.get(u).push(item)
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1))   // named units first, unnamed last
    .map(([unit, items]) => ({ unit, items }))
}

// Collapsible unit / part inside a chapter. Click to reveal its files.
// Files without a unit name render directly (no header, no extra nesting).
function UnitGroup({ unit, items, renderItem, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!unit) {
    return <div className="space-y-2">{items.map(item => renderItem(item))}</div>
  }
  return (
    <div className="border border-indigo-100 rounded-lg overflow-hidden bg-white">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-indigo-50/60 transition-colors text-left">
        <svg className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
        </svg>
        <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide flex-1 min-w-0 break-words leading-snug">{unit}</span>
        <span className="text-[11px] text-gray-400 flex-shrink-0 whitespace-nowrap">{items.length} file{items.length > 1 ? 's' : ''}</span>
        <svg className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2 border-t border-indigo-50 bg-indigo-50/20">
          {items.map(item => renderItem(item))}
        </div>
      )}
    </div>
  )
}

// Collapsible chapter (folder). Click the header to reveal its files.
function ChapterGroup({ folder, items, renderItem, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden bg-white">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-3.5 py-3 hover:bg-amber-50/60 transition-colors text-left">
        <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        <span className="text-sm font-semibold text-gray-700 flex-1 min-w-0 break-words leading-snug">{folder}</span>
        <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{items.length} file{items.length > 1 ? 's' : ''}</span>
        <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-50 bg-amber-50/30">
          {groupByUnit(items).map(({ unit, items: unitItems }) => (
            <UnitGroup key={unit || '__none__'} unit={unit} items={unitItems}
              renderItem={renderItem} defaultOpen={defaultOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

// Collapsible subject. Click to reveal its chapters; loose files (no chapter) show directly.
export function SubjectSection({ subject, folders, renderItem, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const totalFiles    = folders.reduce((s, f) => s + f.items.length, 0)
  const namedChapters = folders.filter(f => f.folder.trim().length > 0)
  const rootItems     = folders.find(f => !f.folder.trim())?.items || []
  // If a subject has exactly one chapter and nothing loose, open it automatically.
  const autoOpenChapter = namedChapters.length === 1 && rootItems.length === 0

  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left">
        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-gray-800 break-words leading-snug">{subject}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {namedChapters.length > 0 && `${namedChapters.length} chapter${namedChapters.length > 1 ? 's' : ''} · `}
            {totalFiles} file{totalFiles > 1 ? 's' : ''}
          </p>
        </div>
        <svg className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-100 bg-gray-50/50">
          {rootItems.length > 0 && (
            <div className="space-y-2">{rootItems.map(item => renderItem(item))}</div>
          )}
          {namedChapters.map(({ folder, items }) => (
            <ChapterGroup key={folder} folder={folder} items={items}
              renderItem={renderItem} defaultOpen={autoOpenChapter || defaultOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

// Groups items by subject → chapter and renders collapsible sections.
// Everything starts collapsed — subjects and chapters open only when clicked —
// unless `defaultOpen` is set.
export default function ContentGroups({ items, renderItem, defaultOpen = false }) {
  const groups = groupBySubjectFolder(items)
  return (
    <div className="space-y-3">
      {groups.map(({ subject, folders }) => (
        <SubjectSection key={subject} subject={subject} folders={folders}
          renderItem={renderItem} defaultOpen={defaultOpen} />
      ))}
    </div>
  )
}
