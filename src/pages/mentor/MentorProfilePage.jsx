import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../api'

function getInitials(user) {
  if (user.name) return user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  if (user.phoneNumber) return user.phoneNumber.slice(-2)
  if (user.email) return user.email[0].toUpperCase()
  return '?'
}

export default function MentorProfilePage() {
  const { user, logout, setUser } = useAuth()
  const navigate   = useNavigate()
  const [editing,  setEditing]  = useState(false)
  const [name,     setName]     = useState(user?.name || '')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [purchases, setPurchases] = useState([])

  useEffect(() => {
    apiFetch(`/api/purchase/my-purchases?userId=${user.id}`)
      .then(d => setPurchases(d.purchases || []))
      .catch(() => {})
  }, [user.id])

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true); setError('')
    try {
      const data = await apiFetch('/api/auth/profile', { method: 'PUT', body: JSON.stringify({ name: name.trim() }) })
      setUser({ ...user, name: data.user.name })
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const allCourses = [
    ...(user?.access?.website?.courses || []),
    ...(user?.access?.shopify?.courses  || []),
    ...(user?.access?.combo?.courses    || []),
  ]
  const uniqueCourses = [...new Set(allCourses)]

  const allFeatures = [
    ...(user?.access?.website?.features || []),
    ...(user?.access?.shopify?.features  || []),
    ...(user?.access?.combo?.features    || []),
  ]
  const uniqueFeatures = [...new Set(allFeatures)]

  return (
    <div className="p-6 max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-gray-400 text-sm mt-1">Manage your mentor account</p>
      </div>

      {/* Avatar card */}
      <div className="bg-white rounded-2xl shadow-sm p-6 flex items-center gap-5 mb-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white text-2xl font-bold shadow-md flex-shrink-0">
          {getInitials(user)}
        </div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <div>
              <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus
                className="w-full text-lg font-bold px-2 py-1 border-b-2 border-teal-400 outline-none bg-transparent mb-1" />
              {error && <p className="text-xs text-red-500 mb-1">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setEditing(false); setName(user?.name || '') }}
                  className="px-3 py-1 text-xs text-gray-500 border border-gray-200 rounded-lg">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-3 py-1 text-xs font-semibold text-white bg-teal-600 rounded-lg disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <h2 className="text-lg font-bold text-gray-900 truncate">{user?.name || 'Mentor'}</h2>
                <button onClick={() => setEditing(true)} className="text-gray-400 hover:text-teal-600 flex-shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </div>
              <span className="text-xs bg-teal-100 text-teal-700 px-2.5 py-0.5 rounded-full font-medium inline-block mt-1">Mentor</span>
            </>
          )}
        </div>
      </div>

      {/* Account info */}
      <div className="bg-white rounded-2xl shadow-sm mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Account Details</p>
        </div>
        <div className="divide-y divide-gray-50">
          {[
            { label: 'Phone', value: user?.phoneNumber ? `+91 ${user.phoneNumber}` : null },
            { label: 'Email', value: user?.email },
            { label: 'Purchases', value: `${purchases.length} order${purchases.length !== 1 ? 's' : ''}` },
            { label: 'User ID', value: user?.id },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between px-4 py-3">
              <p className="text-xs text-gray-400">{row.label}</p>
              <p className="text-sm font-medium text-gray-900 truncate max-w-[60%] text-right">{row.value || '—'}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Access */}
      {(uniqueCourses.length > 0 || uniqueFeatures.length > 0) && (
        <div className="bg-white rounded-2xl shadow-sm mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Access</p>
          </div>
          <div className="px-4 py-3">
            {uniqueCourses.length > 0 && (
              <>
                <p className="text-xs text-gray-500 font-medium mb-2">Courses ({uniqueCourses.length})</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {uniqueCourses.map((c, i) => (
                    <span key={i} className="text-xs bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full">{c}</span>
                  ))}
                </div>
              </>
            )}
            {uniqueFeatures.length > 0 && (
              <>
                <p className="text-xs text-gray-500 font-medium mb-2">Features</p>
                <div className="flex flex-wrap gap-2">
                  {uniqueFeatures.map((f, i) => (
                    <span key={i} className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full capitalize">{f}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Logout */}
      <button onClick={() => { logout(); navigate('/login', { replace: true }) }}
        className="w-full flex items-center justify-center gap-2 py-3.5 text-sm font-semibold text-red-500 border border-red-200 rounded-2xl hover:bg-red-50 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Logout
      </button>
    </div>
  )
}
