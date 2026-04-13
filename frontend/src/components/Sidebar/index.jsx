import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { signOut, getHistory, deleteSession } from '../../utils/api'
import ThemeToggle from '../ThemeToggle'
import './index.scss'

const Sidebar = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const fetchHistory = async () => {
    try {
      const data = await getHistory()
      setHistory(data.sessions || [])
    } catch (err) {
      console.error("Failed to fetch history:", err)
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    const userStr = localStorage.getItem('user')
    if (userStr) {
      try {
        setUser(JSON.parse(userStr))
      } catch {
        localStorage.removeItem('user')
      }
    }
    fetchHistory()
  }, [location.pathname]) // Re-fetch history when navigating (e.g. after a new analysis)

  const handleDeleteSession = async (e, sessionId) => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm("Are you sure you want to delete this chat session?")) return
    
    try {
      await deleteSession(sessionId)
      setHistory(prev => prev.filter(s => s.session_id !== sessionId))
      // If we are currently viewing this session, navigate away
      const currentParams = new URLSearchParams(location.search)
      if (currentParams.get('session_id') === sessionId) {
        navigate('/home')
      }
    } catch (err) {
      console.error("Failed to delete session:", err)
      alert("Failed to delete session.")
    }
  }

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
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <button 
        className="collapse-toggle-btn" 
        onClick={() => setIsCollapsed(!isCollapsed)}
        title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
      >
        {isCollapsed ? '❯' : '❮'}
      </button>

      <div className="sidebar-header">
        {isCollapsed ? (
          <img src="/logo.png" alt="LegalEase Logo" className="brand-logo-collapsed" />
        ) : (
          <h2>LegalEase</h2>
        )}
        {user && !isCollapsed && (
          <p className="user-greeting">Hello, {user.full_name?.split(' ')[0] || 'User'}!</p>
        )}
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/home" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} title="Home">
          <span>🏠</span> {!isCollapsed && "Home"}
        </NavLink>
        <NavLink to="/upload" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} title="Upload">
          <span>📤</span> {!isCollapsed && "Upload"}
        </NavLink>
        <NavLink to="/analyze-document" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} title="Analyze Document">
          <span>🔍</span> {!isCollapsed && "Analyze Document"}
        </NavLink>
        <NavLink to="/legal-advice" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} title="Legal Advice">
          <span>⚖️</span> {!isCollapsed && "Legal Advice"}
        </NavLink>
      </nav>

      {!isCollapsed && (
        <div className="history-section">
          <h3>Recent History</h3>
          {loadingHistory ? (
            <p className="history-empty">Loading...</p>
        ) : history.length === 0 ? (
          <p className="history-empty">No recent chats.</p>
        ) : (
          <div className="history-list">
            {history.map((session) => (
              <div 
                key={session.session_id} 
                className="history-item"
                onClick={() => navigate(`/analyze-document?session_id=${session.session_id}`)}
              >
                <div className="history-icon">📄</div>
                <div className="history-details">
                  <span className="history-title">{session.title}</span>
                  <span className="history-doc">{session.document_name}</span>
                </div>
                <button 
                  className="history-delete" 
                  onClick={(e) => handleDeleteSession(e, session.session_id)}
                  title="Delete Session"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      <div className="sidebar-footer">
        <button className="logout-btn" onClick={handleLogout} disabled={loggingOut} title="Logout">
          <span>🚪</span> {!isCollapsed && (loggingOut ? 'Logging...' : 'Logout')}
        </button>
        <ThemeToggle isFixed={false} />
      </div>
    </div>
  )
}

export default Sidebar