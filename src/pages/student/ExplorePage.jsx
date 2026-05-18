import { useState, useEffect } from 'react'
import { apiFetch } from '../../api'

const LEVELS     = ['All', 'Foundation', 'Intermediate', 'Final']
const LEVEL_BADGE    = { Foundation: 'bg-green-100 text-green-700', Intermediate: 'bg-yellow-100 text-yellow-700', Final: 'bg-purple-100 text-purple-700' }
const LEVEL_GRADIENT = { Foundation: 'from-green-400 to-emerald-500', Intermediate: 'from-yellow-400 to-orange-500', Final: 'from-purple-500 to-indigo-600' }

function ProductModal({ product, onClose }) {
  if (!product) return null
  const gradient = LEVEL_GRADIENT[product.level] || 'from-indigo-400 to-purple-500'
  const badge    = LEVEL_BADGE[product.level]    || 'bg-gray-100 text-gray-600'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className={`h-40 bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
          {product.imageUrl
            ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover absolute inset-0" />
            : <svg className="w-16 h-16 text-white opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
          }
          <button onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 bg-black/30 rounded-full flex items-center justify-center text-white hover:bg-black/50 z-10">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h2 className="text-lg font-bold text-gray-900 flex-1">{product.name}</h2>
            {product.level && (
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${badge}`}>{product.level}</span>
            )}
          </div>
          {product.category && (
            <p className="text-xs text-gray-500 mb-3">{product.category}{product.subCategory ? ` · ${product.subCategory}` : ''}</p>
          )}
          {product.description && (
            <p className="text-sm text-gray-600 mb-4 leading-relaxed">{product.description}</p>
          )}
          <div className="flex items-center justify-between py-3 border-t border-gray-100">
            <div>
              {product.originalPrice && product.originalPrice > product.price && (
                <span className="text-sm text-gray-400 line-through mr-2">₹{product.originalPrice.toLocaleString('en-IN')}</span>
              )}
              {product.price != null && (
                <span className="text-2xl font-bold text-indigo-600">₹{product.price.toLocaleString('en-IN')}</span>
              )}
            </div>
            {product.originalPrice && product.originalPrice > product.price && (
              <span className="text-xs font-semibold bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
                {Math.round((1 - product.price / product.originalPrice) * 100)}% off
              </span>
            )}
          </div>
          <button onClick={onClose}
            className="w-full mt-3 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ExplorePage() {
  const [products,  setProducts]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [level,     setLevel]     = useState('All')
  const [search,    setSearch]    = useState('')
  const [selected,  setSelected]  = useState(null)

  useEffect(() => {
    apiFetch('/api/purchase/products')
      .then(d => setProducts(d.products || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = products.filter(p =>
    (level === 'All' || p.level === level) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.category || '').toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="px-4 pb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">Explore Courses</h2>
        {!loading && (
          <span className="text-xs font-semibold bg-gray-100 text-gray-500 px-3 py-1 rounded-full">
            {filtered.length} course{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <svg className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search courses..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Level tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5 scrollbar-hide">
        {LEVELS.map(l => (
          <button key={l} onClick={() => setLevel(l)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              level === l ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:border-indigo-300'
            }`}>{l}</button>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white rounded-2xl shadow-sm overflow-hidden animate-pulse">
              <div className="h-36 bg-gray-100" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
                <div className="flex justify-between mt-3">
                  <div className="h-5 bg-gray-100 rounded w-1/4" />
                  <div className="h-5 bg-gray-100 rounded w-1/5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-3">
            <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-gray-500 font-medium">No courses found</p>
          <p className="text-sm text-gray-400 mt-1">Try a different search or filter</p>
          {(search || level !== 'All') && (
            <button onClick={() => { setSearch(''); setLevel('All') }}
              className="mt-4 text-sm text-indigo-600 font-medium">Clear filters</button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(p => (
            <div key={p._id} onClick={() => setSelected(p)}
              className="bg-white rounded-2xl shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow active:scale-[0.99]">
              {p.imageUrl
                ? <img src={p.imageUrl} alt={p.name} className="w-full h-36 object-cover" />
                : <div className={`h-36 bg-gradient-to-br ${LEVEL_GRADIENT[p.level] || 'from-indigo-400 to-purple-500'} flex items-center justify-center relative`}>
                    <svg className="w-12 h-12 text-white opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    {p.level && (
                      <span className={`absolute top-3 right-3 text-xs font-semibold px-2.5 py-0.5 rounded-full ${LEVEL_BADGE[p.level] || 'bg-gray-100 text-gray-600'}`}>
                        {p.level}
                      </span>
                    )}
                  </div>
              }
              <div className="p-4">
                <div className="flex items-start gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900 text-sm flex-1 leading-snug">{p.name}</h3>
                  {p.imageUrl && p.level && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${LEVEL_BADGE[p.level] || 'bg-gray-100 text-gray-600'}`}>{p.level}</span>
                  )}
                </div>
                {p.description && (
                  <p className="text-xs text-gray-500 line-clamp-2 mb-3 leading-relaxed">{p.description}</p>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {p.originalPrice && p.originalPrice > p.price && (
                      <span className="text-xs text-gray-400 line-through">₹{p.originalPrice.toLocaleString('en-IN')}</span>
                    )}
                    {p.price != null && (
                      <span className="text-base font-bold text-indigo-600">₹{p.price.toLocaleString('en-IN')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {p.category && (
                      <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{p.category}</span>
                    )}
                    {p.originalPrice && p.originalPrice > p.price && (
                      <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                        {Math.round((1 - p.price / p.originalPrice) * 100)}% off
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && <ProductModal product={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
