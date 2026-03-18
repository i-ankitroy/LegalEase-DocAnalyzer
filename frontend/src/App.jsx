import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import Landing from './components/Landing'
import SignIn from './components/SignIn'
import SignUp from './components/SignUp'
import Home from './components/Home'
import Upload from './components/Upload'
import Chat from './components/Chat'
import LegalChat from './components/LegalChat'
import './App.scss'

const checkAuth = async () => {
  try {
    const res = await fetch('http://localhost:8000/api/auth/me', {
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

// Redirect logged-in users away from signin/signup → but NOT from landing
const AuthRoute = ({ children, isAuthenticated, loading }) => {
  if (loading) return null
  if (isAuthenticated) return <Navigate to="/home" replace />
  return children
}

// Block unauthenticated users from protected pages
const ProtectedRoute = ({ children, isAuthenticated, loading }) => {
  if (loading) return null
  if (!isAuthenticated) return <Navigate to="/signin" replace />
  return children
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuth().then((authed) => {
      setIsAuthenticated(authed)
      setLoading(false)
    })
  }, [])

  return (
    <Routes>
      {/* Landing is ALWAYS accessible — no auth redirect */}
      <Route path="/" element={<Landing isAuthenticated={isAuthenticated} loading={loading} />} />

      {/* Signin / Signup redirect logged-in users to home */}
      <Route path="/signin" element={
        <AuthRoute isAuthenticated={isAuthenticated} loading={loading}>
          <SignIn />
        </AuthRoute>
      } />

      <Route path="/signup" element={
        <AuthRoute isAuthenticated={isAuthenticated} loading={loading}>
          <SignUp />
        </AuthRoute>
      } />

      {/* Protected Routes */}
      <Route path="/" element={
        <ProtectedRoute isAuthenticated={isAuthenticated} loading={loading}>
          <Layout />
        </ProtectedRoute>
      }>
        <Route path="home" element={<Home />} />
        <Route path="upload" element={<Upload />} />
        <Route path="chat" element={<Chat />} />
        <Route path="legal-advice" element={<LegalChat />} />
      </Route>

      {/* Catch all → landing */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App