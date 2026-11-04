// Reminds a Foundation student to fill My Details: a slim banner on every page
// until it's done, plus a pop-up once per app open (sessionStorage) with a
// "Later" button. Never blocks anything — classes, videos and tests all work.
// Hidden on the form page itself; re-checks whenever the form saves.
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api'
import { DETAILS_CHANGED, needsAction } from '../lib/studentDetails'

const SEEN_KEY = 'details-reminder-seen'
const PAGE = '/student/details'

export default function DetailsReminder() {
  const [status, setStatus] = useState(null)
  const [popup, setPopup] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const check = useCallback(() => {
    apiFetch('/api/student-details/me')
      .then(r => {
        const s = r.details.required ? r.details.status : null
        setStatus(s)
        if (needsAction(s) && !sessionStorage.getItem(SEEN_KEY)) setPopup(true)
      })
      .catch(() => {})   // a reminder must never break the app
  }, [])

  useEffect(() => {
    check()
    window.addEventListener(DETAILS_CHANGED, check)
    return () => window.removeEventListener(DETAILS_CHANGED, check)
  }, [check])

  if (!needsAction(status) || pathname === PAGE) return null

  const fix = status === 'needs_fix'
  const close = () => { sessionStorage.setItem(SEEN_KEY, '1'); setPopup(false) }
  const go = () => { close(); navigate(PAGE) }

  return (
    <>
      <button type="button" onClick={go}
        className={`w-full text-left px-4 py-2 text-xs font-medium ${fix ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
        {fix ? 'The office asked you to upload a document again.' : 'Please fill your admission details.'}
        <span className="font-semibold underline ml-1">{fix ? 'Fix now' : 'Fill now'}</span>
      </button>

      {popup && (
        <div className="fixed inset-0 z-[55] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={close}>
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">{fix ? 'Upload again' : 'Your admission details'}</h2>
            <p className="text-sm text-gray-600 mt-1.5">
              {fix
                ? 'One of your documents could not be accepted. Open My Details to see why and upload it again.'
                : 'We need a few details for your records: your and your parent’s WhatsApp number, address, school details, 10th mark sheet, school ID card and a passport-size photo.'}
            </p>
            <p className="text-xs text-gray-400 mt-2">Takes about 5 minutes. Keep the documents ready on your phone.</p>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={close} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Later</button>
              <button type="button" onClick={go} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold">{fix ? 'Fix now' : 'Fill now'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
