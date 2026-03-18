import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import './index.scss'

const SignIn = () => {
  const navigate = useNavigate()
  const [formData, setFormData] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('http://localhost:8000/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',          // receive httpOnly cookie
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || 'Sign in failed')
      }

      // Hard redirect so App.jsx re-runs checkAuth() and isAuthenticated becomes true
      localStorage.setItem('user', JSON.stringify(data.user))
      window.location.href = '/home'
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-left">
          <div className="auth-branding">
            <h1>Welcome Back to <span>LegalEase</span></h1>
            <p>Sign in to continue analyzing your documents with AI-powered insights</p>
            <div className="features-list">
              <div className="feature-item">
                <span className="check-icon">✓</span>
                <p>Access your uploaded documents</p>
              </div>
              <div className="feature-item">
                <span className="check-icon">✓</span>
                <p>Continue your conversations</p>
              </div>
              <div className="feature-item">
                <span className="check-icon">✓</span>
                <p>Get instant legal assistance</p>
              </div>
            </div>
          </div>
        </div>

        <div className="auth-right">
          <div className="auth-form-wrapper">
            <div className="auth-header">
              <h2>Sign In</h2>
              <p>Enter your credentials to access your account</p>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
              {error && (
                <div className="error-message">
                  <span>⚠️</span> {error}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  required
                />
              </div>

              <button type="submit" className="submit-btn" disabled={loading}>
                {loading ? 'Signing In...' : 'Sign In'}
              </button>
            </form>

            <div className="auth-footer">
              <p>Don't have an account? <Link to="/signup">Sign Up</Link></p>
              <Link to="/" className="back-link">← Back to Home</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SignIn