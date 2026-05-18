import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../api'

const LEVEL_COLORS   = { Foundation: 'bg-green-100 text-green-700', Intermediate: 'bg-yellow-100 text-yellow-700', Final: 'bg-purple-100 text-purple-700' }
const LEVEL_GRADIENT = { Foundation: 'from-green-400 to-emerald-500', Intermediate: 'from-yellow-400 to-orange-500', Final: 'from-purple-500 to-indigo-600' }

function CourseCard({ product, source, onClick }) {
  const badge    = LEVEL_COLORS[product.level]   || 'bg-gray-100 text-gray-600'
  const gradient = LEVEL_GRADIENT[product.level] || 'from-indigo-400 to-purple-500'

  const sourceLabel = source === 'shopify' ? 'Shopify' : source === 'combo' ? 'Combo' : 'Website'
  const sourceBg    = source === 'shopify' ? 'bg-orange-100 text-orange-600' : source === 'combo' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'

  return (
    <div onClick={onClick} className="bg-white rounded-2xl shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-all active:scale-[0.98]">
      <div className={`h-28 bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
        {product.imageUrl
          ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover absolute inset-0" />
          : <svg className="w-12 h-12 text-white opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
        }
        {product.level && (
          <span className={`absolute top-3 right-3 text-xs font-semibold px-2.5 py-0.5 rounded-full ${badge} backdrop-blur-sm`}>
            {product.level}
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 text-sm leading-snug mb-1">{product.name}</h3>
        {product.category && (
          <p className="text-xs text-gray-400">{product.category}{product.subCategory ? ` · ${product.subCategory}` : ''}</p>
        )}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-xs text-green-600 font-medium">Enrolled</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sourceBg}`}>{sourceLabel}</span>
            <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MyCoursesPage() {
  const navigate            = useNavigate()
  const [courses,  setCourses]  = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    apiFetch('/api/purchase/my-courses')
      .then(d => setCourses(d.courses || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="px-4 pb-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-900">My Courses</h2>
        {courses.length > 0 && (
          <span className="text-xs font-semibold bg-indigo-100 text-indigo-600 px-3 py-1 rounded-full">
            {courses.length} enrolled
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white rounded-2xl shadow-sm overflow-hidden animate-pulse">
              <div className="h-28 bg-gray-100" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-4/5" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-indigo-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-800 mb-1">No courses yet</h3>
          <p className="text-sm text-gray-400 mb-5">Explore and enrol to start learning!</p>
          <button onClick={() => navigate('/student/explore')}
            className="bg-indigo-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors">
            Explore Courses
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {courses.map(({ product, source }) => (
            <CourseCard
              key={product._id}
              product={product}
              source={source}
              onClick={() => navigate(`/student/courses/${product._id}`, { state: { item: product } })}
            />
          ))}
        </div>
      )}
    </div>
  )
}
