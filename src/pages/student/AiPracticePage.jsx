import { useState, useEffect, useMemo, useCallback } from 'react'
import { apiFetch } from '../../api'
import MarkdownBlock from '../../components/MarkdownBlock'

// Student: browse the published question bank and generate a similar practice
// question on demand. Monthly usage is capped by the student's Lite/Pro tier.

const TYPE_STYLE = {
  Numerical: 'bg-indigo-50 text-indigo-700',
  Theory:    'bg-sky-50 text-sky-700',
  MCQ:       'bg-purple-50 text-purple-700',
  CaseStudy: 'bg-rose-50 text-rose-700',
}
const DIFF_STYLE = {
  Easy:   'bg-emerald-50 text-emerald-700',
  Medium: 'bg-amber-50 text-amber-700',
  Hard:   'bg-red-50 text-red-700',
}

export default function AiPracticePage() {
  const [quota, setQuota]     = useState(null)
  const [filters, setFilters] = useState({ subjects: [], chapters: [], levels: [] })
  const [subject, setSubject] = useState('')
  const [chapter, setChapter] = useState('')
  const [rows, setRows]       = useState(null)
  const [page, setPage]       = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal]     = useState(0)
  const [openId, setOpenId]   = useState(null)

  useEffect(() => {
    apiFetch('/api/ai-questions/quota').then(setQuota).catch(() => setQuota(null))
    apiFetch('/api/ai-questions/meta/filters').then(setFilters).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setRows(null)
    try {
      const p = new URLSearchParams({ page: String(page), limit: '10' })
      if (subject) p.set('subject', subject)
      if (chapter) p.set('chapter', chapter)
      const d = await apiFetch(`/api/ai-questions?${p}`)
      setRows(d.questions || []); setTotal(d.total || 0); setTotalPages(d.totalPages || 1)
    } catch { setRows([]) }
  }, [subject, chapter, page])

  useEffect(() => { load() }, [load])

  const onSubject = (v) => { setSubject(v); setChapter(''); setPage(1) }
  const onChapter = (v) => { setChapter(v); setPage(1) }

  const noAccess = quota && !quota.hasAccess
  const pct = quota?.limit ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">AI Practice Questions</h1>
        <p className="text-gray-400 text-sm mt-1">
          Pick a question from your bank and generate a fresh, similar one — same concept and method, new figures.
        </p>
      </div>

      {/* Quota */}
      {quota && quota.hasAccess && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                quota.tier === 'pro' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}>
                {quota.tier}
              </span>
              <span className="text-sm text-gray-600">This month</span>
            </div>
            <span className="text-sm font-semibold text-gray-800">
              <span className={quota.remaining === 0 ? 'text-red-600' : 'text-emerald-600'}>{quota.remaining}</span>
              <span className="text-gray-400"> of {quota.limit} left</span>
            </span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${quota.remaining === 0 ? 'bg-red-400' : 'bg-indigo-500'}`}
              style={{ width: `${pct}%` }} />
          </div>
          {quota.remaining === 0 && (
            <p className="text-xs text-red-500 mt-2">You've used all your generations for this month. Your limit resets next month.</p>
          )}
        </div>
      )}

      {noAccess && (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">AI practice isn't in your plan</p>
          <p className="text-gray-400 text-sm">Upgrade to a plan that includes AI question generation to use this feature.</p>
        </div>
      )}

      {!noAccess && (
        <>
          {/* Filters */}
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Subject</label>
              <select value={subject} onChange={e => onSubject(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">All subjects</option>
                {filters.subjects.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Chapter</label>
              <select value={chapter} onChange={e => onChapter(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">All chapters</option>
                {filters.chapters.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {rows === null ? (
            <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading questions…</div>
          ) : !rows.length ? (
            <div className="bg-white rounded-2xl p-8 text-center">
              <p className="text-gray-700 font-semibold mb-1">No practice questions yet</p>
              <p className="text-gray-400 text-sm">Questions for your subjects will appear here once published.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map(q => (
                <QuestionRow key={q._id} q={q}
                  open={openId === q._id}
                  onToggle={() => setOpenId(openId === q._id ? null : q._id)}
                  quota={quota} onQuota={setQuota} />
              ))}

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 bg-white disabled:opacity-40">← Prev</button>
                  <span className="text-xs text-gray-500">Page {page} of {totalPages} · {total} questions</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 bg-white disabled:opacity-40">Next →</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function QuestionRow({ q, open, onToggle, quota, onQuota }) {
  const [full, setFull]         = useState(null)   // full question (with answer) fetched on open
  const [gen, setGen]           = useState(null)   // the generated variant
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [showAnswer, setShowAnswer] = useState(false)

  useEffect(() => {
    if (!open || full) return
    apiFetch(`/api/ai-questions/${q._id}`).then(d => setFull(d.question)).catch(() => {})
  }, [open, full, q._id])

  const generate = async () => {
    setBusy(true); setError(''); setGen(null)
    try {
      const d = await apiFetch(`/api/ai-questions/${q._id}/generate`, { method: 'POST' })
      setGen(d.generated)
      if (d.quota) onQuota(d.quota)
    } catch (e) {
      setError(e.message || 'Generation failed')
    } finally { setBusy(false) }
  }

  const outOfQuota = quota && quota.remaining <= 0

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <button onClick={onToggle} className="w-full text-left p-4 hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_STYLE[q.questionType] || 'bg-gray-100 text-gray-600'}`}>{q.questionType}</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${DIFF_STYLE[q.difficulty] || ''}`}>{q.difficulty}</span>
          {q.originalQuestion?.marks != null && <span className="text-[10px] text-gray-500">{q.originalQuestion.marks} marks</span>}
          <span className="text-[10px] text-gray-400 ml-auto">{q.subject} · {q.chapter}</span>
        </div>
        <p className="text-sm text-gray-800 line-clamp-2">{(q.originalQuestion?.text || '').slice(0, 220)}</p>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          {!full ? <p className="text-sm text-gray-400">Loading…</p> : (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Original question</p>
              <MarkdownBlock text={full.originalQuestion?.text} className="text-sm text-gray-800" />

              <button onClick={() => setShowAnswer(v => !v)}
                className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                {showAnswer ? 'Hide answer' : 'Show answer'}
              </button>
              {showAnswer && (
                <div className="mt-2 bg-gray-50 rounded-xl p-3">
                  <MarkdownBlock text={full.originalAnswer?.text} className="text-xs text-gray-700" />
                  {full.originalAnswer?.finalAnswer && (
                    <p className="text-xs font-semibold text-emerald-700 mt-2">Answer: {full.originalAnswer.finalAnswer}</p>
                  )}
                </div>
              )}

              <button onClick={generate} disabled={busy || outOfQuota}
                className="mt-4 w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400">
                {busy ? 'Generating… (may take a few seconds)' : outOfQuota ? 'No generations left this month' : '✨ Generate a similar question'}
              </button>
              {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

              {gen && <GeneratedCard gen={gen} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function GeneratedCard({ gen }) {
  const [showAnswer, setShowAnswer] = useState(false)
  const v = gen.verification || {}

  return (
    <div className="mt-4 border border-indigo-200 rounded-2xl overflow-hidden">
      <div className="bg-indigo-50 px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold text-indigo-900">✨ Your AI practice question</p>
        {v.status === 'flagged' && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Needs review</span>
        )}
        {(v.status === 'verified' || v.status === 'corrected') && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            ✓ Verified{v.confidenceScore != null ? ` ${v.confidenceScore}%` : ''}
          </span>
        )}
      </div>

      <div className="p-4">
        <MarkdownBlock text={gen.generatedQuestion?.text} className="text-sm text-gray-800" />
        {gen.generatedQuestion?.marks != null && (
          <p className="text-xs text-gray-400 mt-1">{gen.generatedQuestion.marks} marks</p>
        )}

        {v.status === 'flagged' && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            Our checker wasn't fully confident about this answer — treat it as practice and verify your working.
          </p>
        )}

        <button onClick={() => setShowAnswer(s => !s)}
          className="mt-3 w-full py-2.5 rounded-xl border border-indigo-200 text-indigo-700 font-semibold text-sm hover:bg-indigo-50">
          {showAnswer ? 'Hide solution' : 'Show step-by-step solution'}
        </button>

        {showAnswer && (
          <div className="mt-3 bg-gray-50 rounded-xl p-3">
            {(gen.generatedAnswer?.steps || []).length > 0 && (
              <ol className="space-y-2 mb-3">
                {gen.generatedAnswer.steps.map((s, i) => (
                  <li key={i} className="text-xs text-gray-700">
                    <span className="font-bold text-indigo-600 mr-1">Step {i + 1}.</span>
                    <MarkdownBlock text={s} className="inline" />
                  </li>
                ))}
              </ol>
            )}
            <MarkdownBlock text={gen.generatedAnswer?.text} className="text-xs text-gray-700" />
            {gen.generatedAnswer?.finalAnswer && (
              <p className="text-sm font-bold text-emerald-700 mt-3 bg-emerald-50 rounded-lg px-3 py-2">
                Final answer: {gen.generatedAnswer.finalAnswer}
              </p>
            )}
          </div>
        )}

        {(gen.changedVariables || []).length > 0 && (
          <details className="mt-3">
            <summary className="text-[11px] text-gray-400 cursor-pointer">What changed from the original?</summary>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {gen.changedVariables.map((c, i) => (
                <span key={i} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">
                  {c.key}: {String(c.oldValue)}{c.unit} → <strong>{String(c.newValue)}{c.unit}</strong>
                </span>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
