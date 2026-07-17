import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import ProtectedRoute from './ProtectedRoute'

import LoginPage from '../auth/LoginPage'
import StudentLayout from '../layouts/StudentLayout'
import MentorLayout from '../layouts/MentorLayout'

import StudentHome from '../pages/student/StudentHome'
import MyCoursesPage from '../pages/student/MyCoursesPage'
import CourseContentPage from '../pages/student/CourseContentPage'
import ExplorePage from '../pages/student/ExplorePage'
import ProfilePage from '../pages/student/ProfilePage'
import TestSeriesPage from '../pages/student/TestSeriesPage'
import AiPracticePage from '../pages/student/AiPracticePage'

import MentorDashboard from '../pages/mentor/MentorDashboard'
import MyStudentsPage from '../pages/mentor/MyStudentsPage'
import MentorProfilePage from '../pages/mentor/MentorProfilePage'
import MentorTestSeriesPage from '../pages/mentor/MentorTestSeriesPage'

function RootRedirect() {
  const { user, role, loading } = useAuth()
  if (loading) return null
  if (!user)          return <Navigate to="/login" replace />
  if (role === 'mentor') return <Navigate to="/mentor" replace />
  return <Navigate to="/student" replace />
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/"      element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Student routes */}
      <Route path="/student" element={
        <ProtectedRoute requiredRole="student"><StudentLayout /></ProtectedRoute>
      }>
        <Route index          element={<StudentHome />} />
        <Route path="courses"            element={<MyCoursesPage />} />
        <Route path="courses/:productId" element={<CourseContentPage />} />
        <Route path="test-series" element={<TestSeriesPage />} />
        <Route path="ai-practice" element={<AiPracticePage />} />
        <Route path="explore" element={<ExplorePage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/* Mentor routes */}
      <Route path="/mentor" element={
        <ProtectedRoute requiredRole="mentor"><MentorLayout /></ProtectedRoute>
      }>
        <Route index           element={<MentorDashboard />} />
        <Route path="test-series" element={<MentorTestSeriesPage />} />
        <Route path="students" element={<MyStudentsPage />} />
        <Route path="profile"  element={<MentorProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
