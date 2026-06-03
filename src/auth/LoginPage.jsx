import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, getRole } from './AuthContext'

const API_BASE = import.meta.env.VITE_API_BASE

export default function LoginPage() {
  const { login } = useAuth()
  const navigate   = useNavigate()

  const [tab, setTab]             = useState('phone')
  const [identifier, setIdentifier] = useState('')
  const [step, setStep]           = useState('input')
  const [otp, setOtp]             = useState(['', '', '', '', '', ''])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [resendTimer, setResendTimer] = useState(0)
  const [deviceConflict, setDeviceConflict] = useState(null)
  const otpRefs  = useRef([])
  const timerRef = useRef(null)

  useEffect(() => () => clearInterval(timerRef.current), [])

  function startResendTimer() {
    setResendTimer(30)
    timerRef.current = setInterval(() => {
      setResendTimer(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  async function sendOTP(e) {
    e?.preventDefault()
    setError('')
    if (!identifier.trim()) { setError(tab === 'phone' ? 'Enter your phone number' : 'Enter your email'); return }
    setLoading(true)
    try {
      const body = tab === 'phone' ? { phoneNumber: identifier.trim() } : { email: identifier.trim() }
      const res  = await fetch(`${API_BASE}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP')
      setStep('otp')
      setOtp(['', '', '', '', '', ''])
      startResendTimer()
      setTimeout(() => otpRefs.current[0]?.focus(), 100)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function verifyOTP(e) {
    e.preventDefault()
    setError('')
    const code = otp.join('')
    if (code.length !== 6) { setError('Enter the 6-digit OTP'); return }
    setLoading(true)
    try {
      const body = tab === 'phone'
        ? { phoneNumber: identifier.trim(), otp: code }
        : { email: identifier.trim(), otp: code }
      const res  = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Verification failed')

      if (data.requiresDeviceConfirmation) {
        setDeviceConflict({
          oldDevice: data.oldDevice,
          loginData: { ...body, forceLogin: true }
        })
        return
      }

      if (data.user.isAdmin) {
        window.location.href = import.meta.env.VITE_ADMIN_APP_URL || 'http://localhost:5174'
        return
      }

      login(data.user, data.token)
      const role = getRole(data.user)
      navigate(role === 'mentor' ? '/mentor' : '/student', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleLogoutFromOldDevice() {
    setError('')
    setLoading(true)
    try {
      const logoutBody = tab === 'phone'
        ? { phoneNumber: identifier.trim() }
        : { email: identifier.trim() }
      const logoutRes = await fetch(`${API_BASE}/api/auth/logout-other-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logoutBody),
      })
      if (!logoutRes.ok) throw new Error('Failed to logout from other device')

      const body = deviceConflict.loginData
      const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Verification failed')

      if (data.user.isAdmin) {
        window.location.href = import.meta.env.VITE_ADMIN_APP_URL || 'http://localhost:5174'
        return
      }

      login(data.user, data.token)
      const role = getRole(data.user)
      navigate(role === 'mentor' ? '/mentor' : '/student', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setDeviceConflict(null)
    }
  }

  function handleCancelLogin() {
    setDeviceConflict(null)
    setStep('input')
    setIdentifier('')
    setOtp(['', '', '', '', '', ''])
    setError('')
  }

  function handleOtpChange(i, v) {
    if (!/^\d*$/.test(v)) return
    const updated = [...otp]; updated[i] = v.slice(-1); setOtp(updated)
    if (v && i < 5) otpRefs.current[i + 1]?.focus()
  }

  function handleOtpKeyDown(i, e) {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus()
  }

  function handleOtpPaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length) {
      const updated = Array(6).fill('').map((_, i) => pasted[i] || '')
      setOtp(updated)
      otpRefs.current[Math.min(pasted.length, 5)]?.focus()
    }
    e.preventDefault()
  }

  const masked = tab === 'phone'
    ? identifier.replace(/(\d{2})\d+(\d{2})/, '$1****$2')
    : identifier.replace(/(.{2}).*(@.*)/, '$1****$2')

  if (deviceConflict) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-3xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mb-4">
                <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0 0H8m4 0h4m-12-4c0-1.657.895-3.107 2.23-3.897M12 3c-4.418 0-8 3.582-8 8s3.582 8 8 8 8-3.582 8-8c0-1.194-.263-2.327-.738-3.345" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">Already Logged In</h2>
              <p className="text-gray-500 text-sm mb-4">You're currently logged in on another device</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <div className="text-sm mb-3">
                <p className="text-gray-600 mb-1">Active device:</p>
                <p className="font-medium text-gray-900">{deviceConflict.oldDevice.deviceName}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Last login: {new Date(deviceConflict.oldDevice.lastLoginTime).toLocaleString()}
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-600 mb-6">
              Would you like to log in on this device? You'll be logged out from your previous device.
            </p>

            <div className="flex gap-3">
              <button onClick={handleCancelLogin} disabled={loading}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleLogoutFromOldDevice} disabled={loading}
                className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2">
                {loading ? <><Spinner />Logging in...</> : 'Yes, Log Me In'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">FOCAS Learning</h1>
          <p className="text-gray-500 text-sm mt-1">Student &amp; Mentor Portal</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl p-8">
          {step === 'input' ? (
            <>
              <h2 className="text-xl font-semibold text-gray-800 mb-1">Sign in</h2>
              <p className="text-gray-400 text-sm mb-6">We'll send you a one-time password</p>

              <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
                {['phone', 'email'].map(t => (
                  <button key={t} type="button"
                    onClick={() => { setTab(t); setIdentifier(''); setError('') }}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all capitalize ${
                      tab === t ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>{t}</button>
                ))}
              </div>

              <form onSubmit={sendOTP}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {tab === 'phone' ? 'Phone Number' : 'Email Address'}
                </label>
                {tab === 'phone' ? (
                  <div className="flex border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
                    <span className="flex items-center px-3 bg-gray-50 text-gray-500 text-sm border-r border-gray-200">+91</span>
                    <input type="tel" value={identifier} autoFocus
                      onChange={e => setIdentifier(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="10-digit mobile" className="flex-1 px-3 py-3 text-sm outline-none" />
                  </div>
                ) : (
                  <input type="email" value={identifier} autoFocus
                    onChange={e => setIdentifier(e.target.value)} placeholder="you@example.com"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                )}
                {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                <button type="submit" disabled={loading}
                  className="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                  {loading ? <><Spinner />Sending...</> : 'Send OTP'}
                </button>
              </form>
            </>
          ) : (
            <>
              <button onClick={() => { setStep('input'); setError('') }}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-5">
                ← Back
              </button>
              <h2 className="text-xl font-semibold text-gray-800 mb-1">Enter OTP</h2>
              <p className="text-gray-400 text-sm mb-6">
                6-digit code sent to <span className="font-medium text-gray-700">{masked}</span>
              </p>
              <form onSubmit={verifyOTP}>
                <div className="flex gap-1.5 sm:gap-2 mb-2" onPaste={handleOtpPaste}>
                  {otp.map((d, i) => (
                    <input key={i} ref={el => otpRefs.current[i] = el}
                      type="text" inputMode="numeric" maxLength={1} value={d}
                      onChange={e => handleOtpChange(i, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(i, e)}
                      className={`flex-1 min-w-0 aspect-square text-center text-lg sm:text-xl font-bold border-2 rounded-xl outline-none transition-all ${
                        d ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 focus:border-indigo-400'
                      }`} />
                  ))}
                </div>
                {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                <button type="submit" disabled={loading || otp.join('').length !== 6}
                  className="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                  {loading ? <><Spinner />Verifying...</> : 'Verify & Sign In'}
                </button>
                <p className="mt-4 text-center text-sm text-gray-400">
                  {resendTimer > 0
                    ? <>Resend in <span className="text-indigo-600 font-semibold">{resendTimer}s</span></>
                    : <button type="button" onClick={sendOTP} className="text-indigo-600 font-medium hover:underline">Resend OTP</button>
                  }
                </p>
              </form>
            </>
          )}
        </div>
        <p className="text-center text-xs text-gray-400 mt-5">By continuing you agree to our Terms &amp; Privacy Policy</p>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
