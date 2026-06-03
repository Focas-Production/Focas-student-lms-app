import { useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import AppRouter from './router/AppRouter'
import './App.css'

export default function App() {
  useEffect(() => {
    const handleDeviceLogout = () => {
      alert('You have been logged out because you logged in from another device.')
      window.location.href = '/login'
    }
    window.addEventListener('device-logout', handleDeviceLogout)
    return () => window.removeEventListener('device-logout', handleDeviceLogout)
  }, [])

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  )
}
