import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../api'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function MentorDashboard() {
  const { user } = useAuth()
  const navigate   = useNavigate()
  const [purchases, setPurchases] = useState([])
  const [products,  setProducts]  = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch(`/api/purchase/my-purchases?userId=${user.id}`).then(d => d.purchases || []),
      apiFetch('/api/purchase/products').then(d => d.products || []),
    ])
      .then(([p, pr]) => { setPurchases(p); setProducts(pr) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user.id])

  const allCourses = [
    ...(user?.access?.website?.courses || []),
    ...(user?.access?.shopify?.courses  || []),
    ...(user?.access?.combo?.courses    || []),
  ]
  const uniqueCourses = [...new Set(allCourses)]

  const recentPurchases = purchases.slice(0, 4)

  const stats = [
    {
      label: 'Enrolled Courses',
      value: uniqueCourses.length,
      color: 'bg-teal-100 text-teal-600',
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />,
    },
    {
      label: 'My Purchases',
      value: purchases.length,
      color: 'bg-indigo-100 text-indigo-600',
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />,
    },
    {
      label: 'Total Products',
      value: loading ? '—' : products.length,
      color: 'bg-purple-100 text-purple-600',
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
    },
    {
      label: 'My Students',
      value: '—',
      color: 'bg-orange-100 text-orange-600',
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />,
    },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Hero */}
      <div className="bg-gradient-to-r from-teal-600 to-emerald-600 rounded-3xl p-6 text-white">
        <p className="text-teal-200 text-sm font-medium">{getGreeting()},</p>
        <h1 className="text-2xl font-bold mt-0.5 truncate">{user?.name || 'Mentor'}</h1>
        <p className="text-teal-100 text-sm mt-1">Ready to guide students today?</p>
        <div className="flex gap-2 mt-4">
          <button onClick={() => navigate('/mentor/students')}
            className="bg-white text-teal-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-teal-50 transition-colors">
            My Students
          </button>
          <button onClick={() => navigate('/mentor/profile')}
            className="bg-teal-500/50 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-teal-500/70 transition-colors">
            Profile →
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm">
            <div className={`w-10 h-10 ${s.color} rounded-xl flex items-center justify-center mb-3`}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">{s.icon}</svg>
            </div>
            <p className="text-xl font-bold text-gray-900">{loading && s.label !== 'My Students' ? '—' : s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* My Courses */}
      {uniqueCourses.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">My Enrolled Courses</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {uniqueCourses.map((course, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                  </svg>
                </div>
                <p className="font-semibold text-gray-900 text-sm">{course}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Purchases */}
      {!loading && recentPurchases.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Purchases</h3>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {recentPurchases.map((p, i) => (
              <div key={p._id || i} className={`flex items-center gap-3 px-4 py-3 ${i < recentPurchases.length - 1 ? 'border-b border-gray-50' : ''}`}>
                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {(p.items || []).map(i => i.name).join(', ') || 'Purchase'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </p>
                </div>
                {p.amount > 0 && (
                  <span className="text-sm font-semibold text-gray-900">₹{(p.amount / 100).toLocaleString('en-IN')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No data state */}
      {!loading && uniqueCourses.length === 0 && purchases.length === 0 && (
        <div className="bg-teal-50 border border-teal-100 rounded-2xl p-6 text-center">
          <div className="w-14 h-14 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
            </svg>
          </div>
          <p className="text-teal-800 font-semibold mb-1">Welcome to your mentor portal</p>
          <p className="text-teal-600 text-sm">Your courses and student data will appear here once assigned.</p>
        </div>
      )}
    </div>
  )
}
