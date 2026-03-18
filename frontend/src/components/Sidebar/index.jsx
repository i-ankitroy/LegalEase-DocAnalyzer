import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { signOut } from '../../utils/api'
import './index.scss'

const Sidebar = () => {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    const userStr = localStorage.getItem('user')
    if (userStr) {
      try {
        setUser(JSON.parse(userStr))
      } catch {
        localStorage.removeItem('user')
      }
    }
  }, [])

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      // Calls POST /api/auth/signout → backend clears httpOnly cookies
      await signOut()
      // signOut() already does window.location.href = '/signin'
    } catch {
      // Even if the API call fails, clear local state and redirect
      localStorage.removeItem('user')
      navigate('/')
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>LegalEase</h2>
        {user && (
          <p className="user-greeting">Hello, {user.full_name?.split(' ')[0] || 'User'}!</p>
        )}
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/home" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          <span>🏠</span> Home
        </NavLink>
        <NavLink to="/upload" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          <span>📤</span> Upload
        </NavLink>
        <NavLink to="/chat" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          <span>💬</span> Chat
        </NavLink>
        <NavLink to="/legal-advice" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          <span>⚖️</span> Legal Advice
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <button className="logout-btn" onClick={handleLogout} disabled={loggingOut}>
          <span>🚪</span> {loggingOut ? 'Logging out...' : 'Logout'}
        </button>
      </div>
    </div>
  )
}

export default Sidebar