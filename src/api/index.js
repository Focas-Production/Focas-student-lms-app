const BASE = import.meta.env.VITE_API_BASE

export function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('student_token')}`,
    'ngrok-skip-browser-warning': 'true',
  }
}

export async function apiFetch(path, options = {}) {
  const { headers: extraHeaders, ...restOptions } = options
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...authHeaders(), ...extraHeaders },
    ...restOptions,
  })
  // Parse defensively — a non-JSON error page (proxy 502/504, empty body) must not
  // mask the real HTTP status with an "Unexpected token" parse error.
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Device logout: specific error message and 401 status
    if (res.status === 401 && data.error === 'You have been logged out - login from another device') {
      localStorage.removeItem('student_token')
      localStorage.removeItem('student_user')
      window.dispatchEvent(new CustomEvent('device-logout'))
    }
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data
}
