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

const LEVEL_GRADIENT = {
  Foundation:   'from-green-400 to-emerald-500',
  Intermediate: 'from-yellow-400 to-orange-500',
  Final:        'from-purple-500 to-indigo-600',
}

export default function StudentHome() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const [courses,  setCourses]  = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    apiFetch('/api/purchase/my-courses')
      .then(d => setCourses(d.courses || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const recentItems = courses.slice(0, 3)

  return (
    <div className="px-4 pb-6 space-y-6">
      {/* Hero */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-3xl p-5 text-white">
        <p className="text-indigo-200 text-sm font-medium">{getGreeting()},</p>
        <h2 className="text-2xl font-bold mt-0.5 truncate">{user.name || user.phoneNumber || user.email}</h2>
        <p className="text-indigo-100 text-sm mt-1">Ready to learn something new today?</p>
        <div className="flex gap-2 mt-4">
          <button onClick={() => navigate('/student/courses')}
            className="bg-white text-indigo-600 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-50 transition-colors">
            My Courses
          </button>
          <button onClick={() => navigate('/student/explore')}
            className="bg-indigo-500/50 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-500/70 transition-colors">
            Explore →
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <p className="text-xl font-bold text-gray-900">{courses.length}</p>
            <p className="text-xs text-gray-500">Enrolled</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          </div>
          <div>
            <p className="text-xl font-bold text-gray-900">{loading ? '…' : courses.length}</p>
            <p className="text-xs text-gray-500">Active</p>
          </div>
        </div>
      </div>

      {/* My Courses */}
      {!loading && recentItems.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">My Courses</h3>
            <button onClick={() => navigate('/student/courses')} className="text-xs text-indigo-600 font-medium">View all →</button>
          </div>
          <div className="space-y-3">
            {recentItems.map(({ product }) => (
              <div key={product._id}
                onClick={() => navigate(`/student/courses/${product._id}`, { state: { item: product } })}
                className="bg-white rounded-2xl p-3.5 shadow-sm flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${LEVEL_GRADIENT[product.level] || 'from-indigo-400 to-purple-500'} flex items-center justify-center flex-shrink-0`}>
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{product.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {product.level && (
                      <span className="text-xs text-indigo-600 font-medium">{product.level}</span>
                    )}
                    {product.category && (
                      <span className="text-xs text-gray-400">{product.category}</span>
                    )}
                  </div>
                </div>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1,2].map(i => (
            <div key={i} className="bg-white rounded-2xl p-3.5 shadow-sm flex items-center gap-3 animate-pulse">
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No courses CTA */}
      {!loading && courses.length === 0 && (
        <div className="bg-indigo-50 rounded-2xl p-5 text-center">
          <p className="text-indigo-700 font-semibold mb-1">Start your learning journey</p>
          <p className="text-indigo-500 text-sm mb-4">Browse available courses and enrol today.</p>
          <button onClick={() => navigate('/student/explore')}
            className="bg-indigo-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors">
            Explore Courses
          </button>
        </div>
      )}
    </div>
  )
}
