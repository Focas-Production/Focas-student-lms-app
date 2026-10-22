import { getDeviceId } from '../lib/deviceId'

const BASE = import.meta.env.VITE_API_BASE

export function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('student_token')}`,
    'ngrok-skip-browser-warning': 'true',
    'X-Device-Id': getDeviceId(),
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
    // status/data ride along so callers can act on structured errors (e.g. PERSON_CLASH).
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

// Booking saves can come back with code PERSON_CLASH: someone (the host or a
// listed student) is already booked elsewhere at that time. That is a warning,
// not a refusal — show it and, if the scheduler still wants it, re-send with
// allowClash. `send(extra)` must merge `extra` into its JSON body.
export async function saveWithClashCheck(send) {
  try {
    return await send({})
  } catch (err) {
    if (err.data?.code !== 'PERSON_CLASH') throw err
    if (!window.confirm(`${err.message}\n\nSave anyway?`)) {
      const e = new Error('Not saved — change the time or the people, or save anyway.')
      e.cancelled = true
      throw e
    }
    return send({ allowClash: true })
  }
}
