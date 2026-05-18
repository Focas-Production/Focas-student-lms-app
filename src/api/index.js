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
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}
