import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../../api'
import SyllabusProgress from '../../components/SyllabusProgress'

// Syllabus progress on its own page. Scoped by the server to the subjects this
// mentor actually hosts classes for, so it's their teaching checklist rather
// than the whole curriculum. Marking an item here is also one half of what
// completes a chapter for a student — the other half is their attendance.
export default function MentorSyllabusPage() {
  const [subjects, setSubjects] = useState(null)   // null = loading
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return apiFetch('/api/live-classes/manage/syllabus')
      .then(d => setSubjects(d.subjects || []))
      .catch(() => setSubjects([]))
  }, [])

  useEffect(() => { load() }, [load])

  // Toggle a chapter/unit's completed state. Server cascades chapter ↔ units.
  const toggleProgress = async (subjectId, chapterId, unitId, completed) => {
    setError('')
    try {
      await apiFetch(`/api/live-classes/manage/syllabus/${subjectId}/progress`, {
        method: 'POST',
        body: JSON.stringify({ chapterId, unitId: unitId || undefined, completed }),
      })
      await load()
    } catch (err) {
      setError(err.message || 'Could not update progress')
    }
  }

  const chapters = (subjects || []).flatMap(s => s.chapters || [])
  const doneCount = chapters.filter(c => c.completed).length

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Syllabus Progress</h1>
        <p className="text-gray-400 text-sm mt-1">
          Mark chapters and units as you complete them — the admin schedules the next class from this,
          and your students' chapters complete from it too.
        </p>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {subjects === null ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !subjects.length ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-semibold mb-1">No subjects yet</p>
          <p className="text-gray-400 text-sm">
            Once your admin assigns you a class tied to a chapter, its syllabus appears here.
          </p>
        </div>
      ) : (
        <>
          {chapters.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm p-4 md:p-5 mb-4">
              <div className="flex items-end justify-between gap-3 mb-2">
                <div>
                  <p className="text-2xl md:text-3xl font-bold text-gray-900">
                    {doneCount}<span className="text-gray-300 text-lg md:text-xl"> / {chapters.length}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">chapters completed</p>
                </div>
                <p className="text-2xl md:text-3xl font-bold text-teal-500">
                  {Math.round((doneCount / chapters.length) * 100)}%
                </p>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-teal-500 rounded-full transition-all"
                  style={{ width: `${Math.round((doneCount / chapters.length) * 100)}%` }} />
              </div>
            </div>
          )}

          <SyllabusProgress subjects={subjects} onToggle={toggleProgress} />
        </>
      )}
    </div>
  )
}
