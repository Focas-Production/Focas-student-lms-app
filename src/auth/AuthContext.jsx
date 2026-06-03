import { createContext, useContext, useState, useEffect } from 'react'
import { apiFetch } from '../api'

function isTokenExpired(token) {
  try {
    // JWT segments are base64url — convert to standard base64 before decoding
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64))
    return payload.exp * 1000 < Date.now()
  } catch {
    return true
  }
}

export function getRole(user) {
  if (!user) return null
  const features = [
    ...(user.access?.website?.features || []),
    ...(user.access?.shopify?.features  || []),
    ...(user.access?.combo?.features    || []),
  ]
  if (features.includes('mentor')) return 'mentor'
  return 'student'
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [role, setRole]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token  = localStorage.getItem('student_token')
    const stored = localStorage.getItem('student_user')
    if (!token || !stored || isTokenExpired(token)) {
      clear()
      setLoading(false)
      return
    }
    let parsed
    try {
      parsed = JSON.parse(stored)
    } catch {
      clear()
      setLoading(false)
      return
    }
    setUser(parsed)
    setRole(getRole(parsed))

    apiFetch('/api/auth/me')
      .then(fresh => {
        const updated = { ...fresh, id: fresh.id || parsed.id }
        persist(updated)
      })
      .catch(err => {
        // Only clear if it's a device logout error, not network errors
        if (err.message === 'You have been logged out - login from another device') {
          clear()
        }
        // For other errors (network, server), keep the user logged in and retry later
      })
      .finally(() => setLoading(false))
  }, [])

  function persist(userData) {
    localStorage.setItem('student_user', JSON.stringify(userData))
    setUser(userData)
    setRole(getRole(userData))
  }

  function clear() {
    localStorage.removeItem('student_token')
    localStorage.removeItem('student_user')
    setUser(null)
    setRole(null)
  }

  function login(userData, token) {
    localStorage.setItem('student_token', token)
    persist(userData)
  }

  function logout() { clear() }

  return (
    <AuthContext.Provider value={{ user, role, loading, login, logout, setUser: persist }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
