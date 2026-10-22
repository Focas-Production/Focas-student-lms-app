// This browser's permanent device id, sent as X-Device-Id so the server can
// tell two phones apart — their User-Agents are identical (see the server's
// services/deviceService.js). Random, made once, kept through logout; clearing
// site data just makes this a "new device" that has to sign in again.
const KEY = 'focas_device_id'
let cached = null

export function getDeviceId() {
  if (cached) return cached
  try { cached = localStorage.getItem(KEY) } catch { /* storage blocked */ }
  if (!cached || !/^[A-Za-z0-9_-]{16,128}$/.test(cached)) {
    cached = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)
    try { localStorage.setItem(KEY, cached) } catch { /* lives for this session only */ }
  }
  return cached
}
