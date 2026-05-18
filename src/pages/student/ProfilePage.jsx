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

export default function ProfilePage() {
  const { user, logout, setUser } = useAuth()
  const navigate   = useNavigate()
  const [editing,  setEditing]  = useState(false)
  const [name,     setName]     = useState(user?.name || '')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [purchases, setPurchases] = useState([])

  useEffect(() => {
    apiFetch('/api/purchase/my-purchases')
      .then(d => setPurchases(d.purchases || []))
      .catch(() => {})
  }, [])

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

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const allCourses = [
    ...(user?.access?.website?.courses || []),
    ...(user?.access?.shopify?.courses  || []),
    ...(user?.access?.combo?.courses    || []),
  ]
  const uniqueCourses = [...new Set(allCourses)]
  const totalSpend = purchases.reduce((s, p) =>
    s + (p.items || []).reduce((itemSum, item) => itemSum + (item.amount || 0), 0), 0)

  return (
    <div className="px-4 pb-8">
      {/* Avatar + name */}
      <div className="flex flex-col items-center py-7">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg mb-3">
          {getInitials(user)}
        </div>

        {editing ? (
          <div className="w-full max-w-xs mt-1">
            <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus
              className="w-full text-center text-lg font-bold px-3 py-1.5 border-b-2 border-indigo-400 outline-none bg-transparent" />
            {error && <p className="text-xs text-red-500 text-center mt-1">{error}</p>}
            <div className="flex gap-2 mt-3 justify-center">
              <button onClick={() => { setEditing(false); setName(user?.name || '') }}
                className="px-4 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 mt-1">
            <h2 className="text-xl font-bold text-gray-900">{user?.name || 'Student'}</h2>
            <button onClick={() => setEditing(true)} className="text-gray-400 hover:text-indigo-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          </div>
        )}
        <span className="mt-1.5 text-xs bg-indigo-100 text-indigo-600 px-3 py-0.5 rounded-full font-medium">Student</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Courses',   value: uniqueCourses.length },
          { label: 'Purchases', value: purchases.length },
          { label: 'Spent',     value: totalSpend > 0 ? `₹${totalSpend.toLocaleString('en-IN')}` : '₹0' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-3 shadow-sm text-center">
            <p className="text-lg font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Account info */}
      <div className="bg-white rounded-2xl shadow-sm mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Account Details</p>
        </div>
        <div className="divide-y divide-gray-50">
          {[
            {
              label: 'Phone',
              value: user?.phoneNumber ? `+91 ${user.phoneNumber}` : null,
              icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />,
            },
            {
              label: 'Email',
              value: user?.email,
              icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />,
            },
            {
              label: 'User ID',
              value: user?.id,
              icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />,
            },
          ].map(row => (
            <div key={row.label} className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">{row.icon}</svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-400">{row.label}</p>
                <p className="text-sm font-medium text-gray-900 truncate">{row.value || '—'}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Enrolled courses */}
      {uniqueCourses.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Enrolled Courses</p>
          </div>
          <div className="px-4 py-2 divide-y divide-gray-50">
            {uniqueCourses.map((course) => (
              <div key={course} className="py-2.5 flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
                <p className="text-sm text-gray-800 font-medium">{course}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Logout */}
      <button onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 py-3.5 text-sm font-semibold text-red-500 border border-red-200 rounded-2xl hover:bg-red-50 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Logout
      </button>
    </div>
  )
}
