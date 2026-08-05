import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function ProtectedRoute({ children, requiredRole }) {
  const { user, role, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    )
  }

  // Carry the destination through login, so a shared link (a track's permanent
  // /live/... URL, say) still lands where it pointed rather than on the dashboard.
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  if (requiredRole && role !== requiredRole) {
    return <Navigate to={role === 'mentor' ? '/mentor' : '/student'} replace />
  }

  return children
}
