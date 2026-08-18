import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../api'
import SubmissionsModal from '../../components/SubmissionsModal'

// Everything students have handed in, across every class this mentor hosts.
// The per-class modal on the Live Classes page answers "what came in for this
// class?"; this page answers "what is waiting on me?" — which is the question a
// mentor actually starts their day with, and the one that's unanswerable if the
// only way in is opening each class card one at a time.

const KIND_ICON = { audio: '🎙', video: '🎬', pdf: '📕', image: '🖼', doc: '📄', other: '📎' }

const STATUS_CHIP = {
  submitted:         { label: 'Awaiting review', cls: 'bg-amber-100 text-amber-700' },
  changes_requested: { label: 'Changes asked',   cls: 'bg-orange-100 text-orange-700' },
  reviewed:          { label: 'Reviewed',        cls: 'bg-emerald-100 text-emerald-700' },
}

const fmtWhen = (d) => (d ? new Date(d).toLocaleString(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}) : '')

export default function MentorSubmissionsPage() {
  const [data, setData]     = useState(null)
  const [status, setStatus] = useState('pending')
  const [page, setPage]     = useState(1)
  const [error, setError]   = useState('')
  const [open, setOpen]     = useState(null)   // { id, title } — the class modal

  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/api/mentor/class-submissions?status=${status}&page=${page}&limit=20`)
      setData(d)
      setError('')
    } catch (e) {
      setError(e.message || 'Could not load submissions')
      setData({ submissions: [], total: 0, totalPages: 1, pendingTotal: 0 })
    }
  }, [status, page])

  useEffect(() => { load() }, [load])

  // Reviewing happens in the per-class modal, so returning from it must refresh
  // this list — a row the mentor just marked reviewed should leave the pending view.
  const closeModal = () => { setOpen(null); load() }

  const switchStatus = (s) => { setStatus(s); setPage(1) }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Student Submissions</h1>
      <p className="text-gray-400 text-sm mb-5">
        Work handed in during your live classes — voice notes, video answers, PDFs and photos.
      </p>

      <div className="flex gap-1.5 p-1 bg-gray-100 rounded-xl mb-4 max-w-xs">
        {[
          { k: 'pending',  label: `Pending${data?.pendingTotal ? ` (${data.pendingTotal})` : ''}` },
          { k: 'reviewed', label: 'Reviewed' },
          { k: 'all',      label: 'All' },
        ].map((t) => (
          <button key={t.k} onClick={() => switchStatus(t.k)}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition ${
              status === t.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {data === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !data.submissions.length ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">
            {status === 'pending' ? 'Nothing waiting on you' : 'Nothing here yet'}
          </p>
          <p className="text-gray-400 text-sm">
            {status === 'pending'
              ? 'When a student submits work in one of your classes, it lands here.'
              : 'Submissions you have reviewed will show up here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.submissions.map((s) => {
            const chip = STATUS_CHIP[s.status] || STATUS_CHIP.submitted
            return (
              <button key={s._id} onClick={() => setOpen({ id: s.classId, title: s.classTitle })}
                className="w-full text-left bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 hover:shadow-md transition">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 truncate">{s.studentName || 'Student'}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${chip.cls}`}>{chip.label}</span>
                    {s.submittedDuringClass && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 uppercase">in class</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 truncate">{s.classTitle}</p>
                  {s.chapter?.name && (
                    <p className="text-[11px] text-indigo-500 truncate mt-0.5">
                      📖 {s.subject?.name ? `${s.subject.name} · ` : ''}{s.chapter.name}
                    </p>
                  )}
                  <p className="text-[11px] text-gray-400 mt-1">
                    {s.files.length} file{s.files.length === 1 ? '' : 's'} · {fmtWhen(s.lastFileAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {s.files.slice(0, 4).map((f) => <span key={f.key} title={f.name}>{KIND_ICON[f.kind] || '📎'}</span>)}
                  {s.marks != null && (
                    <span className="text-xs font-bold text-gray-900 ml-1">
                      {s.marks}{s.totalMarks != null ? `/${s.totalMarks}` : ''}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {data?.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-5">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40">
            Previous
          </button>
          <span className="text-xs text-gray-500">Page {page} of {data.totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages}
            className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40">
            Next
          </button>
        </div>
      )}

      {open && (
        <SubmissionsModal
          classId={open.id}
          title={open.title}
          apiFetch={apiFetch}
          accent="teal"
          onClose={closeModal}
        />
      )}
    </div>
  )
}
